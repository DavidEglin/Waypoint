import { buildApp } from './app.js';
import { ensureFirstAdmin } from './bootstrap.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dataDir);
  if (await ensureFirstAdmin(db, config)) {
    console.log(`Created first admin "${config.adminUsername}". They must change the password at first sign-in.`);
  }
  const app = buildApp({ config, db, logger: true });

  const stop = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
