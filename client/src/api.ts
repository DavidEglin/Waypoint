import type { ApiError } from '@waypoint/shared';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** The rest of the error body, for the few errors that carry extra data (e.g. already_added). */
    public data: Record<string, unknown> = {},
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
      // FormData sets its own multipart boundary header; everything else is JSON.
      headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
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
    const err = (data ?? {}) as Partial<ApiError> & Record<string, unknown>;
    if (res.status === 401 && path !== '/api/session' && path !== '/api/me') {
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    }
    throw new ApiFailure(res.status, err.error ?? 'error', err.message ?? 'Something went wrong. Please try again.', err);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}
