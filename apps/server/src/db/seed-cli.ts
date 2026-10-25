import { loadConfig } from '../config.js';
import { createDb } from './index.js';
import { runMigrations } from './migrate.js';
import { DEMO_PASSWORD, seed } from './seed.js';

const cfg = loadConfig();
const pw = process.env.SEED_ADMIN_PASSWORD;
if (!pw || pw.length < 8) {
  console.error('Defina SEED_ADMIN_PASSWORD (mínimo 8 caracteres) para criar o administrador.');
  process.exit(1);
}
const demo = !process.argv.includes('--no-demo');
const { db, pool } = createDb(cfg.DATABASE_URL);
await runMigrations(db);
const r = await seed(db, { adminPassword: pw, demoUsers: demo && cfg.NODE_ENV !== 'production', demoData: demo });
if (r.skipped) console.log('Banco já possui usuários; seed ignorado.');
else {
  console.log('Seed concluído. Usuário: admin (senha definida em SEED_ADMIN_PASSWORD).');
  if (demo && cfg.NODE_ENV !== 'production') console.log(`Usuários demonstrativos: gerente, caixa, cozinha, moto1, moto2 — senha "${DEMO_PASSWORD}".`);
}
await pool.end();
