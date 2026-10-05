import { describe, expect, it } from 'vitest';
import { adminCookie, call, connect, createCtx } from './helpers.js';
import { jsonResponse, makeDocx, makePdf } from './fixtures.js';

const BASE = 'https://canvas.school.edu';
const PDF_URL = 'https://files.cdn-example.test/dl/501?sig=abc';
const DOCX_URL = 'https://files.cdn-example.test/dl/502?sig=abc';

const modulesResponse = () =>
  jsonResponse([
    {
      id: 9,
      name: 'Week 3: Weather Systems',
      position: 3,
      items: [
        { id: 90, type: 'Page', title: 'Atmospheric circulation', page_url: 'atmospheric-circulation' },
        { id: 91, type: 'File', title: 'Case study', content_id: 501 },
      ],
    },
  ]);

const pagesResponse = () =>
  jsonResponse([
    { url: 'atmospheric-circulation', title: 'Atmospheric circulation', body: '<p>Global winds are driven by atmospheric circulation patterns across the planet.</p>', html_url: `${BASE}/courses/101/pages/atmospheric-circulation` },
    { url: 'unrelated', title: 'Assignment policies', body: '<p>Late work loses ten percent per day, no exceptions without a doctor\'s note.</p>' },
    { url: 'locked', title: 'Locked page', body: '<p>atmospheric circulation</p>', locked_for_user: true },
  ]);

const filesResponse = () =>
  jsonResponse([
    { id: 501, display_name: 'Case study.pdf', 'content-type': 'application/pdf', size: 1000 },
    { id: 502, display_name: 'irrelevant.docx', 'content-type': 'application/octet-stream', size: 500 },
    { id: 503, display_name: 'photo.jpg', 'content-type': 'image/jpeg', size: 2000 },
  ]);

/** A confirmed-but-not-yet-searched assessment, with a course wired to the Canvas mock and one keyword topic. */
async function setup(topics: { text: string; kind: 'keyword' | 'skill' }[] = [{ text: 'atmospheric circulation', kind: 'keyword' }]) {
  const ctx = await createCtx();
  const cookie = await adminCookie(ctx);
  await connect(ctx, cookie, { canvas: true });
  const courseId = Number(ctx.db.prepare("INSERT INTO courses (user_id, canvas_course_id, name, synced_at) VALUES (1, '101', 'Geography 8', '2026-09-01T00:00:00Z')").run().lastInsertRowid);
  const id = Number(
    ctx.db
      .prepare("INSERT INTO assessments (user_id, course_id, title, source, status, read_method) VALUES (1, ?, 'Midterm', 'document', 'needs_check', 'parsed')")
      .run(courseId).lastInsertRowid,
  );
  const insertTopic = ctx.db.prepare('INSERT INTO topics (assessment_id, position, text, kind) VALUES (?, ?, ?, ?)');
  topics.forEach((t, i) => insertTopic.run(id, i, t.text, t.kind));
  return { ctx, cookie, id };
}

const confirmPayload = (overrides: Record<string, unknown> = {}) => ({
  title: 'Midterm Exam',
  courseLabel: null,
  weightingText: null,
  weightingPercent: null,
  aiUse: null,
  needsOwnFocus: false,
  focusPrompt: null,
  chosenFocus: null,
  parts: [],
  topics: [{ text: 'atmospheric circulation', kind: 'keyword' }],
  ...overrides,
});

describe('searching a confirmed assessment\'s course', () => {
  it('matches pages and files against the keyword topics, labels them with their module, and skips what does not match', async () => {
    const { ctx, cookie, id } = await setup();
    ctx.setFetch((url) => {
      if (url.startsWith(`${BASE}/api/v1/courses/101/modules?`)) return modulesResponse();
      if (url.startsWith(`${BASE}/api/v1/courses/101/pages?`)) return pagesResponse();
      if (url.startsWith(`${BASE}/api/v1/courses/101/files?`)) return filesResponse();
      if (url === `${BASE}/api/v1/files/501`) return jsonResponse({ id: 501, display_name: 'Case study.pdf', size: 999, url: PDF_URL });
      if (url === `${BASE}/api/v1/files/502`) return jsonResponse({ id: 502, display_name: 'irrelevant.docx', size: 999, url: DOCX_URL });
      if (url === PDF_URL) return new Response(new Uint8Array(makePdf(['Atmospheric circulation case study: coastal wind patterns.'])), { status: 200 });
      if (url === DOCX_URL) return new Response(new Uint8Array(makeDocx(['Nothing to do with the topic at hand.'])), { status: 200 });
      return new Response('not found', { status: 404 });
    });

    const r = await call(ctx, 'POST', `/api/assessments/${id}/confirm`, { cookie, body: confirmPayload() });
    expect(r.status, r.res.body).toBe(200);
    expect(r.json.status).toBe('searching');
    await ctx.app.jobs.drain();

    const a = (await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json;
    expect(a.status).toBe('ready');
    expect(a.errorCode).toBeNull();
    expect(a.folderItems).toHaveLength(2);
    expect(a.folderItems[0]).toMatchObject({ kind: 'page', title: 'Atmospheric circulation', moduleName: 'Week 3: Weather Systems', matchedTerms: ['atmospheric circulation'] });
    expect(a.folderItems[0].snippet).toContain('atmospheric circulation');
    expect(a.folderItems[1]).toMatchObject({ kind: 'file', title: 'Case study.pdf', moduleName: 'Week 3: Weather Systems', matchedTerms: ['atmospheric circulation'] });
    // Unrelated page, the irrelevant docx, the locked page, and the non-pdf/docx photo must not appear.
    expect(a.folderItems.map((f: any) => f.title)).not.toContain('Assignment policies');
    expect(a.folderItems.map((f: any) => f.title)).not.toContain('Locked page');
    expect(a.folderItems.map((f: any) => f.title)).not.toContain('irrelevant.docx');
  });

  it('skips skill-kind topics and produces an empty, non-error folder when only skills are given', async () => {
    const { ctx, cookie, id } = await setup([{ text: 'communicates clearly', kind: 'skill' }]);
    ctx.setFetch(() => new Response('should not be called', { status: 500 }));
    await call(ctx, 'POST', `/api/assessments/${id}/confirm`, { cookie, body: confirmPayload({ topics: [{ text: 'communicates clearly', kind: 'skill' }] }) });
    await ctx.app.jobs.drain();
    const a = (await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json;
    expect(a).toMatchObject({ status: 'ready', folderItems: [] });
  });

  it('keeps what it found even when one list (files) fails, as long as not everything did', async () => {
    const { ctx, cookie, id } = await setup();
    ctx.setFetch((url) => {
      if (url.startsWith(`${BASE}/api/v1/courses/101/modules?`)) return modulesResponse();
      if (url.startsWith(`${BASE}/api/v1/courses/101/pages?`)) return pagesResponse();
      if (url.startsWith(`${BASE}/api/v1/courses/101/files?`)) return jsonResponse({}, 403);
      return new Response('not found', { status: 404 });
    });
    await call(ctx, 'POST', `/api/assessments/${id}/confirm`, { cookie, body: confirmPayload() });
    await ctx.app.jobs.drain();
    const a = (await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json;
    expect(a.status).toBe('ready');
    expect(a.folderItems).toEqual([expect.objectContaining({ kind: 'page', title: 'Atmospheric circulation' })]);
  });

  it('fails (not an empty success) when the whole course cannot be read', async () => {
    const { ctx, cookie, id } = await setup();
    ctx.setFetch(() => jsonResponse({}, 401));
    await call(ctx, 'POST', `/api/assessments/${id}/confirm`, { cookie, body: confirmPayload() });
    await ctx.app.jobs.drain();
    const a = (await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json;
    expect(a).toMatchObject({ status: 'failed', errorCode: 'bad_credentials' });
  });

  it('a search failure can be retried, and only re-runs the search (not the original read)', async () => {
    const { ctx, cookie, id } = await setup();
    ctx.setFetch(() => jsonResponse({}, 401));
    await call(ctx, 'POST', `/api/assessments/${id}/confirm`, { cookie, body: confirmPayload() });
    await ctx.app.jobs.drain();
    expect((await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json.status).toBe('failed');

    ctx.setFetch((url) => {
      if (url.startsWith(`${BASE}/api/v1/courses/101/modules?`)) return modulesResponse();
      if (url.startsWith(`${BASE}/api/v1/courses/101/pages?`)) return pagesResponse();
      if (url.startsWith(`${BASE}/api/v1/courses/101/files?`)) return jsonResponse([]);
      return new Response('not found', { status: 404 });
    });
    const retry = await call(ctx, 'POST', `/api/assessments/${id}/retry`, { cookie });
    expect(retry.status, retry.res.body).toBe(200);
    expect(retry.json.status).toBe('searching');
    await ctx.app.jobs.drain();
    const a = (await call(ctx, 'GET', `/api/assessments/${id}`, { cookie })).json;
    expect(a.status).toBe('ready');
    expect(a.title).toBe('Midterm Exam'); // the title from confirm() - retry only re-runs the search, it does not re-save the fields
  });
});
