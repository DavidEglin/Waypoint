import type { FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import type { CurrentUser, Role, Theme } from '@waypoint/shared';
import type { Config } from './config.js';
import { randomToken, sha256Hex } from './crypto.js';
import type { Db } from './db.js';

export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  active: number;
  must_change_password: number;
  theme: Theme;
  created_by: number | null;
  created_at: string;
  last_sign_in: string | null;
}

export interface AuthContext {
  user: UserRow;
  sessionHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function toCurrentUser(user: UserRow): CurrentUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    theme: user.theme,
    mustChangePassword: user.must_change_password === 1,
  };
}

export function cookieName(config: Config): string {
  // __Host- pins the cookie to this exact host over HTTPS; it needs Secure, so only in production.
  return config.cookieSecure ? '__Host-wp_session' : 'wp_session';
}

export function clientIp(request: FastifyRequest, config: Config): string {
  if (config.trustCloudflareHeaders) {
    const header = request.headers['cf-connecting-ip'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value && isIP(value.trim())) return value.trim();
  }
  return request.ip;
}

// ---- Sessions ----

export function createSession(
  db: Db,
  userId: number,
  ip: string,
  userAgent: string | undefined,
  now: Date,
): string {
  const id = randomToken(32);
  const iso = now.toISOString();
  db.prepare(
    'INSERT INTO sessions (id_hash, user_id, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(sha256Hex(id), userId, iso, iso, ip, userAgent?.slice(0, 300) ?? null);
  return id;
}

/** Returns the signed-in user for a raw session cookie value, or null (expired, disabled, unknown). */
export function lookupSession(db: Db, rawId: string, now: Date): AuthContext | null {
  const sessionHash = sha256Hex(rawId);
  const row = db
    .prepare(
      `SELECT s.last_seen AS last_seen, u.* FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    )
    .get(sessionHash) as (UserRow & { last_seen: string }) | undefined;
  if (!row) return null;

  const idleMs = now.getTime() - Date.parse(row.last_seen);
  if (idleMs > SESSION_IDLE_MS || row.active !== 1) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sessionHash);
    return null;
  }
  if (idleMs > LAST_SEEN_WRITE_INTERVAL_MS) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?').run(now.toISOString(), sessionHash);
  }
  const { last_seen: _lastSeen, ...user } = row;
  return { user, sessionHash };
}

export function revokeSession(db: Db, sessionHash: string): void {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sessionHash);
}

export function revokeUserSessions(db: Db, userId: number, exceptHash?: string): void {
  if (exceptHash) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(userId, exceptHash);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function purgeExpiredSessions(db: Db, now: Date): void {
  const cutoff = new Date(now.getTime() - SESSION_IDLE_MS).toISOString();
  db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(cutoff);
}

// ---- Audit ----

export function audit(
  db: Db,
  entry: { actor?: { id: number; username: string } | null; action: string; target?: string; ip?: string },
): void {
  db.prepare('INSERT INTO audit_log (actor_id, actor_name, action, target, ip) VALUES (?, ?, ?, ?, ?)').run(
    entry.actor?.id ?? null,
    entry.actor?.username ?? null,
    entry.action,
    entry.target ?? null,
    entry.ip ?? null,
  );
}

// ---- Login rate limiting ----

interface Bucket {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

export interface RateLimitPolicy {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
}

/** Counts failures per key; a key locks for a short time after too many within the window. */
export class LoginLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private policy: RateLimitPolicy,
    private now: () => number = Date.now,
  ) {}

  /** Seconds until the key may try again, or 0 if it may try now. */
  retryAfterSeconds(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    const remaining = bucket.lockedUntil - this.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(key: string): void {
    const now = this.now();
    if (this.buckets.size > 10_000) this.prune(now);
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart > this.policy.windowMs) {
      bucket = { failures: 0, windowStart: now, lockedUntil: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.failures += 1;
    if (bucket.failures >= this.policy.maxFailures) {
      bucket.lockedUntil = now + this.policy.lockMs;
      bucket.failures = 0;
      bucket.windowStart = now;
    }
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    for (const [key, b] of this.buckets) {
      if (b.lockedUntil < now && now - b.windowStart > this.policy.windowMs) this.buckets.delete(key);
    }
  }
}

// ---- Route guards ----

export function sendError(reply: FastifyReply, status: number, error: string, message: string): FastifyReply {
  return reply.code(status).send({ error, message });
}

/** Paths a user with a temporary password may still use. */
const ALLOWED_WHILE_MUST_CHANGE = new Set(['GET /api/me', 'POST /api/me/password', 'DELETE /api/session']);

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!request.auth) return sendError(reply, 401, 'unauthenticated', 'Please sign in.');
  if (request.auth.user.must_change_password === 1) {
    const path = request.url.split('?')[0];
    if (!ALLOWED_WHILE_MUST_CHANGE.has(`${request.method} ${path}`)) {
      return sendError(reply, 403, 'password_change_required', 'Choose a new password before continuing.');
    }
  }
  return undefined;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const denied = await requireAuth(request, reply);
  if (denied) return denied;
  if (request.auth?.user.role !== 'admin') return sendError(reply, 403, 'forbidden', 'Admins only.');
  return undefined;
}
