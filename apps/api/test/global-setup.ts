import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:net';
export default async function setup() {
  if (process.env.TEST_DATABASE_URL) return;
  const port = await new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      s.close(() => resolve(typeof address === 'object' && address ? address.port : 54330));
    });
  });
  const directory = await mkdtemp(join(tmpdir(), 'releasedesk-test-'));
  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    user: 'releasedesk',
    password: 'releasedesk',
    port,
    persistent: true,
    onLog: () => {},
    onError: () => {},
    postgresFlags: ['-h', '127.0.0.1'],
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('releasedesk_test');
  process.env.TEST_DATABASE_URL = `postgres://releasedesk:releasedesk@127.0.0.1:${port}/releasedesk_test`;
  return async () => {
    await postgres.stop();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'releasedesk-test-'))
      throw new Error('Unexpected temporary database path');
    await rm(directory, { recursive: true, force: true });
  };
}
