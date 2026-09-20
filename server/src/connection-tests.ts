import { isIP } from 'node:net';
import type { ConnectionErrorCode } from '@waypoint/shared';

export type FetchLike = typeof fetch;

export type TestResult = { ok: true } | { ok: false; error: ConnectionErrorCode };

const TIMEOUT_MS = 10_000;

/**
 * Turn what a student typed into a Canvas origin, or null if it isn't acceptable.
 * The server fetches this address, so it must be https, a real domain name (no IP literals,
 * no single-label or internal names) and carry no credentials. DNS-rebinding to a private
 * address is not covered here.
 */
export function normalizeCanvasUrl(input: string): string | null {
  const trimmed = input.trim();
  if (/^http:\/\//i.test(trimmed)) return null;
  const withScheme = /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host) || host.startsWith('[')) return null;
  if (!host.includes('.')) return null;
  if (/(^|\.)(localhost|local|internal|localdomain|home|lan)$/.test(host)) return null;
  return url.origin;
}

async function get(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<Response | ConnectionErrorCode> {
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable';
  }
}

function statusToError(status: number): ConnectionErrorCode {
  if (status === 401 || status === 403) return 'bad_credentials';
  if (status === 429) return 'rate_limited';
  return 'bad_response';
}

export async function testCanvas(fetchImpl: FetchLike, baseUrl: string, token: string): Promise<TestResult> {
  const res = await get(fetchImpl, `${baseUrl}/api/v1/users/self`, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  });
  if (typeof res === 'string') return { ok: false, error: res };
  if (res.status !== 200) return { ok: false, error: statusToError(res.status) };
  try {
    const body = (await res.json()) as { id?: unknown };
    return body && typeof body === 'object' && body.id !== undefined ? { ok: true } : { ok: false, error: 'bad_response' };
  } catch {
    return { ok: false, error: 'bad_response' };
  }
}
