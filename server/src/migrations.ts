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
  {
    id: 2,
    name: 'courses-assessments-jobs',
    sql: `
      CREATE TABLE courses (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        canvas_course_id TEXT NOT NULL,
        code TEXT,
        name TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        UNIQUE (user_id, canvas_course_id)
      );

      CREATE TABLE assessments (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
        course_label TEXT,
        title TEXT NOT NULL,
        weighting_text TEXT,
        weighting_percent REAL,
        ai_use TEXT,
        source TEXT NOT NULL CHECK (source IN ('canvas', 'photo', 'document')),
        canvas_assignment_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('reading', 'needs_check', 'confirmed', 'searching', 'ready', 'failed')),
        error_code TEXT,
        needs_own_focus INTEGER NOT NULL DEFAULT 0,
        focus_prompt TEXT,
        chosen_focus TEXT,
        source_text TEXT,
        read_method TEXT CHECK (read_method IN ('vision', 'parsed', 'canvas')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX assessments_user ON assessments(user_id);
      CREATE UNIQUE INDEX assessments_canvas_once ON assessments(user_id, canvas_assignment_id)
        WHERE canvas_assignment_id IS NOT NULL;

      CREATE TABLE assessment_parts (
        id INTEGER PRIMARY KEY,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        due_at TEXT,
        due_has_time INTEGER NOT NULL DEFAULT 1,
        due_text TEXT
      );
      CREATE INDEX assessment_parts_assessment ON assessment_parts(assessment_id);

      CREATE TABLE topics (
        id INTEGER PRIMARY KEY,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('keyword', 'skill'))
      );
      CREATE INDEX topics_assessment ON topics(assessment_id);

      CREATE TABLE source_files (
        id INTEGER PRIMARY KEY,
        assessment_id INTEGER NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        original_name TEXT,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL
      );

      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX jobs_queue ON jobs(status, id);
    `,
  },
];
