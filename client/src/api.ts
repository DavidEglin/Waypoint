import type { ApiError, ConnectionErrorCode } from '@waypoint/shared';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the server says the session is gone, so the app can return to sign-in. */
export const SESSION_ENDED_EVENT = 'waypoint:session-ended';

export async function api<T = void>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, 'network', 'Could not reach Waypoint. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    if (res.status === 401 && path !== '/api/session' && path !== '/api/me') {
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    }
    throw new ApiFailure(res.status, err.error ?? 'error', err.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export const CONNECTION_ERROR_TEXT: Record<ConnectionErrorCode, string> = {
  bad_credentials: 'That was rejected. Check the details and try again.',
  rate_limited: 'Too many requests just now. Wait a minute and try again.',
  timeout: 'It took too long to answer. Try again in a moment.',
  unreachable: 'Could not reach it. Check the address and your connection.',
  bad_response: 'It answered, but not in the way we expected. Check the address.',
  invalid_address: 'That address does not look right.',
};
