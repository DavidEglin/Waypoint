import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MAX_UPLOAD_BYTES } from '@waypoint/shared';
import { cookieName, lookupSession, purgeExpiredSessions, sendError } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { JobRunner } from './jobs.js';
import { readNotification } from './read.js';
import { adminRoutes } from './routes/admin.js';
import { assessmentRoutes } from './routes/assessments.js';
import { courseRoutes } from './routes/courses.js';
import { connectionRoutes } from './routes/connections.js';
import { sessionRoutes } from './routes/session.js';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
  now?: () => Date;
  logger?: boolean;
  /** Start the background worker. Tests turn this off and call app.jobs.drain() instead. */
  startJobs?: boolean;
  /** SDK retries for Claude calls (default 2). Tests use 0 so failures are immediate. */
  claudeRetries?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    jobs: JobRunner;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());

  const app = Fastify({
    logger: deps.logger ? { level: 'info' } : false,
    // We only ever look at the direct connection or (when configured) CF-Connecting-IP.
    trustProxy: false,
    bodyLimit: 1024 * 1024,
  });

  app.decorateRequest('auth', null);
  app.register(fastifyCookie);
  app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 } });

  const jobs = new JobRunner(db, {
    read_notification: (p: { assessmentId: number }) =>
      readNotification({ db, config, fetch: deps.fetch, now, claudeRetries: deps.claudeRetries, log: (m) => app.log.warn(m) }, p.assessmentId),
  });
  app.decorate('jobs', jobs);
  if (deps.startJobs !== false) jobs.start();
  app.addHook('onClose', async () => jobs.stop());

  // 1. Host lock: only the configured public hostname is served.
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.host?.toLowerCase() !== config.allowedHost) {
      return reply.code(421).type('text/plain').send('Misdirected request');
    }
  });

  // 2. Security headers.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (_request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  // 3. CSRF: a browser POST from another site carries a different Origin, and JSON bodies can't be sent by plain forms.
  const expectedOrigin = `${config.cookieSecure ? 'https' : 'http'}://${config.allowedHost}`;
  app.addHook('preValidation', async (request, reply) => {
    if (!STATE_CHANGING.has(request.method) || !request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin && origin !== expectedOrigin) return sendError(reply, 403, 'bad_origin', 'Request blocked.');
    const type = request.headers['content-type']?.toLowerCase() ?? '';
    if (type.startsWith('multipart/form-data')) {
      // A cross-site form can send multipart, so for uploads the Origin must be present and ours.
      if (origin !== expectedOrigin) return sendError(reply, 403, 'bad_origin', 'Request blocked.');
      return;
    }
    const hasBody = request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0';
    if (hasBody && !type.startsWith('application/json')) {
      return sendError(reply, 415, 'json_required', 'Requests must be JSON.');
    }
  });

  // 4. Resolve the session (if any).
  app.addHook('onRequest', async (request) => {
    const raw = request.cookies?.[cookieName(config)];
    request.auth = raw ? lookupSession(db, raw, now()) : null;
  });

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return sendError(reply, 500, 'server_error', 'Something went wrong on our side.');
    }
    if (status === 413) return sendError(reply, 413, 'file_too_large', 'That file is too big. The limit is 15 MB.');
    return sendError(reply, status, 'invalid_request', 'That request was not valid.');
  });

  sessionRoutes(app, deps);
  adminRoutes(app, deps);
  connectionRoutes(app, deps);
  courseRoutes(app, deps);
  assessmentRoutes(app, deps);
  app.get('/api/health', async () => ({ ok: true }));
  app.all('/api/*', async (_request, reply) => sendError(reply, 404, 'not_found', 'Not found.'));

  // Built client (production): static files, with index.html for client-side routes.
  const clientDir = config.clientDir ? resolve(config.clientDir) : null;
  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    app.register(fastifyStatic, {
      root: clientDir,
      wildcard: false,
      index: false,
      setHeaders: (res, path) => {
        res.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.get('/*', async (request, reply) => {
      if (request.url.includes('.')) return reply.code(404).send();
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  // Housekeeping: drop idle sessions now and hourly.
  purgeExpiredSessions(db, now());
  const timer = setInterval(() => purgeExpiredSessions(db, now()), 60 * 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  return app;
}
