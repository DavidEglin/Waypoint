import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureFirstAdmin } from '../src/bootstrap.js';
import type { Config } from '../src/config.js';
import { openDatabase, type Db } from '../src/db.js';

export const HOST = 'waypoint.test';
export const ADMIN = { username: 'admin', password: 'first-admin-password' };
export const NEW_PASSWORD = 'a-much-better-password';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  config: Config;
  dataDir: string;
  clock: { time: number; advance(ms: number): void };
  fetchCalls: { url: string; init: RequestInit }[];
  setFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

export async function createCtx(overrides: Partial<Config> = {}): Promise<TestCtx> {
  const dataDir = mkdtempSync(join(tmpdir(), 'waypoint-test-'));
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    allowedHost: HOST,
    cookieSecure: true,
    trustCloudflareHeaders: false,
    encryptionKey: randomBytes(32),
    adminUsername: ADMIN.username,
    adminPassword: ADMIN.password,
    clientDir: null,
    ...overrides,
  };
  const db = openDatabase(dataDir);
  await ensureFirstAdmin(db, config);

  const clock = { time: Date.parse('2026-09-19T00:00:00Z'), advance(ms: number) { this.time += ms; } };
  const fetchCalls: TestCtx['fetchCalls'] = [];
  let handler: Parameters<TestCtx['setFetch']>[0] = () => new Response('{}', { status: 500 });

  const app = buildApp({
    config,
    db,
    now: () => new Date(clock.time),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} });
      return handler(String(url), init ?? {});
    }) as typeof fetch,
  });
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, db, config, dataDir, clock, fetchCalls, setFetch: (h) => (handler = h) };
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function call(
  ctx: TestCtx,
  method: Method,
  url: string,
  opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) {
  const res = await ctx.app.inject({
    method,
    url,
    headers: {
      host: HOST,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  let json: any = undefined;
  try {
    json = res.body ? JSON.parse(res.body) : undefined;
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, json, headers: res.headers, res };
}

/** Sign in and return a Cookie header value. */
export async function signIn(ctx: TestCtx, username: string, password: string): Promise<string> {
  const { status, res } = await call(ctx, 'POST', '/api/session', { body: { username, password } });
  if (status !== 200) throw new Error(`sign in failed: ${status} ${res.body}`);
  const cookie = res.cookies[0]!;
  return `${cookie.name}=${cookie.value}`;
}

/** Sign in as admin and complete the forced password change. */
export async function adminCookie(ctx: TestCtx): Promise<string> {
  const cookie = await signIn(ctx, ADMIN.username, ADMIN.password);
  const r = await call(ctx, 'POST', '/api/me/password', {
    cookie,
    body: { currentPassword: ADMIN.password, newPassword: NEW_PASSWORD },
  });
  if (r.status !== 204) throw new Error(`password change failed: ${r.status}`);
  return cookie;
}

/** Create a normal user via the admin API and return their cookie after they set a real password. */
export async function createUserWithSession(ctx: TestCtx, admin: string, username: string, password = 'user-real-password-1'): Promise<string> {
  const temp = 'temporary-password-1';
  const created = await call(ctx, 'POST', '/api/admin/users', { cookie: admin, body: { username, temporaryPassword: temp } });
  if (created.status !== 201) throw new Error(`create failed: ${created.status} ${created.res.body}`);
  const cookie = await signIn(ctx, username, temp);
  const r = await call(ctx, 'POST', '/api/me/password', { cookie, body: { currentPassword: temp, newPassword: password } });
  if (r.status !== 204) throw new Error(`user password change failed: ${r.status}`);
  return cookie;
}
