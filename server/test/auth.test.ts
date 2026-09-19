import { describe, expect, it } from 'vitest';
import { SESSION_IDLE_MS } from '../src/auth.js';
import { ADMIN, NEW_PASSWORD, adminCookie, call, createCtx, signIn } from './helpers.js';

describe('first admin', () => {
  it('is created from env with a forced password change', async () => {
    const ctx = await createCtx();
    const cookie = await signIn(ctx, ADMIN.username, ADMIN.password);
    const me = await call(ctx, 'GET', '/api/me', { cookie });
    expect(me.json).toMatchObject({ username: 'admin', role: 'admin', mustChangePassword: true });
  });

  it('refuses to start without credentials when no admin exists', async () => {
    const { ensureFirstAdmin } = await import('../src/bootstrap.js');
    const ctx = await createCtx();
    ctx.db.prepare('DELETE FROM users').run();
    await expect(ensureFirstAdmin(ctx.db, { ...ctx.config, adminUsername: null, adminPassword: null })).rejects.toThrow(/ADMIN_USERNAME/);
    await expect(ensureFirstAdmin(ctx.db, { ...ctx.config, adminPassword: 'short' })).rejects.toThrow(/12 characters/);
  });
});

describe('sign in', () => {
  it('sets an HttpOnly, Secure, SameSite=Lax host-prefixed cookie and stores only a hash', async () => {
    const ctx = await createCtx();
    const r = await call(ctx, 'POST', '/api/session', { body: { username: 'Admin', password: ADMIN.password } });
    expect(r.status).toBe(200);
    const cookie = r.res.cookies[0]!;
    expect(cookie).toMatchObject({ name: '__Host-wp_session', httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    const stored = ctx.db.prepare('SELECT id_hash FROM sessions').all() as { id_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id_hash).not.toContain(cookie.value);
    expect(Object.keys(r.json).sort()).toEqual(['id', 'mustChangePassword', 'role', 'theme', 'username']);
  });

  it('gives the same error for unknown user, wrong password and disabled user', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    await call(ctx, 'POST', '/api/admin/users', { cookie: admin, body: { username: 'sam', temporaryPassword: 'temporary-password-1' } });
    await call(ctx, 'PATCH', '/api/admin/users/2', { cookie: admin, body: { active: false } });

    const attempts = [
      { username: 'nobody', password: 'whatever-password' },
      { username: 'admin', password: 'wrong-password-here' },
      { username: 'sam', password: 'temporary-password-1' },
    ];
    const results = [];
    for (const body of attempts) results.push(await call(ctx, 'POST', '/api/session', { body }));
    for (const r of results) {
      expect(r.status).toBe(401);
      expect(r.json).toEqual(results[0]!.json);
    }
  });

  it('locks a username after repeated failures, then recovers', async () => {
    const ctx = await createCtx();
    for (let i = 0; i < 5; i++) {
      const r = await call(ctx, 'POST', '/api/session', { body: { username: 'admin', password: 'bad-password-guess' } });
      expect(r.status).toBe(401);
    }
    const locked = await call(ctx, 'POST', '/api/session', { body: { username: 'admin', password: ADMIN.password } });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    ctx.clock.advance(6 * 60_000);
    const ok = await call(ctx, 'POST', '/api/session', { body: { username: 'admin', password: ADMIN.password } });
    expect(ok.status).toBe(200);
  });

  it('logs failed sign-ins to the audit log', async () => {
    const ctx = await createCtx();
    await call(ctx, 'POST', '/api/session', { body: { username: 'admin', password: 'bad-password-guess' } });
    const row = ctx.db.prepare("SELECT * FROM audit_log WHERE action = 'sign_in_failed'").get() as { target: string };
    expect(row.target).toBe('admin');
  });

  it('uses CF-Connecting-IP only when trusted', async () => {
    for (const trust of [false, true]) {
      const ctx = await createCtx({ trustCloudflareHeaders: trust });
      await call(ctx, 'POST', '/api/session', {
        body: { username: 'admin', password: ADMIN.password },
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      });
      const s = ctx.db.prepare('SELECT ip FROM sessions').get() as { ip: string };
      expect(s.ip === '203.0.113.9').toBe(trust);
    }
  });
});

describe('forced password change', () => {
  it('blocks everything except me / password / sign out until changed', async () => {
    const ctx = await createCtx();
    const cookie = await signIn(ctx, ADMIN.username, ADMIN.password);
    for (const [method, url] of [['GET', '/api/connections'], ['GET', '/api/admin/users'], ['PATCH', '/api/me/settings']] as const) {
      const r = await call(ctx, method, url, { cookie, ...(method === 'PATCH' ? { body: { theme: 'dark' } } : {}) });
      expect(r.status, url).toBe(403);
      expect(r.json.error).toBe('password_change_required');
    }
    const changed = await call(ctx, 'POST', '/api/me/password', { cookie, body: { currentPassword: ADMIN.password, newPassword: NEW_PASSWORD } });
    expect(changed.status).toBe(204);
    expect((await call(ctx, 'GET', '/api/connections', { cookie })).status).toBe(200);
    expect((await call(ctx, 'GET', '/api/me', { cookie })).json.mustChangePassword).toBe(false);
  });

  it('enforces 12+ characters, the right current password, and a different new one', async () => {
    const ctx = await createCtx();
    const cookie = await signIn(ctx, ADMIN.username, ADMIN.password);
    const change = (currentPassword: string, newPassword: string) =>
      call(ctx, 'POST', '/api/me/password', { cookie, body: { currentPassword, newPassword } });

    expect((await change(ADMIN.password, 'short-11-pw')).status).toBe(400);
    expect((await change('not-my-password', NEW_PASSWORD)).json.error).toBe('wrong_password');
    expect((await change(ADMIN.password, ADMIN.password)).json.error).toBe('same_password');
  });

  it('ends the other sessions but keeps this one', async () => {
    const ctx = await createCtx();
    const first = await signIn(ctx, ADMIN.username, ADMIN.password);
    const second = await signIn(ctx, ADMIN.username, ADMIN.password);
    await call(ctx, 'POST', '/api/me/password', { cookie: second, body: { currentPassword: ADMIN.password, newPassword: NEW_PASSWORD } });
    expect((await call(ctx, 'GET', '/api/me', { cookie: first })).status).toBe(401);
    expect((await call(ctx, 'GET', '/api/me', { cookie: second })).status).toBe(200);
  });
});

describe('sessions', () => {
  it('expire after 8 hours idle, but activity keeps them alive', async () => {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);

    ctx.clock.advance(SESSION_IDLE_MS - 60_000);
    expect((await call(ctx, 'GET', '/api/me', { cookie })).status).toBe(200); // refreshes last_seen
    ctx.clock.advance(SESSION_IDLE_MS - 60_000);
    expect((await call(ctx, 'GET', '/api/me', { cookie })).status).toBe(200);
    ctx.clock.advance(SESSION_IDLE_MS + 60_000);
    expect((await call(ctx, 'GET', '/api/me', { cookie })).status).toBe(401);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('sign out ends the session server-side', async () => {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);
    expect((await call(ctx, 'DELETE', '/api/session', { cookie })).status).toBe(204);
    expect((await call(ctx, 'GET', '/api/me', { cookie })).status).toBe(401);
  });

  it('rejects unknown or forged cookies', async () => {
    const ctx = await createCtx();
    expect((await call(ctx, 'GET', '/api/me', { cookie: '__Host-wp_session=forged' })).status).toBe(401);
    expect((await call(ctx, 'GET', '/api/me')).status).toBe(401);
  });

  it('saves the theme per user', async () => {
    const ctx = await createCtx();
    const cookie = await adminCookie(ctx);
    expect((await call(ctx, 'PATCH', '/api/me/settings', { cookie, body: { theme: 'dark' } })).status).toBe(200);
    expect((await call(ctx, 'GET', '/api/me', { cookie })).json.theme).toBe('dark');
    expect((await call(ctx, 'PATCH', '/api/me/settings', { cookie, body: { theme: 'neon' } })).status).toBe(400);
  });
});
