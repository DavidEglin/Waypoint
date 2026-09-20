import type { Db } from './db.js';

export type JobHandler = (payload: any) => Promise<void>;

interface JobRow {
  id: number;
  kind: string;
  payload: string;
}

/**
 * A small in-process queue backed by the `jobs` table (brief section 5: no Redis).
 * Work survives a restart: jobs that were running when the process stopped are queued again.
 */
export class JobRunner {
  private inflight = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  constructor(
    private db: Db,
    private handlers: Record<string, JobHandler>,
    private opts: { concurrency: number; pollMs: number } = { concurrency: 2, pollMs: 3000 },
  ) {}

  enqueue(kind: string, payload: unknown): number {
    const info = this.db.prepare('INSERT INTO jobs (kind, payload) VALUES (?, ?)').run(kind, JSON.stringify(payload));
    this.kick();
    return Number(info.lastInsertRowid);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run();
    this.timer = setInterval(() => this.tick(), this.opts.pollMs);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.inflight]);
  }

  /** Run everything queued (including jobs queued by jobs) and wait for it. Used by tests and shutdown. */
  async drain(): Promise<void> {
    for (;;) {
      this.tick();
      if (this.inflight.size === 0) return;
      await Promise.allSettled([...this.inflight]);
    }
  }

  private kick(): void {
    if (this.started) queueMicrotask(() => this.tick());
  }

  private claim(): JobRow | undefined {
    return this.db
      .prepare(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1)
         RETURNING id, kind, payload`,
      )
      .get() as JobRow | undefined;
  }

  private tick(): void {
    while (this.inflight.size < this.opts.concurrency) {
      const job = this.claim();
      if (!job) return;
      const p = this.run(job).finally(() => {
        this.inflight.delete(p);
        this.kick();
      });
      this.inflight.add(p);
    }
  }

  private async run(job: JobRow): Promise<void> {
    let status: 'done' | 'failed' = 'done';
    let error: string | null = null;
    try {
      const handler = this.handlers[job.kind];
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      await handler(JSON.parse(job.payload));
    } catch (err) {
      status = 'failed';
      // Only the error's name: messages from upstream libraries can echo request details.
      error = err instanceof Error ? err.name : 'Error';
    }
    this.db
      .prepare("UPDATE jobs SET status = ?, error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(status, error, job.id);
  }
}
