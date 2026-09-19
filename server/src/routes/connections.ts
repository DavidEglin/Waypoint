import type { FastifyInstance, FastifyReply } from 'fastify';
import type { CanvasConnectionInfo, ConnectionErrorCode, ConnectionInfo, ConnectionKind, ConnectionsResponse } from '@waypoint/shared';
import { connectionKindSchema, saveCanvasRequestSchema, saveClaudeRequestSchema } from '@waypoint/shared';
import { audit, clientIp, requireAuth, sendError } from '../auth.js';
import type { AppDeps } from '../app.js';
import { testCanvas, testClaude } from '../connection-tests.js';
import { normalizeCanvasUrl } from '../connection-tests.js';
import { decrypt, encrypt } from '../crypto.js';
import { parseBody } from '../http.js';

interface ConnectionRow {
  user_id: number;
  kind: ConnectionKind;
  base_url: string | null;
  secret_encrypted: Buffer;
  status: 'untested' | 'ok' | 'failed';
  last_verified: string | null;
  last_error: ConnectionErrorCode | null;
}

// Only this shape ever leaves the server: never the token or key.
function info(row: ConnectionRow | undefined): ConnectionInfo {
  return {
    connected: !!row,
    status: row?.status ?? 'untested',
    lastVerified: row?.last_verified ?? null,
    lastError: row?.last_error ?? null,
  };
}
function canvasInfo(row: ConnectionRow | undefined): CanvasConnectionInfo {
  return { ...info(row), baseUrl: row?.base_url ?? null };
}

export function connectionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  const rows = (userId: number) =>
    db.prepare('SELECT * FROM connections WHERE user_id = ?').all(userId) as ConnectionRow[];
  const row = (userId: number, kind: ConnectionKind) =>
    db.prepare('SELECT * FROM connections WHERE user_id = ? AND kind = ?').get(userId, kind) as ConnectionRow | undefined;

  const upsert = (userId: number, kind: ConnectionKind, baseUrl: string | null, secret: string) =>
    db
      .prepare(
        `INSERT INTO connections (user_id, kind, base_url, secret_encrypted, status, last_verified, last_error)
         VALUES (?, ?, ?, ?, 'untested', NULL, NULL)
         ON CONFLICT (user_id, kind) DO UPDATE SET base_url = excluded.base_url,
           secret_encrypted = excluded.secret_encrypted, status = 'untested', last_verified = NULL, last_error = NULL`,
      )
      .run(userId, kind, baseUrl, encrypt(secret, config.encryptionKey));

  app.get('/api/connections', { preHandler: requireAuth }, async (request): Promise<ConnectionsResponse> => {
    const list = rows(request.auth!.user.id);
    return {
      canvas: canvasInfo(list.find((r) => r.kind === 'canvas')),
      claude: info(list.find((r) => r.kind === 'claude')),
    };
  });

  app.put('/api/connections/canvas', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(saveCanvasRequestSchema, request.body, reply);
    if (!body) return reply;
    const baseUrl = normalizeCanvasUrl(body.baseUrl);
    if (!baseUrl) {
      return sendError(reply, 400, 'invalid_address', 'Enter your Canvas address as a website name, like canvas.yourschool.edu.');
    }
    const user = request.auth!.user;
    upsert(user.id, 'canvas', baseUrl, body.token);
    audit(db, { actor: user, action: 'canvas_saved', ip: clientIp(request, config) });
    return canvasInfo(row(user.id, 'canvas'));
  });

  app.put('/api/connections/claude', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(saveClaudeRequestSchema, request.body, reply);
    if (!body) return reply;
    const user = request.auth!.user;
    upsert(user.id, 'claude', null, body.apiKey);
    audit(db, { actor: user, action: 'claude_saved', ip: clientIp(request, config) });
    return info(row(user.id, 'claude'));
  });

  const kindOf = (request: { params: unknown }, reply: FastifyReply): ConnectionKind | null => {
    const parsed = connectionKindSchema.safeParse((request.params as { kind: string }).kind);
    if (parsed.success) return parsed.data;
    sendError(reply, 404, 'not_found', 'No such connection.');
    return null;
  };

  app.post('/api/connections/:kind/test', { preHandler: requireAuth }, async (request, reply) => {
    const kind = kindOf(request, reply);
    if (!kind) return reply;
    const userId = request.auth!.user.id;
    const current = row(userId, kind);
    if (!current) return sendError(reply, 404, 'not_connected', 'Save your details first.');

    let secret: string;
    try {
      secret = decrypt(current.secret_encrypted, config.encryptionKey);
    } catch {
      // ENCRYPTION_KEY changed or the row was altered: the student must re-enter it.
      return sendError(reply, 409, 'unreadable', 'Saved details can no longer be read. Please enter them again.');
    }

    const result =
      kind === 'canvas'
        ? await testCanvas(fetchImpl, current.base_url!, secret)
        : await testClaude(fetchImpl, secret, deps.claudeApiBase);

    db.prepare('UPDATE connections SET status = ?, last_verified = ?, last_error = ? WHERE user_id = ? AND kind = ?').run(
      result.ok ? 'ok' : 'failed',
      result.ok ? now().toISOString() : current.last_verified,
      result.ok ? null : result.error,
      userId,
      kind,
    );
    const updated = row(userId, kind);
    return kind === 'canvas' ? canvasInfo(updated) : info(updated);
  });

  app.delete('/api/connections/:kind', { preHandler: requireAuth }, async (request, reply) => {
    const kind = kindOf(request, reply);
    if (!kind) return reply;
    const user = request.auth!.user;
    db.prepare('DELETE FROM connections WHERE user_id = ? AND kind = ?').run(user.id, kind);
    audit(db, { actor: user, action: `${kind}_disconnected`, ip: clientIp(request, config) });
    return reply.code(204).send();
  });
}
