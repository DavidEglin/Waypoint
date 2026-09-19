import type { FastifyInstance } from 'fastify';
import { changePasswordRequestSchema, loginRequestSchema, updateSettingsRequestSchema } from '@waypoint/shared';
import {
  LoginLimiter,
  audit,
  clientIp,
  cookieName,
  createSession,
  requireAuth,
  revokeSession,
  revokeUserSessions,
  sendError,
  toCurrentUser,
  type UserRow,
} from '../auth.js';
import type { AppDeps } from '../app.js';
import { burnVerify, hashPassword, verifyPassword } from '../passwords.js';
import { parseBody } from '../http.js';

const GENERIC_LOGIN_ERROR = 'That username and password did not match.';

export function sessionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const now = deps.now ?? (() => new Date());
  const byUser = new LoginLimiter({ maxFailures: 5, windowMs: 15 * 60_000, lockMs: 5 * 60_000 }, () => now().getTime());
  const byIp = new LoginLimiter({ maxFailures: 20, windowMs: 15 * 60_000, lockMs: 5 * 60_000 }, () => now().getTime());

  app.post('/api/session', async (request, reply) => {
    const body = parseBody(loginRequestSchema, request.body, reply);
    if (!body) return reply;

    const ip = clientIp(request, config);
    const userKey = body.username.trim().toLowerCase();
    const wait = Math.max(byUser.retryAfterSeconds(userKey), byIp.retryAfterSeconds(ip));
    if (wait > 0) {
      reply.header('Retry-After', String(wait));
      return sendError(reply, 429, 'too_many_attempts', 'Too many attempts. Try again in a few minutes.');
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(body.username.trim()) as UserRow | undefined;
    const passwordOk = user ? await verifyPassword(user.password_hash, body.password) : (await burnVerify(body.password), false);

    // Same response for unknown user, wrong password and disabled account.
    if (!user || !passwordOk || user.active !== 1) {
      byUser.recordFailure(userKey);
      byIp.recordFailure(ip);
      audit(db, { action: 'sign_in_failed', target: userKey.slice(0, 80), ip });
      return sendError(reply, 401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
    }

    byUser.clear(userKey);
    const sessionId = createSession(db, user.id, ip, request.headers['user-agent'], now());
    db.prepare('UPDATE users SET last_sign_in = ? WHERE id = ?').run(now().toISOString(), user.id);
    reply.setCookie(cookieName(config), sessionId, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });
    return toCurrentUser(user);
  });

  app.delete('/api/session', async (request, reply) => {
    if (request.auth) revokeSession(db, request.auth.sessionHash);
    reply.clearCookie(cookieName(config), { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' });
    return reply.code(204).send();
  });

  app.get('/api/me', { preHandler: requireAuth }, async (request) => toCurrentUser(request.auth!.user));

  app.post('/api/me/password', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(changePasswordRequestSchema, request.body, reply);
    if (!body) return reply;
    const { user, sessionHash } = request.auth!;

    if (!(await verifyPassword(user.password_hash, body.currentPassword))) {
      return sendError(reply, 400, 'wrong_password', 'Your current password is not right.');
    }
    if (body.newPassword === body.currentPassword) {
      return sendError(reply, 400, 'same_password', 'Choose a password you have not used just now.');
    }
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      await hashPassword(body.newPassword),
      user.id,
    );
    revokeUserSessions(db, user.id, sessionHash);
    audit(db, { actor: user, action: 'password_changed', target: user.username, ip: clientIp(request, config) });
    return reply.code(204).send();
  });

  app.patch('/api/me/settings', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(updateSettingsRequestSchema, request.body, reply);
    if (!body) return reply;
    db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(body.theme, request.auth!.user.id);
    return { theme: body.theme };
  });
}
