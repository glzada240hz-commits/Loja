import { loadConfig } from '../config.js';
import { createDb } from './index.js';
import { runMigrations } from './migrate.js';

const cfg = loadConfig();
const { db, pool } = createDb(cfg.DATABASE_URL);
await runMigrations(db);
console.log('Migrations aplicadas.');
await pool.end();
