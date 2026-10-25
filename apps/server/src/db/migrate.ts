import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

export function migrationsFolder() {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db -> ../../migrations ; dist -> ../migrations
  return here.endsWith(path.join('src', 'db')) ? path.resolve(here, '../../migrations') : path.resolve(here, '../migrations');
}

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
