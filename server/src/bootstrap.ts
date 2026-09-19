import { MIN_PASSWORD_LENGTH } from '@waypoint/shared';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { hashPassword } from './passwords.js';
import { audit } from './auth.js';

/** Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD when no admin exists. Returns true if created. */
export async function ensureFirstAdmin(db: Db, config: Config): Promise<boolean> {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
  if (existing.n > 0) return false;

  if (!config.adminUsername || !config.adminPassword) {
    throw new Error('No admin exists yet: set ADMIN_USERNAME and ADMIN_PASSWORD for the first start.');
  }
  if (config.adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  db.prepare("INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, 'admin', 1)").run(
    config.adminUsername,
    await hashPassword(config.adminPassword),
  );
  audit(db, { action: 'first_admin_created', target: config.adminUsername });
  return true;
}
