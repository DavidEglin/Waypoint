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
  /** Course-level end date, when the course sets its own instead of following the term. */
  end_at?: string | null;
  term?: { end_at?: string | null } | null;
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
export interface CanvasPage {
  page_id?: number;
  url: string;
  title: string;
  body?: string | null;
  html_url?: string;
  locked_for_user?: boolean;
}
export interface CanvasModuleItem {
  id: number;
  type: string;
  title: string;
  page_url?: string | null;
  content_id?: number | null;
  html_url?: string;
}
export interface CanvasModule {
  id: number;
  name: string;
  position: number;
  items?: CanvasModuleItem[];
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
    // status 0 / type "opaqueredirect" here means Canvas tried to redirect us (e.g. to a login page) and we refused to follow.
    if (res.status !== 200) throw new CanvasError(codeForStatus(res.status), `GET ${url} -> HTTP ${res.status || `(${res.type})`}`);
    try {
      return { body: await res.json(), next: nextLink(res.headers.get('link'), this.baseUrl) };
    } catch {
      throw new CanvasError('bad_response', `GET ${url} -> 200 but body was not valid JSON`);
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
      if (!Array.isArray(body)) throw new CanvasError('bad_response', `GET ${url} -> 200 but body was not a list (got ${typeof body})`);
      out.push(...(body as T[]));
      url = next;
    }
    return out;
  }

  listCourses(): Promise<CanvasCourse[]> {
    return this.list('/api/v1/courses?enrollment_state=active&enrollment_type=student&include[]=term&per_page=100');
  }

  /** All assignments, ordered by due date. No `bucket` filter: Canvas's own buckets are too narrow (e.g. "upcoming" is roughly the next week and excludes undated work), so callers decide the window. */
  listAssignments(courseId: string): Promise<CanvasAssignment[]> {
    return this.list(`/api/v1/courses/${encodeURIComponent(courseId)}/assignments?order_by=due_at&per_page=100`);
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

  /** Metadata only (no signed url) - call getFile() right before downloading, since the url expires. */
  listFiles(courseId: string): Promise<CanvasFile[]> {
    return this.list(`/api/v1/courses/${encodeURIComponent(courseId)}/files?per_page=100`);
  }

  /** Body included inline so a page's text never needs a second request. */
  listPages(courseId: string): Promise<CanvasPage[]> {
    return this.list(`/api/v1/courses/${encodeURIComponent(courseId)}/pages?include[]=body&per_page=100`);
  }

  /** Module items included inline. A module with more items than one page returns gives only that page's worth - a known simplification. */
  listModules(courseId: string): Promise<CanvasModule[]> {
    return this.list(`/api/v1/courses/${encodeURIComponent(courseId)}/modules?include[]=items&per_page=100`);
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

/** A concluded course's own end date (or its term's) has passed. An undated assignment in one is stale forever, not "upcoming". */
export function courseConcluded(c: CanvasCourse, now: Date): boolean {
  const end = c.end_at ?? c.term?.end_at ?? null;
  return end !== null && new Date(end).getTime() < now.getTime();
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
