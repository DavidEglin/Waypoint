import { CanvasClient, CanvasError, type CanvasAssignment, type CanvasCriterion } from './canvas.js';
import { MIME_BY_KIND, assertNotTooLong, extractDocxText, extractPdfText, hasUsableText, htmlToPlainText, sniffKind } from './extract.js';
import { ReadError } from './claude.js';

const MAX_LINKED_FILES = 3;
const MAX_LINKED_FILE_BYTES = 15 * 1024 * 1024;

export interface CanvasNotification {
  text: string;
  /** Canvas's own due date for the assignment, if it has one. */
  dueAt: string | null;
}

function rubricText(rubric: CanvasCriterion[] | null | undefined): string {
  if (!rubric?.length) return '';
  const lines = rubric.map((c) => {
    const head = [c.description, c.long_description].filter(Boolean).join(': ');
    const ratings = (c.ratings ?? [])
      .map((r) => [r.description, r.long_description].filter(Boolean).join(': '))
      .filter(Boolean)
      .map((r) => `    - ${r}`);
    return [`- ${head || '(unnamed criterion)'}${c.points !== undefined ? ` (${c.points} points)` : ''}`, ...ratings].join('\n');
  });
  return `Rubric criteria:\n${lines.join('\n')}`;
}

/** Canvas file ids referenced from the assignment's HTML (links and data-api-endpoint attributes). */
export function linkedFileIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\/files\/(\d+)/g)) ids.add(m[1]!);
  return [...ids].slice(0, MAX_LINKED_FILES);
}

/**
 * The official notification is rarely one field, so gather every candidate source into one text:
 * the assignment description, its rubric, and any PDF/Word files linked from the description.
 */
export async function assembleCanvasNotification(
  canvas: CanvasClient,
  course: { canvasCourseId: string; name: string },
  assignmentId: string,
  timezone: string,
): Promise<CanvasNotification> {
  const assignment: CanvasAssignment = await canvas.getAssignment(course.canvasCourseId, assignmentId);
  const html = assignment.description ?? '';
  const sections: string[] = [`Assignment (Canvas): ${assignment.name}`, `Course (Canvas): ${course.name}`];

  if (assignment.due_at) {
    const local = new Intl.DateTimeFormat('en-AU', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(assignment.due_at));
    sections.push(`Due date (Canvas): ${local} (${timezone})`);
  }
  if (assignment.points_possible) sections.push(`Points possible: ${assignment.points_possible}`);

  // Weighting lives in the assignment group, when the course uses weighted groups.
  if (assignment.assignment_group_id) {
    try {
      const group = (await canvas.listAssignmentGroups(course.canvasCourseId)).find((g) => g.id === assignment.assignment_group_id);
      if (group?.group_weight) sections.push(`Assignment group (Canvas): ${group.name}, weight ${group.group_weight}%`);
    } catch (err) {
      if (!(err instanceof CanvasError)) throw err; // group weights are a bonus; a Canvas hiccup here is not fatal
    }
  }

  const description = htmlToPlainText(html);
  if (description) sections.push(`Description:\n${description}`);
  const rubric = rubricText(assignment.rubric);
  if (rubric) sections.push(rubric);

  let fileSections = 0;
  for (const id of linkedFileIds(html)) {
    try {
      const file = await canvas.getFile(id);
      if (file.locked_for_user) continue;
      const buf = await canvas.download(file, MAX_LINKED_FILE_BYTES);
      const kind = sniffKind(buf);
      let text = '';
      if (kind === 'docx') text = await extractDocxText(buf);
      else if (kind === 'pdf') text = await extractPdfText(buf);
      if (hasUsableText(text)) {
        sections.push(`Attached file "${file.display_name}" (${MIME_BY_KIND[kind!]}):\n${text}`);
        fileSections++;
      }
    } catch (err) {
      // A linked file that cannot be fetched or read is skipped; the rest of the notification still counts.
      if (err instanceof CanvasError && err.code === 'rate_limited') throw err;
    }
  }

  if (!description && !rubric && fileSections === 0) throw new ReadError('no_text');
  const text = sections.join('\n\n');
  assertNotTooLong(text);
  return { text, dueAt: assignment.due_at ?? null };
}
