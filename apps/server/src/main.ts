import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);
await pool.end();

const handle = await buildApp(config);
await handle.app.listen({ port: config.PORT, host: config.HOST });
handle.app.log.info(`Bar do Guto rodando em ${config.PUBLIC_BASE_URL} — WhatsApp: modo ${handle.wa.mode.toUpperCase()}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    handle.app.log.info('encerrando...');
    void handle.close().then(() => process.exit(0));
  });
}
