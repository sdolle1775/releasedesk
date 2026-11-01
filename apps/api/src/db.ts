import { Pool, type PoolClient } from 'pg';
import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';

export function createPool(url: string) {
  return new Pool({
    connectionString: url,
    max: 8,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
}
export async function transaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function migrate(url: string, schema = 'public') {
  await runner({
    databaseUrl: url,
    dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    migrationsSchema: schema,
    schema,
    count: Infinity,
    log: () => {},
  });
}
