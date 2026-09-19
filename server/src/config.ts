export interface Config {
  /** Interface to listen on. 0.0.0.0 in Docker; 127.0.0.1 keeps the origin reachable only from this machine. */
  host: string;
  port: number;
  dataDir: string;
  allowedHost: string;
  cookieSecure: boolean;
  trustCloudflareHeaders: boolean;
  encryptionKey: Buffer;
  adminUsername: string | null;
  adminPassword: string | null;
  /** Directory of the built client, served in production. */
  clientDir: string | null;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new Error('ENCRYPTION_KEY is required (32 random bytes, base64).');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}).`);
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const allowedHost = env.ALLOWED_HOST?.trim().toLowerCase();
  if (!allowedHost) throw new Error('ALLOWED_HOST is required (the only accepted Host header).');

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535.');

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    dataDir: env.DATA_DIR?.trim() || './data',
    allowedHost,
    cookieSecure: bool(env.COOKIE_SECURE, true),
    trustCloudflareHeaders: bool(env.TRUST_CLOUDFLARE_HEADERS, false),
    encryptionKey: parseEncryptionKey(env.ENCRYPTION_KEY),
    adminUsername: env.ADMIN_USERNAME?.trim() || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    clientDir: env.CLIENT_DIR?.trim() || null,
  };
}
