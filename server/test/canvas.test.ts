import { describe, expect, it } from 'vitest';
import { linkedFileIds } from '../src/notification.js';
import { adminCookie, call, claudeBody, claudeCalls, connect, createCtx, type TestCtx } from './helpers.js';
import { claudeReply, geographyParsed, jsonResponse, makeDocx } from './fixtures.js';

const BASE = 'https://canvas.school.edu';
const CDN = 'https://files.cdn-example.test/dl/777?sig=abc';

const attachedDocx = makeDocx(['Attached notification: Part A research notes due Wednesday 23 September.']);

const assignment = {
  id: 5001,
  name: 'Midterm Exam',
  due_at: '2026-09-25T04:00:00Z',
  points_possible: 30,
  assignment_group_id: 9,
  description:
    '<h2>Midterm</h2><p>See the <a href="https://canvas.school.edu/courses/101/files/777/download?wrap=1" data-api-endpoint="https://canvas.school.edu/api/v1/courses/101/files/777">notification</a>.</p><p>Bring a pen.</p>',
  rubric: [
    { description: 'Atmospheric circulation', long_description: 'Explains the global pattern of winds', points: 10, ratings: [{ description: 'Full marks', long_description: 'Detailed, accurate explanation' }] },
    { description: 'Communication', long_description: 'Uses a range of examples', points: 5 },
  ],
};

/** A pretend Canvas plus Claude, routed by URL. Records anything we want to inspect. */
function network(ctx: TestCtx, overrides: Record<string, () => Response> = {}, claudeParsed: unknown = geographyParsed) {
  ctx.setFetch((url, init) => {
    for (const [prefix, respond] of Object.entries(overrides)) if (url.startsWith(prefix)) return respond();
    if (url.includes('/v1/messages')) return claudeReply(claudeParsed);
    if (url === CDN) return new Response(new Uint8Array(attachedDocx), { status: 200 });
    if (url.startsWith(`${BASE}/api/v1/courses?`)) {
      return jsonResponse([{ id: 101, name: 'GEOG201 Human & Physical Geography', course_code: 'GEOG201' }, { id: 102, name: 'Mathematics 8', course_code: 'MATH8' }]);
    }
    if (url.startsWith(`${BASE}/api/v1/courses/101/assignments?`)) return jsonResponse([{ id: 5001, name: 'Midterm Exam', due_at: '2026-09-25T04:00:00Z' }]);
    if (url.startsWith(`${BASE}/api/v1/courses/102/assignments?page=2`)) return jsonResponse([{ id: 6002, name: 'Algebra quiz', due_at: '2026-09-30T04:00:00Z' }]);
    if (url.startsWith(`${BASE}/api/v1/courses/102/assignments?`)) {
      return jsonResponse([{ id: 6001, name: 'Fractions test', due_at: '2026-09-22T04:00:00Z' }], 200, {
        link: `<${BASE}/api/v1/courses/102/assignments?page=2&per_page=100>; rel="next", <${BASE}/api/v1/courses/102/assignments?page=1>; rel="first"`,
      });
    }
    if (url === `${BASE}/api/v1/courses/101/assignments/5001`) return jsonResponse(assignment);
    if (url === `${BASE}/api/v1/courses/101/assignment_groups?per_page=100`) return jsonResponse([{ id: 9, name: 'Exams', group_weight: 30 }]);
    if (url === `${BASE}/api/v1/files/777`) return jsonResponse({ id: 777, display_name: 'notification.docx', size: attachedDocx.length, url: CDN });
    void init;
    return new Response('not found', { status: 404 });
  });
}

async function setup() {
  const ctx = await createCtx();
  const cookie = await adminCookie(ctx);
  await connect(ctx, cookie, { canvas: true });
  network(ctx);
  return { ctx, cookie };
}

describe('linkedFileIds', () => {
  it('finds each Canvas file once, from links and API endpoints, capped at three', () => {
    const html = '<a href="/courses/1/files/11/download">a</a> <a data-api-endpoint="https://c.test/api/v1/courses/1/files/11">a</a> /files/22 /files/33 /files/44';
    expect(linkedFileIds(html)).toEqual(['11', '22', '33']);
    expect(linkedFileIds('<p>no files here</p>')).toEqual([]);
  });
});

describe('finding assessments in Canvas', () => {
  it('lists upcoming work across courses in due-date order, following pagination', async () => {
    const { ctx, cookie } = await setup();
    const r = await call(ctx, 'GET', '/api/canvas/assessments', { cookie });
    expect(r.status).toBe(200);
    expect(r.json.courses.map((c: any) => c.name)).toEqual(['GEOG201 Human & Physical Geography', 'Mathematics 8']);
    expect(r.json.items.map((i: any) => [i.name, i.courseName])).toEqual([
      ['Fractions test', 'Mathematics 8'],
      ['Midterm Exam', 'GEOG201 Human & Physical Geography'],
      ['Algebra quiz', 'Mathematics 8'],
    ]);
    expect(r.json.items[0]).toMatchObject({ canvasAssignmentId: '6001', addedAssessmentId: null });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM courses').get()).toEqual({ n: 2 });
  });

  it('marks assignments that were already added', async () => {
    const { ctx, cookie } = await setup();
    const found = (await call(ctx, 'GET', '/api/canvas/assessments', { cookie })).json;
    const course = found.courses[0];
    const added = await call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body: { courseId: course.id, canvasAssignmentId: '5001' } });
    const again = (await call(ctx, 'GET', '/api/canvas/assessments', { cookie })).json;
    expect(again.items.find((i: any) => i.canvasAssignmentId === '5001').addedAssessmentId).toBe(added.json.id);
  });

  it('carries on when one course cannot be read, but reports a total failure', async () => {
    const { ctx, cookie } = await setup();
    network(ctx, { [`${BASE}/api/v1/courses/102/assignments`]: () => jsonResponse({}, 403) });
    const partial = await call(ctx, 'GET', '/api/canvas/assessments', { cookie });
    expect(partial.status).toBe(200);
    expect(partial.json.items.map((i: any) => i.name)).toEqual(['Midterm Exam']);

    network(ctx, { [`${BASE}/api/v1/courses`]: () => jsonResponse({}, 401) });
    const down = await call(ctx, 'GET', '/api/canvas/assessments', { cookie });
    expect(down.status).toBe(502);
    expect(down.json.error).toBe('bad_credentials');
  });

  it('will not follow a "next" link to another host', async () => {
    const { ctx, cookie } = await setup();
    network(ctx, {
      [`${BASE}/api/v1/courses?`]: () => jsonResponse([{ id: 101, name: 'GEOG201', course_code: 'G' }], 200, { link: '<https://evil.example/steal>; rel="next"' }),
    });
    const r = await call(ctx, 'GET', '/api/canvas/assessments', { cookie });
    expect(r.status).toBe(200);
    expect(ctx.fetchCalls.some((c) => c.url.includes('evil.example'))).toBe(false);
  });

  it('needs Canvas connected, and sign-in', async () => {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);
    expect((await call(ctx, 'GET', '/api/canvas/assessments', { cookie })).json.error).toBe('no_canvas');
    expect((await call(ctx, 'GET', '/api/canvas/assessments')).status).toBe(401);
  });

  it('sends the Canvas token only to the Canvas address, never to the file host', async () => {
    const { ctx, cookie } = await setup();
    const found = (await call(ctx, 'GET', '/api/canvas/assessments', { cookie })).json;
    await call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body: { courseId: found.courses[0].id, canvasAssignmentId: '5001' } });
    await ctx.app.jobs.drain();
    const auth = (c: { init: RequestInit }) => new Headers(c.init.headers).get('authorization');
    const toCanvas = ctx.fetchCalls.filter((c) => c.url.startsWith(BASE));
    const toCdn = ctx.fetchCalls.filter((c) => c.url === CDN);
    expect(toCanvas.length).toBeGreaterThan(3);
    expect(toCanvas.every((c) => auth(c) === 'Bearer 1234~canvas-token')).toBe(true);
    expect(toCdn).toHaveLength(1);
    expect(auth(toCdn[0]!)).toBeNull();
    expect(ctx.fetchCalls.filter((c) => c.url.includes('api.anthropic.com')).every((c) => auth(c) === null)).toBe(true);
  });
});

describe('adding an assessment from Canvas', () => {
  async function addFirst(ctx: TestCtx, cookie: string) {
    const found = (await call(ctx, 'GET', '/api/canvas/assessments', { cookie })).json;
    const r = await call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body: { courseId: found.courses[0].id, canvasAssignmentId: '5001' } });
    expect(r.status, r.res.body).toBe(202);
    await ctx.app.jobs.drain();
    return { id: r.json.id as number, courseId: found.courses[0].id as number };
  }

  it('gathers the description, rubric, group weight and the linked Word file into what Claude reads', async () => {
    const { ctx, cookie } = await setup();
    const { id } = await addFirst(ctx, cookie);
    const sent = claudeBody(claudeCalls(ctx)[0]!).messages[0].content as string;

    expect(sent).toContain('Assignment (Canvas): Midterm Exam');
    expect(sent).toContain('Course (Canvas): GEOG201 Human & Physical Geography');
    expect(sent).toContain('Bring a pen.');
    expect(sent).toContain('Assignment group (Canvas): Exams, weight 30%');
    expect(sent).toContain('Atmospheric circulation: Explains the global pattern of winds (10 points)');
    expect(sent).toContain('Detailed, accurate explanation');
    expect(sent).toContain('Attached file "notification.docx"');
    expect(sent).toContain('Part A research notes due Wednesday 23 September');
    // Converted to the student's zone (04:00Z is 2 pm in Sydney), whatever punctuation this Node's ICU uses.
    expect(sent).toMatch(/Due date \(Canvas\): .*25 September 2026.*2:00\s?pm \(Australia\/Sydney\)/);
    expect(sent).not.toContain('canvas.school.edu/courses'); // links are stripped

    const a = (await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json;
    expect(a).toMatchObject({ source: 'canvas', readMethod: 'canvas', status: 'needs_check', courseName: 'GEOG201 Human & Physical Geography' });
  });

  it('keeps the name the student sees in Canvas as the title', async () => {
    const { ctx, cookie } = await setup();
    const { id } = await addFirst(ctx, cookie);
    expect((await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json.title).toBe('Midterm Exam');
  });

  it('uses Canvas\'s own due date when the text names none and there is one part', async () => {
    const { ctx, cookie } = await setup();
    network(ctx, {}, { ...geographyParsed, parts: [{ label: 'Exam', description: null, dueDate: null, dueTime: null, dueText: null }] });
    const { id } = await addFirst(ctx, cookie);
    const a = (await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json;
    expect(a.parts).toHaveLength(1);
    expect(a.parts[0]).toMatchObject({ label: 'Exam', dueAt: '2026-09-25T04:00:00.000Z' });
  });

  it('will not add the same assignment twice', async () => {
    const { ctx, cookie } = await setup();
    const { id, courseId } = await addFirst(ctx, cookie);
    const dup = await call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body: { courseId, canvasAssignmentId: '5001' } });
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ error: 'already_added', assessmentId: id });
  });

  it('validates the request and needs both connections', async () => {
    const { ctx, cookie } = await setup();
    const post = (body: unknown) => call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body });
    expect((await post({ courseId: 'x', canvasAssignmentId: '1' })).status).toBe(400);
    expect((await post({ courseId: 1, canvasAssignmentId: '../etc' })).status).toBe(400);
    expect((await post({ courseId: 999, canvasAssignmentId: '5001' })).status).toBe(404);

    await call(ctx, 'DELETE', '/api/connections/canvas', { cookie });
    expect((await post({ courseId: 1, canvasAssignmentId: '5001' })).json.error).toBe('no_canvas');
    await call(ctx, 'DELETE', '/api/connections/claude', { cookie });
    expect((await post({ courseId: 1, canvasAssignmentId: '5001' })).json.error).toBe('no_claude_key');
  });

  it('cannot add an assignment to another student\'s course', async () => {
    const { ctx, cookie } = await setup();
    ctx.db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('other', 'x', 'user')").run();
    ctx.db.prepare("INSERT INTO courses (user_id, canvas_course_id, name, synced_at) VALUES (2, '555', 'Not yours', '2026-09-01T00:00:00Z')").run();
    const r = await call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body: { courseId: 1, canvasAssignmentId: '5001' } });
    expect(r.status).toBe(404); // course 1 does not exist for this user yet
    const foreign = ctx.db.prepare("SELECT id FROM courses WHERE name = 'Not yours'").get() as { id: number };
    expect((await call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body: { courseId: foreign.id, canvasAssignmentId: '5001' } })).status).toBe(404);
  });

  it('reports a Canvas failure when checking the assignment, without creating anything', async () => {
    const { ctx, cookie } = await setup();
    const found = (await call(ctx, 'GET', '/api/canvas/assessments', { cookie })).json;
    network(ctx, { [`${BASE}/api/v1/courses/101/assignments/5001`]: () => jsonResponse({}, 401) });
    const r = await call(ctx, 'POST', '/api/assessments/from-canvas', { cookie, body: { courseId: found.courses[0].id, canvasAssignmentId: '5001' } });
    expect(r.status).toBe(502);
    expect(r.json.error).toBe('bad_credentials');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM assessments').get()).toEqual({ n: 0 });
  });

  it('carries on without a linked file that cannot be fetched, and fails only if nothing at all is readable', async () => {
    const { ctx, cookie } = await setup();
    network(ctx, { [`${BASE}/api/v1/files/777`]: () => jsonResponse({}, 403) });
    const { id } = await addFirst(ctx, cookie);
    expect((await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json.status).toBe('needs_check');
    expect(claudeBody(claudeCalls(ctx)[0]!).messages[0].content).not.toContain('Attached file');

    // An assignment with no description, no rubric and no files has nothing to read.
    const ctx2 = await createCtx();
    const cookie2 = await adminCookie(ctx2);
    await connect(ctx2, cookie2, { canvas: true });
    network(ctx2, { [`${BASE}/api/v1/courses/101/assignments/5001`]: () => jsonResponse({ id: 5001, name: 'Empty', description: '', rubric: null }) });
    const found = (await call(ctx2, 'GET', '/api/canvas/assessments', { cookie: cookie2 })).json;
    const r = await call(ctx2, 'POST', '/api/assessments/from-canvas', { cookie: cookie2, body: { courseId: found.courses[0].id, canvasAssignmentId: '5001' } });
    await ctx2.app.jobs.drain();
    expect((await call(ctx2, 'GET', `/api/assessments/${r.json.id}`, { cookie: cookie2 })).json.errorCode).toBe('no_text');
  });
});
