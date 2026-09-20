import Anthropic from '@anthropic-ai/sdk';
import type { ConnectionErrorCode, ReadErrorCode } from '@waypoint/shared';

/** A failure with a user-facing code. Thrown while reading a notification and turned into an error state. */
export class ReadError extends Error {
  constructor(
    public code: ReadErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export interface ClaudeClientOptions {
  fetch?: typeof fetch;
  baseURL?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
}

/** The student's own key is used per call; nothing is cached on the server. */
export function makeClaudeClient(apiKey: string, opts: ClaudeClientOptions = {}): Anthropic {
  return new Anthropic({
    apiKey,
    fetch: opts.fetch,
    baseURL: opts.baseURL ?? undefined,
    timeout: opts.timeoutMs ?? 120_000,
    maxRetries: opts.maxRetries ?? 2,
  });
}

/** Map an SDK error to a code the UI understands. Most specific class first (the connection classes are APIError subclasses). */
export function mapClaudeError(err: unknown): ConnectionErrorCode | null {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (err instanceof Anthropic.APIConnectionError) return 'unreachable';
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'bad_credentials';
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.APIError) return err.status !== undefined && err.status >= 500 ? 'unavailable' : 'bad_response';
  return null;
}

export type TestResult = { ok: true } | { ok: false; error: ConnectionErrorCode };

/** Cheap, free call that proves the key works: list one model. */
export async function testClaudeKey(apiKey: string, opts: ClaudeClientOptions = {}): Promise<TestResult> {
  const client = makeClaudeClient(apiKey, { ...opts, timeoutMs: 10_000, maxRetries: 0 });
  try {
    const page = await client.models.list({ limit: 1 });
    return Array.isArray(page.data) ? { ok: true } : { ok: false, error: 'bad_response' };
  } catch (err) {
    const code = mapClaudeError(err);
    if (code) return { ok: false, error: code };
    throw err;
  }
}
