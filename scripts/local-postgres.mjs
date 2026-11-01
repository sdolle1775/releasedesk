import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('.local/postgres');
mkdirSync(directory, { recursive: true });
const pg = new EmbeddedPostgres({ databaseDir: directory, user: 'releasedesk', password: 'releasedesk', port: 54329, persistent: true, onLog: () => {}, onError: message => console.error(message) });
if (!existsSync(resolve(directory, 'PG_VERSION'))) await pg.initialise();
await pg.start();
const client = pg.getPgClient('postgres');
await client.connect();
for (const name of ['releasedesk', 'releasedesk_test']) {
  if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();
console.log('PostgreSQL 17 ready on localhost:54329 (databases: releasedesk, releasedesk_test).');
const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 60000);
