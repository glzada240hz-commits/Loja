import pg from 'pg';
import { execFileSync } from 'node:child_process';

/** Recria o banco de E2E do zero, aplica migrations e o seed demonstrativo. */
async function main() {
  const url = process.env.E2E_DATABASE_URL ?? 'postgres://guto:guto@localhost:5432/guto_e2e';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await c.end();
  execFileSync('node', ['apps/server/dist/db/seed-cli.js'], {
    env: { ...process.env, DATABASE_URL: url, SEED_ADMIN_PASSWORD: 'admin-e2e-123', NODE_ENV: 'development', MIGRATIONS_DIR: 'apps/server/migrations' },
    stdio: 'inherit',
  });
}

await main();
