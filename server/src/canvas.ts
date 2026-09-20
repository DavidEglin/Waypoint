import type { ConnectionErrorCode } from '@waypoint/shared';
import { ReadError } from './claude.js';

export type FetchLike = typeof fetch;

export class CanvasError extends ReadError {}

const TIMEOUT_MS = 20_000;
const MAX_PAGES = 10;

export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string | null;
  enrollments?: { type: string }[];
}
export interface CanvasRubricRating {
  description?: string | null;
  long_description?: string | null;
  points?: number;
}
export interface CanvasCriterion {
  description?: string | null;
  long_description?: string | null;
  points?: number;
  ratings?: CanvasRubricRating[];
}
export interface CanvasAssignment {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  assignment_group_id?: number | null;
  rubric?: CanvasCriterion[] | null;
  html_url?: string;
}
export interface CanvasAssignmentGroup {
  id: number;
  name: string;
  group_weight?: number | null;
}
export interface CanvasFile {
  id: number;
  display_name: string;
  'content-type'?: string;
  size?: number;
  url?: string;
  locked_for_user?: boolean;
}

function codeForStatus(status: number): ConnectionErrorCode {
  if (status === 401 || status === 403) return 'bad_credentials';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'bad_response';
}

/** The one place that talks to Canvas: bearer auth, timeouts, pagination, and typed failures. */
export class CanvasClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async send(url: string, headers: Record<string, string>, redirect: RequestRedirect): Promise<Response> {
    try {
      return await this.fetchImpl(url, { method: 'GET', headers, redirect, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      throw new CanvasError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable');
    }
  }

  private async getJson(url: string): Promise<{ body: unknown; next: string | null }> {
    // Manual redirects: an API answer must come from the address the student entered.
    const res = await this.send(url, { Authorization: `Bearer ${this.token}`, Accept: 'application/json' }, 'manual');
    if (res.status !== 200) throw new CanvasError(codeForStatus(res.status));
    try {
      return { body: await res.json(), next: nextLink(res.headers.get('link'), this.baseUrl) };
    } catch {
      throw new CanvasError('bad_response');
    }
  }

  async get<T>(path: string): Promise<T> {
    return (await this.getJson(`${this.baseUrl}${path}`)).body as T;
  }

  /** Follows Link rel="next" (URLs are opaque) with a page cap so a bad server cannot loop us. */
  async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = `${this.baseUrl}${path}`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const { body, next } = await this.getJson(url);
      if (!Array.isArray(body)) throw new CanvasError('bad_response');
      out.push(...(body as T[]));
      url = next;
    }
    return out;
  }

  listCourses(): Promise<CanvasCourse[]> {
    return this.list('/api/v1/courses?enrollment_state=active&enrollment_type=student&per_page=100');
  }

  listUpcomingAssignments(courseId: string): Promise<CanvasAssignment[]> {
    return this.list(`/api/v1/courses/${encodeURIComponent(courseId)}/assignments?bucket=upcoming&order_by=due_at&per_page=100`);
  }

  getAssignment(courseId: string, assignmentId: string): Promise<CanvasAssignment> {
    return this.get(`/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}`);
  }

  listAssignmentGroups(courseId: string): Promise<CanvasAssignmentGroup[]> {
    return this.list(`/api/v1/courses/${encodeURIComponent(courseId)}/assignment_groups?per_page=100`);
  }

  getFile(fileId: string): Promise<CanvasFile> {
    return this.get(`/api/v1/files/${encodeURIComponent(fileId)}`);
  }

  /** Downloads a file from the short-lived signed URL Canvas gave us, refusing anything over `maxBytes`. */
  async download(file: CanvasFile, maxBytes: number): Promise<Buffer> {
    if (!file.url || !/^https:\/\//i.test(file.url)) throw new CanvasError('bad_response');
    if (file.size !== undefined && file.size > maxBytes) throw new CanvasError('too_long');
    // The signed URL carries its own authorisation: the bearer token must not be sent to a CDN host.
    const res = await this.send(file.url, {}, 'follow');
    if (res.status !== 200) throw new CanvasError(codeForStatus(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new CanvasError('too_long');
    return buf;
  }
}

function nextLink(header: string | null, baseUrl: string): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    // Never follow a next link off to some other host.
    if (m && m[1]!.startsWith(baseUrl)) return m[1]!;
  }
  return null;
}
