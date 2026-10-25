import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// numeric -> string (exato); int8 (count) -> number
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (err) => console.error('[db] erro no pool', err.message));
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
