export interface Migration {
  id: number;
  name: string;
  sql: string;
}

// Migrations are embedded (not .sql files) so the bundled server needs no extra assets.
// Never edit a migration that has shipped: add a new one.
export const migrations: Migration[] = [
  {
    id: 1,
    name: 'accounts-and-connections',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_sign_in TEXT
      );

      CREATE TABLE sessions (
        id_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        actor_id INTEGER,
        actor_name TEXT,
        action TEXT NOT NULL,
        target TEXT,
        ip TEXT
      );

      CREATE TABLE connections (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('canvas', 'claude')),
        base_url TEXT,
        secret_encrypted BLOB NOT NULL,
        status TEXT NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'ok', 'failed')),
        last_verified TEXT,
        last_error TEXT,
        PRIMARY KEY (user_id, kind)
      );
    `,
  },
];
