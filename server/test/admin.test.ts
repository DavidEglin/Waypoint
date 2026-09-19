import { describe, expect, it } from 'vitest';
import { NEW_PASSWORD, adminCookie, call, createCtx, createUserWithSession, signIn } from './helpers.js';

describe('admin users', () => {
  it('lets a normal user nowhere near the admin API', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    const user = await createUserWithSession(ctx, admin, 'sam');

    const attempts = [
      call(ctx, 'GET', '/api/admin/users', { cookie: user }),
      call(ctx, 'POST', '/api/admin/users', { cookie: user, body: { username: 'evil', temporaryPassword: 'temporary-password-1' } }),
      call(ctx, 'POST', '/api/admin/users/1/reset-password', { cookie: user, body: { temporaryPassword: 'temporary-password-1' } }),
      call(ctx, 'PATCH', '/api/admin/users/1', { cookie: user, body: { active: false } }),
      call(ctx, 'DELETE', '/api/admin/users/1', { cookie: user }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.status).toBe(403);
    expect((await call(ctx, 'GET', '/api/admin/users')).status).toBe(401);
  });

  it('creates users with a temporary password that must be changed', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    const created = await call(ctx, 'POST', '/api/admin/users', { cookie: admin, body: { username: 'sam', temporaryPassword: 'temporary-password-1' } });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ username: 'sam', role: 'user', active: true, mustChangePassword: true });
    expect(JSON.stringify(created.json)).not.toContain('argon2');

    const list = await call(ctx, 'GET', '/api/admin/users', { cookie: admin });
    expect(list.json.map((u: { username: string }) => u.username)).toEqual(['admin', 'sam']);
  });

  it('validates usernames and passwords, and rejects duplicates in any letter case', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    const create = (username: string, temporaryPassword = 'temporary-password-1') =>
      call(ctx, 'POST', '/api/admin/users', { cookie: admin, body: { username, temporaryPassword } });

    expect((await create('sam')).status).toBe(201);
    expect((await create('SAM')).json.error).toBe('username_taken');
    expect((await create('has space')).status).toBe(400);
    expect((await create('ab')).status).toBe(400);
    expect((await create('valid.name', 'short')).status).toBe(400);
  });

  it('reset password forces a change and ends existing sessions', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    const sam = await createUserWithSession(ctx, admin, 'sam');

    const reset = await call(ctx, 'POST', '/api/admin/users/2/reset-password', { cookie: admin, body: { temporaryPassword: 'another-temp-password' } });
    expect(reset.status).toBe(204);
    expect((await call(ctx, 'GET', '/api/me', { cookie: sam })).status).toBe(401);

    const again = await signIn(ctx, 'sam', 'another-temp-password');
    expect((await call(ctx, 'GET', '/api/me', { cookie: again })).json.mustChangePassword).toBe(true);
  });

  it('disabling ends sessions and blocks sign-in until re-enabled', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    const sam = await createUserWithSession(ctx, admin, 'sam');

    expect((await call(ctx, 'PATCH', '/api/admin/users/2', { cookie: admin, body: { active: false } })).json.active).toBe(false);
    expect((await call(ctx, 'GET', '/api/me', { cookie: sam })).status).toBe(401);
    expect((await call(ctx, 'POST', '/api/session', { body: { username: 'sam', password: 'user-real-password-1' } })).status).toBe(401);

    await call(ctx, 'PATCH', '/api/admin/users/2', { cookie: admin, body: { active: true } });
    expect((await call(ctx, 'POST', '/api/session', { body: { username: 'sam', password: 'user-real-password-1' } })).status).toBe(200);
  });

  it('deleting removes the user, their sessions and their connections', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    const sam = await createUserWithSession(ctx, admin, 'sam');
    await call(ctx, 'PUT', '/api/connections/claude', { cookie: sam, body: { apiKey: 'sk-ant-sam' } });

    expect((await call(ctx, 'DELETE', '/api/admin/users/2', { cookie: admin })).status).toBe(204);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM connections').get()).toEqual({ n: 0 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = 2').get()).toEqual({ n: 0 });
    expect((await call(ctx, 'GET', '/api/me', { cookie: sam })).status).toBe(401);
  });

  it('protects the last active admin and the acting admin', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);

    expect((await call(ctx, 'PATCH', '/api/admin/users/1', { cookie: admin, body: { active: false } })).json.error).toBe('cannot_disable_self');
    expect((await call(ctx, 'DELETE', '/api/admin/users/1', { cookie: admin })).json.error).toBe('cannot_delete_self');

    // A second admin can disable the first, but then cannot disable or delete themselves (they are the last active admin).
    await call(ctx, 'POST', '/api/admin/users', { cookie: admin, body: { username: 'boss', role: 'admin', temporaryPassword: 'temporary-password-1' } });
    const boss = await signIn(ctx, 'boss', 'temporary-password-1');
    await call(ctx, 'POST', '/api/me/password', { cookie: boss, body: { currentPassword: 'temporary-password-1', newPassword: NEW_PASSWORD } });

    expect((await call(ctx, 'PATCH', '/api/admin/users/1', { cookie: boss, body: { active: false } })).status).toBe(200);
    expect((await call(ctx, 'PATCH', '/api/admin/users/2', { cookie: boss, body: { active: false } })).json.error).toBe('cannot_disable_self');
    expect((await call(ctx, 'DELETE', '/api/admin/users/2', { cookie: boss })).json.error).toBe('cannot_delete_self');
  });

  it('records admin actions in the audit log', async () => {
    const ctx = await createCtx();
    const admin = await adminCookie(ctx);
    await call(ctx, 'POST', '/api/admin/users', { cookie: admin, body: { username: 'sam', temporaryPassword: 'temporary-password-1' } });
    await call(ctx, 'POST', '/api/admin/users/2/reset-password', { cookie: admin, body: { temporaryPassword: 'another-temp-password' } });
    await call(ctx, 'PATCH', '/api/admin/users/2', { cookie: admin, body: { active: false } });
    await call(ctx, 'DELETE', '/api/admin/users/2', { cookie: admin });
    const actions = (ctx.db.prepare('SELECT action FROM audit_log ORDER BY id').all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['first_admin_created', 'user_created', 'password_reset', 'user_disabled', 'user_deleted']));
    const details = JSON.stringify(ctx.db.prepare('SELECT * FROM audit_log').all());
    expect(details).not.toContain('temporary-password');
    expect(details).not.toContain('another-temp-password');
  });
});
