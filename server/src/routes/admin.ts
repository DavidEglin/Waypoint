import type { FastifyInstance } from 'fastify';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminUser } from '@waypoint/shared';
import { createUserRequestSchema, resetPasswordRequestSchema, updateUserRequestSchema } from '@waypoint/shared';
import { audit, clientIp, requireAdmin, revokeUserSessions, sendError, type UserRow } from '../auth.js';
import type { AppDeps } from '../app.js';
import { parseBody } from '../http.js';
import { hashPassword } from '../passwords.js';

function toAdminUser(u: UserRow): AdminUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    active: u.active === 1,
    mustChangePassword: u.must_change_password === 1,
    createdAt: u.created_at,
    lastSignIn: u.last_sign_in,
  };
}

export function adminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;

  const findUser = (id: unknown): UserRow | undefined => {
    const n = Number(id);
    return Number.isInteger(n) ? (db.prepare('SELECT * FROM users WHERE id = ?').get(n) as UserRow | undefined) : undefined;
  };
  /** Would removing/disabling this user leave no active admin? */
  const isLastActiveAdmin = (target: UserRow): boolean => {
    if (target.role !== 'admin' || target.active !== 1) return false;
    const others = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(target.id) as { n: number };
    return others.n === 0;
  };

  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    const rows = db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as UserRow[];
    return rows.map(toAdminUser);
  });

  app.post('/api/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const body = parseBody(createUserRequestSchema, request.body, reply);
    if (!body) return reply;
    const actor = request.auth!.user;

    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) {
      return sendError(reply, 409, 'username_taken', 'That username is already in use.');
    }
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role, must_change_password, created_by) VALUES (?, ?, ?, 1, ?)')
      .run(body.username, await hashPassword(body.temporaryPassword), body.role, actor.id);
    audit(db, { actor, action: 'user_created', target: body.username, ip: clientIp(request, config) });
    return reply.code(201).send(toAdminUser(findUser(info.lastInsertRowid)!));
  });

  app.post('/api/admin/users/:id/reset-password', { preHandler: requireAdmin }, async (request, reply) => {
    const target = findUser((request.params as { id: string }).id);
    if (!target) return sendError(reply, 404, 'not_found', 'No such user.');
    const body = parseBody(resetPasswordRequestSchema, request.body, reply);
    if (!body) return reply;

    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(
      await hashPassword(body.temporaryPassword),
      target.id,
    );
    revokeUserSessions(db, target.id);
    audit(db, { actor: request.auth!.user, action: 'password_reset', target: target.username, ip: clientIp(request, config) });
    return reply.code(204).send();
  });

  app.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const target = findUser((request.params as { id: string }).id);
    if (!target) return sendError(reply, 404, 'not_found', 'No such user.');
    const body = parseBody(updateUserRequestSchema, request.body, reply);
    if (!body) return reply;
    const actor = request.auth!.user;

    if (!body.active) {
      if (target.id === actor.id) return sendError(reply, 400, 'cannot_disable_self', 'You cannot disable your own account.');
      if (isLastActiveAdmin(target)) return sendError(reply, 400, 'last_admin', 'There must be at least one active admin.');
    }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, target.id);
    if (!body.active) revokeUserSessions(db, target.id);
    audit(db, { actor, action: body.active ? 'user_enabled' : 'user_disabled', target: target.username, ip: clientIp(request, config) });
    return toAdminUser(findUser(target.id)!);
  });

  app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const target = findUser((request.params as { id: string }).id);
    if (!target) return sendError(reply, 404, 'not_found', 'No such user.');
    const actor = request.auth!.user;

    if (target.id === actor.id) return sendError(reply, 400, 'cannot_delete_self', 'You cannot delete your own account.');
    if (isLastActiveAdmin(target)) return sendError(reply, 400, 'last_admin', 'There must be at least one active admin.');

    // Sessions, connections, courses and assessments cascade in the database; uploaded files are removed here.
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    rmSync(join(config.dataDir, 'uploads', String(target.id)), { recursive: true, force: true });
    audit(db, { actor, action: 'user_deleted', target: target.username, ip: clientIp(request, config) });
    return reply.code(204).send();
  });
}
