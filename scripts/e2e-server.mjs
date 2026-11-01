import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPool, migrate } from '../apps/api/dist/db.js';
import { createApp } from '../apps/api/dist/app.js';
import { bootstrapUsers } from '../apps/api/dist/auth.js';
import { recordedRepositories } from '../apps/api/dist/service.js';
let postgres;
let directory;
let databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  directory = await mkdtemp(join(tmpdir(), 'releasedesk-e2e-'));
  postgres = new EmbeddedPostgres({
    databaseDir: directory,
    user: 'releasedesk',
    password: 'releasedesk',
    port: 54331,
    persistent: true,
    onLog: () => {},
    onError: () => {},
    postgresFlags: ['-h', '127.0.0.1'],
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('releasedesk_test');
  databaseUrl = 'postgres://releasedesk:releasedesk@127.0.0.1:54331/releasedesk_test';
}
const basePool = createPool(databaseUrl);
const schema = 'e2e_' + randomUUID().replaceAll('-', '');
await basePool.query(`CREATE SCHEMA ${schema}`);
const url = new URL(databaseUrl);
url.searchParams.set('options', `-c search_path=${schema}`);
databaseUrl = url.toString();
await migrate(databaseUrl, schema);
const pool = createPool(databaseUrl);
const config = {
  NODE_ENV: 'test',
  PORT: 3100,
  APP_ORIGIN: 'http://127.0.0.1:3100',
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: 'e2e-test-session-secret-with-at-least-32-characters',
  GITHUB_TOKEN: '',
  OWNER_USERNAME: 'owner',
  OWNER_PASSWORD: 'test-owner-password',
  DEMO_ENABLED: 'true',
  DEMO_USERNAME: 'demo',
  DEMO_PASSWORD: 'releasedesk',
};
await bootstrapUsers(pool, config);
const record = (await recordedRepositories())[0];
const github = {
  repository: async (owner, name) => ({
    githubId: 989898,
    owner,
    name,
    defaultBranch: 'master',
    htmlUrl: `https://github.com/${owner}/${name}`,
    private: false,
  }),
  tags: async () => ({ tags: [{ name: 'v1', sha: record.baseSha }], hasMore: false }),
  resolve: async (_owner, _name, ref) => (ref === 'v1' ? record.baseSha : record.headSha),
  compare: async () => record,
};
// Automated browser tests must never use the live GitHub API.
globalThis.fetch = async () => {
  throw new Error('Unexpected outgoing network request in E2E server');
};
const app = createApp(config, pool, github);
const server = app.listen(3100, '127.0.0.1', () =>
  console.log('ReleaseDesk E2E ready: http://127.0.0.1:3100'),
);
async function stop() {
  await new Promise((resolve) => server.close(resolve));
  app.locals.sessionStore.close();
  await pool.end();
  await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
  await basePool.end();
  if (postgres) await postgres.stop();
  if (directory) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'releasedesk-e2e-'))
      throw new Error('Unexpected temporary database path');
    await rm(directory, { recursive: true, force: true });
  }
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
