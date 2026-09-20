import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db.js';
import { JobRunner } from '../src/jobs.js';

const dirs: string[] = [];
const dbs: Db[] = [];
afterEach(() => {
  dbs.splice(0).forEach((d) => d.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function freshDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), 'waypoint-jobs-'));
  dirs.push(dir);
  const db = openDatabase(dir);
  dbs.push(db);
  return db;
}
const rows = (db: Db) => db.prepare('SELECT kind, status, attempts, error FROM jobs ORDER BY id').all() as any[];

describe('JobRunner', () => {
  it('runs queued jobs, including ones queued by other jobs', async () => {
    const db = freshDb();
    const seen: number[] = [];
    const runner: JobRunner = new JobRunner(db, {
      work: async (p: { n: number }) => {
        seen.push(p.n);
        if (p.n < 3) runner.enqueue('work', { n: p.n + 1 });
      },
    });
    runner.enqueue('work', { n: 1 });
    await runner.drain();
    expect(seen).toEqual([1, 2, 3]);
    expect(rows(db).map((r) => r.status)).toEqual(['done', 'done', 'done']);
  });

  it('records a failing job by error name only and keeps going', async () => {
    const db = freshDb();
    const runner = new JobRunner(db, {
      bad: async () => { throw new TypeError('secret sk-ant-123 in the message'); },
      good: async () => {},
    });
    runner.enqueue('bad', {});
    runner.enqueue('good', {});
    runner.enqueue('unknown', {});
    await runner.drain();
    const r = rows(db);
    expect(r[0]).toMatchObject({ status: 'failed', error: 'TypeError' });
    expect(JSON.stringify(r)).not.toContain('sk-ant');
    expect(r[1].status).toBe('done');
    expect(r[2].status).toBe('failed');
  });

  it('never runs more than the concurrency limit at once', async () => {
    const db = freshDb();
    let active = 0;
    let peak = 0;
    const runner = new JobRunner(
      db,
      { slow: async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 15)); active--; } },
      { concurrency: 2, pollMs: 1000 },
    );
    for (let i = 0; i < 6; i++) runner.enqueue('slow', {});
    await runner.drain();
    expect(peak).toBe(2);
    expect(rows(db).every((r) => r.status === 'done')).toBe(true);
  });

  it('requeues work that was running when the process stopped', async () => {
    const db = freshDb();
    db.prepare("INSERT INTO jobs (kind, payload, status, attempts) VALUES ('work', '{}', 'running', 1)").run();
    let ran = 0;
    const runner = new JobRunner(db, { work: async () => { ran++; } });
    runner.start();
    await runner.drain();
    await runner.stop();
    expect(ran).toBe(1);
    expect(rows(db)[0]).toMatchObject({ status: 'done', attempts: 2 });
  });
});
