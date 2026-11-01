import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { createPool, migrate } from '../src/db.js';
const url = process.env.TEST_DATABASE_URL!;
const pool = createPool(url);
afterAll(() => pool.end());
it('tracks migrations independently in an isolated schema after public migrations already ran', async () => {
  await migrate(url);
  const schema = 'migration_test_' + randomUUID().replaceAll('-', '');
  await pool.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  const isolated = createPool(scoped.toString());
  try {
    await migrate(scoped.toString(), schema);
    await migrate(scoped.toString(), schema);
    expect((await isolated.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(0);
    expect((await isolated.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n).toBe(2);
  } finally {
    await isolated.end();
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  }
});
