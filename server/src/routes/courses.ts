import type { FastifyInstance } from 'fastify';
import type { CanvasFoundAssessment, CanvasFoundResponse, CourseInfo } from '@waypoint/shared';
import { READ_ERROR_TEXT } from '@waypoint/shared';
import type { AppDeps } from '../app.js';
import { requireAuth, sendError } from '../auth.js';
import { CanvasClient, CanvasError } from '../canvas.js';
import { ReadError } from '../claude.js';
import { loadSecret } from '../secrets.js';

const MAX_COURSES = 30;

interface CourseRow {
  id: number;
  canvas_course_id: string;
  code: string | null;
  name: string;
}
const toCourse = (r: CourseRow): CourseInfo => ({ id: r.id, canvasCourseId: r.canvas_course_id, code: r.code, name: r.name });

export function courseRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const now = deps.now ?? (() => new Date());

  const cached = (userId: number) =>
    db.prepare('SELECT id, canvas_course_id, code, name FROM courses WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as CourseRow[];

  app.get('/api/courses', { preHandler: requireAuth }, async (request): Promise<CourseInfo[]> => cached(request.auth!.user.id).map(toCourse));

  /** Live look at Canvas: refreshes the student's courses and lists what is coming up. */
  app.get('/api/canvas/assessments', { preHandler: requireAuth }, async (request, reply): Promise<CanvasFoundResponse | undefined> => {
    const userId = request.auth!.user.id;
    try {
      const { secret, baseUrl } = loadSecret(db, config, userId, 'canvas');
      const canvas = new CanvasClient(baseUrl!, secret, deps.fetch);

      const synced = now().toISOString();
      const upsert = db.prepare(
        `INSERT INTO courses (user_id, canvas_course_id, code, name, synced_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, canvas_course_id) DO UPDATE SET code = excluded.code, name = excluded.name, synced_at = excluded.synced_at`,
      );
      for (const c of (await canvas.listCourses()).slice(0, MAX_COURSES)) {
        upsert.run(userId, String(c.id), c.course_code ?? null, c.name ?? `Course ${c.id}`, synced);
      }
      const courses = cached(userId).filter((c) => c.name);

      const added = new Map(
        (db.prepare('SELECT id, canvas_assignment_id FROM assessments WHERE user_id = ? AND canvas_assignment_id IS NOT NULL').all(userId) as {
          id: number;
          canvas_assignment_id: string;
        }[]).map((r) => [r.canvas_assignment_id, r.id]),
      );

      const items: CanvasFoundAssessment[] = [];
      let lastError: CanvasError | null = null;
      let failures = 0;
      // One course at a time: Canvas throttles parallel requests.
      for (const course of courses) {
        try {
          for (const a of await canvas.listUpcomingAssignments(course.canvas_course_id)) {
            items.push({
              courseId: course.id,
              courseName: course.name,
              canvasAssignmentId: String(a.id),
              name: a.name,
              dueAt: a.due_at ?? null,
              addedAssessmentId: added.get(String(a.id)) ?? null,
            });
          }
        } catch (err) {
          if (!(err instanceof CanvasError)) throw err;
          lastError = err; // a course we cannot read should not hide the others
          failures++;
        }
      }
      if (lastError && failures === courses.length && courses.length > 0) throw lastError;

      items.sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
      return { courses: courses.map(toCourse), items };
    } catch (err) {
      if (err instanceof ReadError) {
        await sendError(reply, err.code === 'no_canvas' ? 409 : 502, err.code, READ_ERROR_TEXT[err.code]);
        return undefined;
      }
      throw err;
    }
  });
}
