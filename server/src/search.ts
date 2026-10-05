import type { ReadErrorCode } from '@waypoint/shared';
import { CanvasClient, CanvasError, type CanvasFile, type CanvasModule, type CanvasPage } from './canvas.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { extractDocxText, extractPdfText, hasUsableText, htmlToPlainText, sniffKind } from './extract.js';
import { matchContent, type MatchCandidate } from './match.js';
import { ReadError } from './claude.js';
import { loadSecret } from './secrets.js';

export interface SearchDeps {
  db: Db;
  config: Config;
  fetch?: typeof fetch;
  now: () => Date;
  log?: (msg: string) => void;
}

const MAX_FILES = 25;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const FILE_EXT = /\.(pdf|docx)$/i;

interface AssessmentRow {
  id: number;
  user_id: number;
  course_id: number | null;
  status: string;
}

function fail(db: Db, id: number, code: ReadErrorCode, now: Date): void {
  db.prepare("UPDATE assessments SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ? AND status = 'searching'").run(code, now.toISOString(), id);
}

/** Module name/position for each page url / file id, from the module tree. Module labels are a hint, not load-bearing - a failure to list them is not fatal. */
function moduleIndex(modules: CanvasModule[]): Map<string, { name: string; position: number }> {
  const index = new Map<string, { name: string; position: number }>();
  for (const m of modules) {
    for (const item of m.items ?? []) {
      const key = item.type === 'Page' && item.page_url ? `page:${item.page_url}` : item.type === 'File' && item.content_id ? `file:${item.content_id}` : null;
      if (key) index.set(key, { name: m.name, position: m.position });
    }
  }
  return index;
}

/** Job handler: crawl a confirmed assessment's course (Pages + Files, Modules for labels) and match it against the assessment's keyword topics. */
export async function searchCourse(deps: SearchDeps, assessmentId: number): Promise<void> {
  const { db, config } = deps;
  const a = db.prepare('SELECT id, user_id, course_id, status FROM assessments WHERE id = ?').get(assessmentId) as AssessmentRow | undefined;
  if (!a || a.status !== 'searching') return; // deleted, or already handled

  try {
    const topics = db.prepare('SELECT text, kind FROM topics WHERE assessment_id = ?').all(a.id) as { text: string; kind: 'keyword' | 'skill' }[];
    const course = a.course_id
      ? (db.prepare('SELECT canvas_course_id FROM courses WHERE id = ?').get(a.course_id) as { canvas_course_id: string } | undefined)
      : undefined;

    let results: ReturnType<typeof matchContent> = [];
    // Nothing to search for (no keyword topics) or nothing to search in (no linked course, e.g. a manual
    // upload with no course chosen): not an error, just an empty folder.
    if (course && topics.some((t) => t.kind === 'keyword')) {
      const { secret, baseUrl } = loadSecret(db, config, a.user_id, 'canvas');
      const canvas = new CanvasClient(baseUrl!, secret, deps.fetch);

      let lastError: CanvasError | null = null;
      let failures = 0;
      const guarded = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          if (!(err instanceof CanvasError)) throw err;
          if (err.code === 'rate_limited') throw err; // back off rather than hammer a limited course further
          lastError = err; // one list we cannot read should not hide the others
          failures++;
          return [];
        }
      };

      const modules = await guarded(() => canvas.listModules(course.canvas_course_id));
      const pages = await guarded(() => canvas.listPages(course.canvas_course_id));
      const files = await guarded(() => canvas.listFiles(course.canvas_course_id));
      if (failures === 3) throw lastError!; // modules, pages and files all failed: the course truly could not be read

      const index = moduleIndex(modules);
      const candidates: MatchCandidate[] = [];

      for (const p of pages) {
        if (p.locked_for_user || !p.body) continue;
        const text = htmlToPlainText(p.body);
        if (!hasUsableText(text)) continue;
        const loc = index.get(`page:${p.url}`);
        candidates.push({ kind: 'page', canvasId: p.url, title: p.title, htmlUrl: p.html_url ?? null, moduleName: loc?.name ?? null, modulePosition: loc?.position ?? Number.MAX_SAFE_INTEGER, text });
      }

      let downloaded = 0;
      for (const f of files) {
        if (downloaded >= MAX_FILES) break;
        if (f.locked_for_user || !FILE_EXT.test(f.display_name)) continue;
        try {
          const fresh = await canvas.getFile(String(f.id));
          if (fresh.locked_for_user) continue;
          const buf = await canvas.download(fresh, MAX_FILE_BYTES);
          const kind = sniffKind(buf);
          if (kind !== 'pdf' && kind !== 'docx') continue;
          const text = kind === 'docx' ? await extractDocxText(buf) : await extractPdfText(buf);
          if (!hasUsableText(text)) continue;
          downloaded++;
          const loc = index.get(`file:${f.id}`);
          const htmlUrl = `${baseUrl}/courses/${course.canvas_course_id}/files/${f.id}`;
          candidates.push({ kind: 'file', canvasId: String(f.id), title: f.display_name, htmlUrl, moduleName: loc?.name ?? null, modulePosition: loc?.position ?? Number.MAX_SAFE_INTEGER, text });
        } catch (err) {
          // A file that cannot be fetched or read is skipped; the rest of the course still counts - except a rate limit, which means stop.
          if (err instanceof CanvasError && err.code === 'rate_limited') throw err;
        }
      }

      results = matchContent(topics, candidates);
    }

    // The student may have deleted it, or re-confirmed it again, while this was running.
    if (!db.prepare('SELECT 1 FROM assessments WHERE id = ? AND status = ?').get(a.id, 'searching')) return;

    db.transaction(() => {
      db.prepare('DELETE FROM folder_items WHERE assessment_id = ?').run(a.id);
      const insert = db.prepare(
        'INSERT INTO folder_items (assessment_id, position, kind, canvas_id, title, html_url, module_name, score, matched_terms, snippet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      results.forEach((r, i) => insert.run(a.id, i, r.kind, r.canvasId, r.title, r.htmlUrl, r.moduleName, r.score, JSON.stringify(r.matchedTerms), r.snippet));
      db.prepare("UPDATE assessments SET status = 'ready', error_code = NULL, updated_at = ? WHERE id = ?").run(deps.now().toISOString(), a.id);
    })();
  } catch (err) {
    const code: ReadErrorCode = err instanceof ReadError ? err.code : 'internal';
    deps.log?.(`assessment ${a.id} failed to search: ${code}${err instanceof Error && err.message !== code ? ` (${err.message})` : ''}`);
    fail(db, a.id, code, deps.now());
  }
}
