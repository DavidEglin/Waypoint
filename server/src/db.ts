import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrations } from './migrations.js';

export type Db = Database.Database;

export function dbPath(dataDir: string): string {
  return join(dataDir, 'db', 'waypoint.sqlite');
}

/** Creates DATA_DIR/db and DATA_DIR/uploads, opens SQLite in WAL mode and applies migrations. */
export function openDatabase(dataDir: string): Db {
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });
  const db = new Database(dbPath(dataDir));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INTEGER PRIMARY KEY, name TEXT NOT NULL,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
  );
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
    })();
  }
}
