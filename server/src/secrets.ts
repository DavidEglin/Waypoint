import type { ConnectionKind } from '@waypoint/shared';
import { ReadError } from './claude.js';
import type { Config } from './config.js';
import { decrypt } from './crypto.js';
import type { Db } from './db.js';

/** Decrypts one of the user's saved credentials for immediate use. Never returned to a client or logged. */
export function loadSecret(db: Db, config: Config, userId: number, kind: ConnectionKind): { secret: string; baseUrl: string | null } {
  const row = db.prepare('SELECT secret_encrypted, base_url FROM connections WHERE user_id = ? AND kind = ?').get(userId, kind) as
    | { secret_encrypted: Buffer; base_url: string | null }
    | undefined;
  const missing = kind === 'canvas' ? 'no_canvas' : 'no_claude_key';
  if (!row) throw new ReadError(missing);
  try {
    return { secret: decrypt(row.secret_encrypted, config.encryptionKey), baseUrl: row.base_url };
  } catch {
    // Unreadable (ENCRYPTION_KEY changed): the student has to enter it again.
    throw new ReadError(missing);
  }
}
