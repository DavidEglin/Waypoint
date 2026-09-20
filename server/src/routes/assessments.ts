import type { FastifyInstance, FastifyReply } from 'fastify';
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type {
  AssessmentDetail,
  AssessmentPart,
  AssessmentSource,
  AssessmentSummary,
  AssessmentTopic,
  ReadErrorCode,
  ReadMethod,
} from '@waypoint/shared';
import { MAX_IMAGE_BYTES, READ_ERROR_TEXT, fromCanvasRequestSchema } from '@waypoint/shared';
import type { AppDeps } from '../app.js';
import { audit, clientIp, requireAuth, sendError } from '../auth.js';
import { CanvasClient, CanvasError } from '../canvas.js';
import { randomToken } from '../crypto.js';
import { EXT_BY_KIND, MIME_BY_KIND, isImage, sniffKind } from '../extract.js';
import { parseBody } from '../http.js';
import { loadSecret } from '../secrets.js';
import { ReadError } from '../claude.js';

const MAX_CONCURRENT_READS = 3;

interface AssessmentRow {
  id: number;
  user_id: number;
  title: string;
  course_label: string | null;
  course_name: string | null;
  weighting_text: string | null;
  weighting_percent: number | null;
  ai_use: string | null;
  source: AssessmentSource;
  status: AssessmentSummary['status'];
  error_code: ReadErrorCode | null;
  needs_own_focus: number;
  focus_prompt: string | null;
  chosen_focus: string | null;
  read_method: ReadMethod | null;
  created_at: string;
  next_due: string | null;
  last_due: string | null;
}

export function assessmentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const now = deps.now ?? (() => new Date());

  const hasConnection = (userId: number, kind: 'canvas' | 'claude') =>
    !!db.prepare('SELECT 1 FROM connections WHERE user_id = ? AND kind = ?').get(userId, kind);

  const selectRows = (where: string, ...params: unknown[]) =>
    db
      .prepare(
        `SELECT a.*, c.name AS course_name,
           (SELECT MIN(due_at) FROM assessment_parts p WHERE p.assessment_id = a.id AND p.due_at >= ?) AS next_due,
           (SELECT MAX(due_at) FROM assessment_parts p WHERE p.assessment_id = a.id) AS last_due
         FROM assessments a LEFT JOIN courses c ON c.id = a.course_id WHERE ${where}`,
      )
      .all(now().toISOString(), ...params) as AssessmentRow[];

  const summary = (r: AssessmentRow): AssessmentSummary => ({
    id: r.id,
    title: r.title,
    courseName: r.course_name ?? r.course_label,
    source: r.source,
    status: r.status,
    nextDueAt: r.next_due,
    lastDueAt: r.last_due,
    createdAt: r.created_at,
  });

  const detail = (userId: number, id: number): AssessmentDetail | null => {
    const row = selectRows('a.user_id = ? AND a.id = ?', userId, id)[0];
    if (!row) return null;
    const parts = (
      db.prepare('SELECT label, description, due_at, due_has_time, due_text FROM assessment_parts WHERE assessment_id = ? ORDER BY position').all(id) as {
        label: string; description: string | null; due_at: string | null; due_has_time: number; due_text: string | null;
      }[]
    ).map((p): AssessmentPart => ({ label: p.label, description: p.description, dueAt: p.due_at, dueHasTime: p.due_has_time === 1, dueText: p.due_text }));
    const topics = db.prepare('SELECT text, kind FROM topics WHERE assessment_id = ? ORDER BY position').all(id) as AssessmentTopic[];
    const file = db.prepare('SELECT original_name, mime, size FROM source_files WHERE assessment_id = ?').get(id) as
      | { original_name: string | null; mime: string; size: number }
      | undefined;
    return {
      ...summary(row),
      weightingText: row.weighting_text,
      weightingPercent: row.weighting_percent,
      aiUse: row.ai_use,
      parts,
      topics,
      needsOwnFocus: row.needs_own_focus === 1,
      focusPrompt: row.focus_prompt,
      chosenFocus: row.chosen_focus,
      readMethod: row.read_method,
      sourceFile: file ? { name: file.original_name, mime: file.mime, size: file.size } : null,
      errorCode: row.error_code,
    };
  };

  const enqueueRead = (assessmentId: number) => app.jobs.enqueue('read_notification', { assessmentId });

  const guardStart = (userId: number, reply: FastifyReply, needCanvas: boolean): boolean => {
    if (!hasConnection(userId, 'claude')) {
      sendError(reply, 409, 'no_claude_key', READ_ERROR_TEXT.no_claude_key);
      return false;
    }
    if (needCanvas && !hasConnection(userId, 'canvas')) {
      sendError(reply, 409, 'no_canvas', READ_ERROR_TEXT.no_canvas);
      return false;
    }
    const busy = db.prepare("SELECT COUNT(*) AS n FROM assessments WHERE user_id = ? AND status = 'reading'").get(userId) as { n: number };
    if (busy.n >= MAX_CONCURRENT_READS) {
      sendError(reply, 429, 'busy', 'Waypoint is still reading a few of your notifications. Give it a moment.');
      return false;
    }
    return true;
  };

  // ---- List and detail ----

  app.get('/api/assessments', { preHandler: requireAuth }, async (request): Promise<AssessmentSummary[]> => {
    const rows = selectRows('a.user_id = ?', request.auth!.user.id);
    const upcoming = rows.filter((r) => r.next_due).sort((a, b) => a.next_due!.localeCompare(b.next_due!));
    const undated = rows.filter((r) => !r.next_due && !r.last_due).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const past = rows.filter((r) => !r.next_due && r.last_due).sort((a, b) => b.last_due!.localeCompare(a.last_due!));
    return [...upcoming, ...undated, ...past].map(summary);
  });

  app.get('/api/assessments/:id', { preHandler: requireAuth }, async (request, reply) => {
    const found = detail(request.auth!.user.id, Number((request.params as { id: string }).id));
    return found ?? sendError(reply, 404, 'not_found', 'No such assessment.');
  });

  // ---- Add: upload a photo or document ----

  app.post('/api/assessments', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.isMultipart()) return sendError(reply, 415, 'multipart_required', 'Send the notification as a file upload.');
    const user = request.auth!.user;
    if (!guardStart(user.id, reply, false)) return reply;

    const part = await request.file();
    if (!part) return sendError(reply, 400, 'no_file', 'Choose a file to upload.');

    // Fields must come before the file in the form so they have been read by now.
    const rawCourse = (part.fields.courseId as { value?: unknown } | undefined)?.value;
    let courseId: number | null = null;
    if (rawCourse !== undefined && rawCourse !== '') {
      courseId = Number(rawCourse);
      const owned = Number.isInteger(courseId) && db.prepare('SELECT 1 FROM courses WHERE id = ? AND user_id = ?').get(courseId, user.id);
      if (!owned) return sendError(reply, 400, 'invalid_course', 'That course was not found.');
    }

    let buf: Buffer;
    try {
      buf = await part.toBuffer();
    } catch {
      return sendError(reply, 413, 'file_too_large', 'That file is too big. The limit is 15 MB.');
    }
    if (part.file.truncated) return sendError(reply, 413, 'file_too_large', 'That file is too big. The limit is 15 MB.');

    const kind = sniffKind(buf);
    if (!kind) {
      return sendError(reply, 415, 'unsupported_file', 'Use a JPEG, PNG or WebP photo, or a PDF or Word (.docx) document.');
    }
    if (isImage(kind) && buf.length > MAX_IMAGE_BYTES) {
      return sendError(reply, 413, 'image_too_large', 'That photo is too big to read (5 MB limit). Try a smaller one.');
    }

    const dir = join(config.dataDir, 'uploads', String(user.id));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${randomToken(16)}.${EXT_BY_KIND[kind]}`);
    writeFileSync(path, buf, { mode: 0o600 });

    // Only used for display. The stored file gets a generated name.
    const originalName = basename(part.filename ?? '').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || null;
    const title = (originalName ? originalName.slice(0, originalName.length - extname(originalName).length) : '') || 'Assessment notification';

    let id: number;
    try {
      id = db.transaction(() => {
        const info = db
          .prepare("INSERT INTO assessments (user_id, course_id, title, source, status) VALUES (?, ?, ?, ?, 'reading')")
          .run(user.id, courseId, title, isImage(kind) ? 'photo' : 'document');
        db.prepare('INSERT INTO source_files (assessment_id, path, original_name, mime, size) VALUES (?, ?, ?, ?, ?)').run(
          info.lastInsertRowid, path, originalName, MIME_BY_KIND[kind], buf.length,
        );
        return Number(info.lastInsertRowid);
      })();
    } catch (err) {
      rmSync(path, { force: true });
      throw err;
    }
    enqueueRead(id);
    audit(db, { actor: user, action: 'assessment_uploaded', target: String(id), ip: clientIp(request, config) });
    return reply.code(202).send({ id });
  });

  // ---- Add: from Canvas ----

  app.post('/api/assessments/from-canvas', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(fromCanvasRequestSchema, request.body, reply);
    if (!body) return reply;
    const user = request.auth!.user;
    if (!guardStart(user.id, reply, true)) return reply;

    const course = db.prepare('SELECT id, canvas_course_id FROM courses WHERE id = ? AND user_id = ?').get(body.courseId, user.id) as
      | { id: number; canvas_course_id: string }
      | undefined;
    if (!course) return sendError(reply, 404, 'not_found', 'That course was not found. Refresh the list and try again.');

    const existing = db
      .prepare('SELECT id FROM assessments WHERE user_id = ? AND canvas_assignment_id = ?')
      .get(user.id, body.canvasAssignmentId) as { id: number } | undefined;
    if (existing) return reply.code(409).send({ error: 'already_added', message: 'You have already added that one.', assessmentId: existing.id });

    let name: string;
    try {
      const { secret, baseUrl } = loadSecret(db, config, user.id, 'canvas');
      name = (await new CanvasClient(baseUrl!, secret, deps.fetch).getAssignment(course.canvas_course_id, body.canvasAssignmentId)).name;
    } catch (err) {
      if (err instanceof ReadError) return sendError(reply, err.code === 'no_canvas' ? 409 : 502, err.code, READ_ERROR_TEXT[err.code]);
      throw err;
    }

    const info = db
      .prepare("INSERT INTO assessments (user_id, course_id, title, source, canvas_assignment_id, status) VALUES (?, ?, ?, 'canvas', ?, 'reading')")
      .run(user.id, course.id, name.slice(0, 200), body.canvasAssignmentId);
    const id = Number(info.lastInsertRowid);
    enqueueRead(id);
    audit(db, { actor: user, action: 'assessment_added_from_canvas', target: String(id), ip: clientIp(request, config) });
    return reply.code(202).send({ id });
  });

  // ---- Retry, delete, original file ----

  app.post('/api/assessments/:id/retry', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.auth!.user;
    const id = Number((request.params as { id: string }).id);
    const row = db.prepare('SELECT status FROM assessments WHERE id = ? AND user_id = ?').get(id, user.id) as { status: string } | undefined;
    if (!row) return sendError(reply, 404, 'not_found', 'No such assessment.');
    if (row.status !== 'failed') return sendError(reply, 409, 'not_failed', 'Only a failed read can be retried.');
    if (!guardStart(user.id, reply, false)) return reply;

    db.prepare("UPDATE assessments SET status = 'reading', error_code = NULL, updated_at = ? WHERE id = ?").run(now().toISOString(), id);
    enqueueRead(id);
    return detail(user.id, id);
  });

  app.delete('/api/assessments/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.auth!.user;
    const id = Number((request.params as { id: string }).id);
    const row = db.prepare('SELECT id FROM assessments WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!row) return sendError(reply, 404, 'not_found', 'No such assessment.');
    const file = db.prepare('SELECT path FROM source_files WHERE assessment_id = ?').get(id) as { path: string } | undefined;
    db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
    if (file) rmSync(file.path, { force: true });
    audit(db, { actor: user, action: 'assessment_deleted', target: String(id), ip: clientIp(request, config) });
    return reply.code(204).send();
  });

  // Uploads are never served from a static folder: only here, after an ownership check.
  app.get('/api/assessments/:id/source', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const file = db
      .prepare(
        `SELECT f.path, f.mime, f.original_name FROM source_files f JOIN assessments a ON a.id = f.assessment_id
         WHERE a.id = ? AND a.user_id = ?`,
      )
      .get(id, request.auth!.user.id) as { path: string; mime: string; original_name: string | null } | undefined;
    if (!file) return sendError(reply, 404, 'not_found', 'No original file for that assessment.');
    const name = encodeURIComponent(file.original_name ?? 'notification');
    return reply
      .header('Content-Type', file.mime)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${name}`)
      .send(createReadStream(file.path));
  });
}

export { CanvasError };
