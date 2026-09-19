import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/crypto.js';
import { parseEncryptionKey } from '../src/config.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';

describe('AES-256-GCM', () => {
  const key = randomBytes(32);

  it('round-trips, including unicode', () => {
    for (const text of ['sk-ant-secret', '', 'tökén ✓ 日本語']) {
      expect(decrypt(encrypt(text, key), key)).toBe(text);
    }
  });

  it('uses a fresh nonce each time', () => {
    expect(encrypt('same', key).equals(encrypt('same', key))).toBe(false);
  });

  it('does not contain the plaintext', () => {
    expect(encrypt('very-recognisable-secret', key).toString('latin1')).not.toContain('very-recognisable-secret');
  });

  it('detects tampering', () => {
    const blob = encrypt('secret', key);
    blob[blob.length - 1]! ^= 1;
    expect(() => decrypt(blob, key)).toThrow();
  });

  it('fails with the wrong key', () => {
    expect(() => decrypt(encrypt('secret', key), randomBytes(32))).toThrow();
  });
});

describe('ENCRYPTION_KEY parsing', () => {
  it('accepts 32 bytes of base64', () => {
    expect(parseEncryptionKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });
  it('rejects missing or short keys', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/required/);
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});
