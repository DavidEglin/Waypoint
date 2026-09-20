import { readFileSync } from 'node:fs';
import type { ReadErrorCode, ReadMethod } from '@waypoint/shared';
import { CanvasClient } from './canvas.js';
import { ReadError, makeClaudeClient } from './claude.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { assertNotTooLong, extractDocxText, extractPdfText, hasUsableText, isImage, sniffKind } from './extract.js';
import { assembleCanvasNotification } from './notification.js';
import { parseNotification, type ParseInput, type ParsedAssessment } from './parse.js';
import { loadSecret } from './secrets.js';
import { todayIn, zonedToUtc } from './timezone.js';

export interface ReadDeps {
  db: Db;
  config: Config;
  fetch?: typeof fetch;
  now: () => Date;
  claudeRetries?: number;
  log?: (msg: string) => void;
}

interface AssessmentRow {
  id: number;
  user_id: number;
  course_id: number | null;
  source: 'canvas' | 'photo' | 'document';
  canvas_assignment_id: string | null;
  status: string;
}

interface Gathered {
  input: ParseInput;
  method: ReadMethod;
  /** The notification's text, when we have it as text. Photos get it back from Claude's transcript. */
  text: string | null;
  canvasDueAt: string | null;
}

async function gather(deps: ReadDeps, a: AssessmentRow): Promise<Gathered> {
  const { db, config } = deps;

  if (a.source === 'canvas') {
    const { secret, baseUrl } = loadSecret(db, config, a.user_id, 'canvas');
    const course = db.prepare('SELECT canvas_course_id, name FROM courses WHERE id = ?').get(a.course_id) as
      | { canvas_course_id: string; name: string }
      | undefined;
    if (!course || !a.canvas_assignment_id) throw new ReadError('internal');
    const notification = await assembleCanvasNotification(
      new CanvasClient(baseUrl!, secret, deps.fetch),
      { canvasCourseId: course.canvas_course_id, name: course.name },
      a.canvas_assignment_id,
      config.timezone,
    );
    return { input: { mode: 'text', text: notification.text }, method: 'canvas', text: notification.text, canvasDueAt: notification.dueAt };
  }

  const file = db.prepare('SELECT path FROM source_files WHERE assessment_id = ?').get(a.id) as { path: string } | undefined;
  if (!file) throw new ReadError('internal');
  let buf: Buffer;
  try {
    buf = readFileSync(file.path);
  } catch {
    throw new ReadError('unreadable');
  }
  const kind = sniffKind(buf);
  if (!kind) throw new ReadError('unreadable');

  if (isImage(kind)) {
    return { input: { mode: 'image', data: buf, mediaType: `image/${kind}` }, method: 'vision', text: null, canvasDueAt: null };
  }
  const text = kind === 'docx' ? await extractDocxText(buf) : await extractPdfText(buf);
  if (kind === 'pdf' && !hasUsableText(text)) {
    // No text layer: a scan. Claude reads the pages directly.
    return { input: { mode: 'pdf', data: buf }, method: 'vision', text: null, canvasDueAt: null };
  }
  if (!hasUsableText(text)) throw new ReadError('no_text');
  return { input: { mode: 'text', text }, method: 'parsed', text, canvasDueAt: null };
}

function save(deps: ReadDeps, a: AssessmentRow, parsed: ParsedAssessment, g: Gathered): void {
  const { db, config } = deps;
  const nowIso = deps.now().toISOString();

  const parts = parsed.parts.map((p) => {
    let dueAt: string | null = null;
    let hasTime = true;
    if (p.dueDate) {
      hasTime = p.dueTime !== null;
      // A date with no time of day means "by the end of that day".
      dueAt = zonedToUtc(p.dueDate, p.dueTime ?? '23:59', config.timezone).toISOString();
    }
    return { ...p, dueAt, hasTime };
  });
  // Canvas knows the due date exactly. Use it when the text named none and there is just one part.
  if (g.canvasDueAt && parts.length <= 1 && !parts.some((p) => p.dueAt)) {
    if (parts.length === 0) parts.push({ label: 'Due', description: null, dueDate: null, dueTime: null, dueText: null, dueAt: null, hasTime: true });
    parts[0]!.dueAt = new Date(g.canvasDueAt).toISOString();
  }

  db.transaction(() => {
    // Title: Canvas assessments keep the name the student sees in Canvas.
    const titleSql = a.source === 'canvas' ? 'title' : '?';
    db.prepare(
      `UPDATE assessments SET title = ${titleSql}, course_label = ?, weighting_text = ?, weighting_percent = ?, ai_use = ?,
         needs_own_focus = ?, focus_prompt = ?, source_text = ?, read_method = ?, status = 'needs_check', error_code = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      ...(a.source === 'canvas' ? [] : [parsed.title]),
      parsed.course,
      parsed.weightingText,
      parsed.weightingPercent,
      parsed.aiUse,
      parsed.needsOwnFocus ? 1 : 0,
      parsed.focusPrompt,
      g.text ?? parsed.transcript,
      g.method,
      nowIso,
      a.id,
    );
    db.prepare('DELETE FROM assessment_parts WHERE assessment_id = ?').run(a.id);
    db.prepare('DELETE FROM topics WHERE assessment_id = ?').run(a.id);
    const insertPart = db.prepare(
      'INSERT INTO assessment_parts (assessment_id, position, label, description, due_at, due_has_time, due_text) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    parts.forEach((p, i) => insertPart.run(a.id, i, p.label, p.description, p.dueAt, p.hasTime ? 1 : 0, p.dueText));
    const insertTopic = db.prepare('INSERT INTO topics (assessment_id, position, text, kind) VALUES (?, ?, ?, ?)');
    parsed.topics.forEach((t, i) => insertTopic.run(a.id, i, t.text, t.kind));
  })();
}

function fail(db: Db, id: number, code: ReadErrorCode, now: Date): void {
  db.prepare("UPDATE assessments SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ? AND status = 'reading'").run(
    code,
    now.toISOString(),
    id,
  );
}

/** Job handler: read one assessment's notification and leave it ready for the student to check. */
export async function readNotification(deps: ReadDeps, assessmentId: number): Promise<void> {
  const { db, config } = deps;
  const a = db.prepare('SELECT id, user_id, course_id, source, canvas_assignment_id, status FROM assessments WHERE id = ?').get(assessmentId) as
    | AssessmentRow
    | undefined;
  if (!a || a.status !== 'reading') return; // deleted, or already handled

  try {
    const claudeKey = loadSecret(db, config, a.user_id, 'claude').secret;
    const gathered = await gather(deps, a);
    if (gathered.input.mode === 'text') {
      if (!gathered.input.text.trim()) throw new ReadError('no_text');
      assertNotTooLong(gathered.input.text);
    }
    const client = makeClaudeClient(claudeKey, { fetch: deps.fetch, baseURL: config.claudeApiBase, maxRetries: deps.claudeRetries });
    const parsed = await parseNotification(client, config.claudeModel, gathered.input, {
      today: todayIn(config.timezone, deps.now()),
      timezone: config.timezone,
    });
    if (gathered.input.mode !== 'text' && !parsed.transcript && parsed.topics.length === 0 && parsed.parts.length === 0) {
      throw new ReadError('no_text');
    }
    // The student may have deleted it while Claude was reading.
    if (!db.prepare('SELECT 1 FROM assessments WHERE id = ? AND status = ?').get(a.id, 'reading')) return;
    save(deps, a, parsed, gathered);
  } catch (err) {
    if (err instanceof ReadError) fail(db, a.id, err.code, deps.now());
    else {
      deps.log?.(`unexpected error reading assessment ${a.id}: ${err instanceof Error ? err.name : 'unknown'}`);
      fail(db, a.id, 'internal', deps.now());
    }
  }
}
