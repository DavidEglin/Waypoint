import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ADMIN, HOST, adminCookie, call, createCtx } from './helpers.js';

describe('host lock', () => {
  it('refuses any Host other than the configured one', async () => {
    const ctx = await createCtx();
    for (const host of ['evil.example', '203.0.113.5', 'localhost:3000', `${HOST}.evil.example`, 'waypoint.test:8080']) {
      const r = await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(r.statusCode, host).toBe(421);
    }
  });

  it('serves the configured host (case-insensitively) and refuses a missing Host', async () => {
    const ctx = await createCtx();
    expect((await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host: HOST.toUpperCase() } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host: '' } })).statusCode).toBe(421);
  });

  it('applies to sign-in too, so credentials sent to a wrong host are never processed', async () => {
    const ctx = await createCtx();
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/session', headers: { host: 'evil.example' },
      payload: { username: ADMIN.username, password: ADMIN.password },
    });
    expect(r.statusCode).toBe(421);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
});

describe('CSRF and content type', () => {
  it('blocks state-changing requests from another origin', async () => {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);
    const bad = await call(ctx, 'PATCH', '/api/me/settings', { cookie, body: { theme: 'dark' }, headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(bad.json.error).toBe('bad_origin');
    const good = await call(ctx, 'PATCH', '/api/me/settings', { cookie, body: { theme: 'dark' }, headers: { origin: `https://${HOST}` } });
    expect(good.status).toBe(200);
  });

  it('blocks a cross-origin logout too', async () => {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);
    expect((await call(ctx, 'DELETE', '/api/session', { cookie, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(ctx, 'GET', '/api/me', { cookie })).status).toBe(200);
  });

  it('requires JSON bodies (no form posts)', async () => {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);
    const r = await ctx.app.inject({
      method: 'PATCH', url: '/api/me/settings',
      headers: { host: HOST, cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'theme=dark',
    });
    expect(r.statusCode).toBe(415);
  });

  it('returns a 400 for malformed JSON without leaking internals', async () => {
    const ctx = await createCtx();
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/session',
      headers: { host: HOST, 'content-type': 'application/json' }, payload: '{not json',
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: 'invalid_request', message: 'That request was not valid.' });
  });
});

describe('responses', () => {
  it('sets security headers and no-store on the API', async () => {
    const ctx = await createCtx();
    const r = await call(ctx, 'GET', '/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['strict-transport-security']).toBeDefined();
  });

  it('gives JSON 404s under /api', async () => {
    const ctx = await createCtx();
    const r = await call(ctx, 'GET', '/api/nothing-here');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('not_found');
  });
});

describe('serving the client', () => {
  it('serves index.html for app routes and a real 404 for missing files', async () => {
    const clientDir = (await createCtx()).dataDir + '/client';
    mkdirSync(join(clientDir, 'assets'), { recursive: true });
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>Waypoint</title>');
    writeFileSync(join(clientDir, 'assets', 'app.js'), 'console.log(1)');
    const ctx = await createCtx({ clientDir });

    const home = await call(ctx, 'GET', '/settings');
    expect(home.status).toBe(200);
    expect(home.res.body).toContain('Waypoint');
    expect(home.headers['cache-control']).toBe('no-cache');

    const asset = await call(ctx, 'GET', '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');

    expect((await call(ctx, 'GET', '/assets/missing.js')).status).toBe(404);
  });

  it('never exposes the data directory', async () => {
    const ctx = await createCtx();
    expect((await call(ctx, 'GET', '/db/waypoint.sqlite')).status).toBe(404);
    expect((await call(ctx, 'GET', '/uploads/anything')).status).toBe(404);
  });
});

describe('config', () => {
  const base = { ALLOWED_HOST: 'waypoint.yaxley.com.au', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };

  it('requires ALLOWED_HOST and a valid key', () => {
    expect(() => loadConfig({ ENCRYPTION_KEY: base.ENCRYPTION_KEY })).toThrow(/ALLOWED_HOST/);
    expect(() => loadConfig({ ALLOWED_HOST: 'x.test' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('defaults to secure cookies and untrusted proxy headers', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ cookieSecure: true, trustCloudflareHeaders: false, host: '0.0.0.0', port: 3000, dataDir: './data' });
  });

  it('reads booleans and rejects a bad port', () => {
    expect(loadConfig({ ...base, COOKIE_SECURE: 'false', TRUST_CLOUDFLARE_HEADERS: 'true' })).toMatchObject({ cookieSecure: false, trustCloudflareHeaders: true });
    expect(() => loadConfig({ ...base, PORT: '99999' })).toThrow(/PORT/);
  });
});
