import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { autoImportOfficialMenu } from './services/menu.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);
await pool.end();

const handle = await buildApp(config);
if (config.OFFICIAL_MENU_AUTO === '1') {
  try {
    const r = await autoImportOfficialMenu(handle.deps);
    if (r) handle.app.log.warn(`Cardápio oficial ${r.version} colocado: ${r.created.length} criados, ${r.updated.length} atualizados, ${r.archived.length} exemplos fora`);
  } catch (e) {
    handle.app.log.error({ err: e }, 'não foi possível colocar o cardápio oficial (dá para importar em Cardápio)');
  }
}
await handle.app.listen({ port: config.PORT, host: config.HOST });
handle.app.log.info(`Bar do Guto rodando em ${config.PUBLIC_BASE_URL} — WhatsApp: modo ${handle.wa.mode.toUpperCase()}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    handle.app.log.info('encerrando...');
    void handle.close().then(() => process.exit(0));
  });
}
