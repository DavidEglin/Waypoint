import { hash, verify } from '@node-rs/argon2';

/** @node-rs/argon2 defaults to argon2id; a test pins the `$argon2id$` prefix. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/** Verify against a throwaway hash so unknown usernames cost the same time as wrong passwords. */
export async function burnVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('waypoint-dummy-password');
  await verifyPassword(await dummyHash, password);
}
