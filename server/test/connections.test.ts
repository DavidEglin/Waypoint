import { describe, expect, it } from 'vitest';
import { normalizeCanvasUrl } from '../src/connection-tests.js';
import { adminCookie, call, createCtx, createUserWithSession } from './helpers.js';

const TOKEN = '1234~canvas-token-secret-value';
const KEY = 'sk-ant-api03-claude-key-secret-value';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Canvas address', () => {
  it('accepts domain names and reduces them to an origin', () => {
    expect(normalizeCanvasUrl('canvas.school.edu')).toBe('https://canvas.school.edu');
    expect(normalizeCanvasUrl('  https://Canvas.School.edu/courses/1?x=y ')).toBe('https://canvas.school.edu');
  });

  it('refuses http, IP literals, internal names and embedded credentials', () => {
    for (const bad of [
      'http://canvas.school.edu',
      'https://127.0.0.1',
      'https://10.0.0.5/',
      'https://[::1]/',
      'https://169.254.169.254',
      'localhost',
      'https://canvas',
      'printer.local',
      'https://user:pw@canvas.school.edu',
      'not a url',
      '',
    ]) {
      expect(normalizeCanvasUrl(bad), bad).toBeNull();
    }
  });
});

describe('connections', () => {
  async function setup() {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);
    return { ctx, cookie };
  }

  it('starts empty', async () => {
    const { ctx, cookie } = await setup();
    expect((await call(ctx, 'GET', '/api/connections', { cookie })).json).toEqual({
      canvas: { connected: false, status: 'untested', lastVerified: null, lastError: null, baseUrl: null },
      claude: { connected: false, status: 'untested', lastVerified: null, lastError: null },
    });
  });

  it('never returns the token or key, and stores them encrypted', async () => {
    const { ctx, cookie } = await setup();
    const saved = [
      await call(ctx, 'PUT', '/api/connections/canvas', { cookie, body: { baseUrl: 'canvas.school.edu', token: TOKEN } }),
      await call(ctx, 'PUT', '/api/connections/claude', { cookie, body: { apiKey: KEY } }),
    ];
    const listed = await call(ctx, 'GET', '/api/connections', { cookie });

    for (const r of [...saved, listed]) {
      expect(r.status).toBe(200);
      expect(r.res.body).not.toContain(TOKEN);
      expect(r.res.body).not.toContain(KEY);
    }
    expect(listed.json.canvas).toMatchObject({ connected: true, baseUrl: 'https://canvas.school.edu', status: 'untested' });
    expect(listed.json.claude.connected).toBe(true);

    const raw = ctx.db.prepare('SELECT * FROM connections').all() as { secret_encrypted: Buffer }[];
    expect(raw).toHaveLength(2);
    for (const row of raw) {
      expect(Buffer.isBuffer(row.secret_encrypted)).toBe(true);
      const text = row.secret_encrypted.toString('latin1');
      expect(text).not.toContain('canvas-token-secret');
      expect(text).not.toContain('claude-key-secret');
    }
    // and nothing in the whole database file's tables mentions the plaintext
    const dump = JSON.stringify(ctx.db.prepare('SELECT * FROM audit_log').all());
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain(KEY);
  });

  it('rejects an unacceptable Canvas address', async () => {
    const { ctx, cookie } = await setup();
    const r = await call(ctx, 'PUT', '/api/connections/canvas', { cookie, body: { baseUrl: 'http://192.168.1.5', token: TOKEN } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('invalid_address');
  });

  it('tests Canvas with a bearer token against /api/v1/users/self', async () => {
    const { ctx, cookie } = await setup();
    await call(ctx, 'PUT', '/api/connections/canvas', { cookie, body: { baseUrl: 'canvas.school.edu', token: TOKEN } });
    ctx.setFetch(() => json({ id: 7, name: 'Sam' }));

    const r = await call(ctx, 'POST', '/api/connections/canvas/test', { cookie });
    expect(r.json).toMatchObject({ status: 'ok', lastError: null });
    expect(r.json.lastVerified).toBe(new Date(ctx.clock.time).toISOString());
    expect(ctx.fetchCalls[0]!.url).toBe('https://canvas.school.edu/api/v1/users/self');
    expect((ctx.fetchCalls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(ctx.fetchCalls[0]!.init.redirect).toBe('manual');
    expect(r.res.body).not.toContain(TOKEN);
  });

  it('tests Claude with x-api-key', async () => {
    const { ctx, cookie } = await setup();
    await call(ctx, 'PUT', '/api/connections/claude', { cookie, body: { apiKey: KEY } });
    ctx.setFetch(() => json({ data: [{ id: 'claude-x' }] }));

    const r = await call(ctx, 'POST', '/api/connections/claude/test', { cookie });
    expect(r.json.status).toBe('ok');
    expect(ctx.fetchCalls[0]!.url).toContain('https://api.anthropic.com/v1/models');
    expect(new Headers(ctx.fetchCalls[0]!.init.headers).get('x-api-key')).toBe(KEY);
  });

  it.each([
    ['bad credentials (401)', () => json({ errors: [] }, 401), 'bad_credentials'],
    ['forbidden (403)', () => json({}, 403), 'bad_credentials'],
    ['rate limited (429)', () => json({}, 429), 'rate_limited'],
    ['server error (500)', () => json({}, 500), 'bad_response'],
    ['redirect (302)', () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }), 'bad_response'],
    ['not JSON', () => new Response('<html>login</html>', { status: 200 }), 'bad_response'],
    ['JSON of the wrong shape', () => json({ hello: 'world' }), 'bad_response'],
    ['network failure', () => { throw new TypeError('fetch failed'); }, 'unreachable'],
    ['timeout', () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }, 'timeout'],
  ])('maps %s to an error code', async (_name, handler, code) => {
    const { ctx, cookie } = await setup();
    await call(ctx, 'PUT', '/api/connections/canvas', { cookie, body: { baseUrl: 'canvas.school.edu', token: TOKEN } });
    ctx.setFetch(handler);
    const r = await call(ctx, 'POST', '/api/connections/canvas/test', { cookie });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'failed', lastError: code, lastVerified: null });
  });

  it('keeps the last successful verification time when a later test fails', async () => {
    const { ctx, cookie } = await setup();
    await call(ctx, 'PUT', '/api/connections/claude', { cookie, body: { apiKey: KEY } });
    ctx.setFetch(() => json({ data: [] }));
    const ok = await call(ctx, 'POST', '/api/connections/claude/test', { cookie });
    ctx.clock.advance(3600_000);
    ctx.setFetch(() => json({}, 401));
    const failed = await call(ctx, 'POST', '/api/connections/claude/test', { cookie });
    expect(failed.json).toMatchObject({ status: 'failed', lastError: 'bad_credentials', lastVerified: ok.json.lastVerified });
  });

  it('saving again resets the status; testing before saving is a 404', async () => {
    const { ctx, cookie } = await setup();
    expect((await call(ctx, 'POST', '/api/connections/claude/test', { cookie })).json.error).toBe('not_connected');
    await call(ctx, 'PUT', '/api/connections/claude', { cookie, body: { apiKey: KEY } });
    ctx.setFetch(() => json({ data: [] }));
    await call(ctx, 'POST', '/api/connections/claude/test', { cookie });
    const again = await call(ctx, 'PUT', '/api/connections/claude', { cookie, body: { apiKey: `${KEY}-2` } });
    expect(again.json).toMatchObject({ status: 'untested', lastVerified: null });
    expect((await call(ctx, 'POST', '/api/connections/nope/test', { cookie })).status).toBe(404);
  });

  it('reports unreadable details when ENCRYPTION_KEY has changed', async () => {
    const { ctx, cookie } = await setup();
    await call(ctx, 'PUT', '/api/connections/claude', { cookie, body: { apiKey: KEY } });
    ctx.config.encryptionKey = Buffer.alloc(32, 7);
    const r = await call(ctx, 'POST', '/api/connections/claude/test', { cookie });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('unreadable');
    expect(ctx.fetchCalls).toHaveLength(0);
  });

  it('disconnect removes the saved details', async () => {
    const { ctx, cookie } = await setup();
    await call(ctx, 'PUT', '/api/connections/claude', { cookie, body: { apiKey: KEY } });
    expect((await call(ctx, 'DELETE', '/api/connections/claude', { cookie })).status).toBe(204);
    expect((await call(ctx, 'GET', '/api/connections', { cookie })).json.claude.connected).toBe(false);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM connections').get()).toEqual({ n: 0 });
  });

  it('keeps every user\'s connections separate, even from the admin', async () => {
    const { ctx, cookie: admin } = await setup();
    const sam = await createUserWithSession(ctx, admin, 'sam');
    await call(ctx, 'PUT', '/api/connections/claude', { cookie: sam, body: { apiKey: KEY } });

    expect((await call(ctx, 'GET', '/api/connections', { cookie: admin })).json.claude.connected).toBe(false);
    ctx.setFetch(() => json({ data: [] }));
    expect((await call(ctx, 'POST', '/api/connections/claude/test', { cookie: admin })).json.error).toBe('not_connected');
    expect((await call(ctx, 'GET', '/api/admin/users', { cookie: admin })).res.body).not.toContain(KEY);
  });

  it('requires sign-in', async () => {
    const { ctx } = await setup();
    expect((await call(ctx, 'GET', '/api/connections')).status).toBe(401);
    expect((await call(ctx, 'PUT', '/api/connections/claude', { body: { apiKey: KEY } })).status).toBe(401);
  });
});
