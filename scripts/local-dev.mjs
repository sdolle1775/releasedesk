import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
const children = [];
const run = (file, args = []) => {
  const child = spawn(process.execPath, [file, ...args], { stdio: 'inherit', windowsHide: true });
  children.push(child);
  return child;
};
if (!existsSync('.env')) {
  await writeFile(
    '.env',
    `NODE_ENV=development\nPORT=3000\nAPP_ORIGIN=http://localhost:5173\nDATABASE_URL=postgres://releasedesk:releasedesk@localhost:54329/releasedesk\nSESSION_SECRET=${randomBytes(48).toString('hex')}\nGITHUB_TOKEN=\nOWNER_USERNAME=sam\nOWNER_PASSWORD=\nDEMO_ENABLED=true\nDEMO_USERNAME=demo\nDEMO_PASSWORD=releasedesk\n`,
  );
  console.log('Created ignored .env with a random session secret. Demo login: demo / releasedesk.');
}
const pg = new Pool({
  connectionString: 'postgres://releasedesk:releasedesk@127.0.0.1:54329/releasedesk',
  connectionTimeoutMillis: 500,
});
let running = false;
try {
  await pg.query('SELECT 1');
  running = true;
} catch {
  /* start the local cluster */
} finally {
  await pg.end();
}
if (!running) {
  const child = run('scripts/local-postgres.mjs');
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    const check = setInterval(async () => {
      const probe = new Pool({
        connectionString: 'postgres://releasedesk:releasedesk@127.0.0.1:54329/releasedesk',
        connectionTimeoutMillis: 500,
      });
      try {
        await probe.query('SELECT 1');
        clearInterval(check);
        resolve();
      } catch {
        /* still starting */
      } finally {
        await probe.end();
      }
    }, 500);
    child.once('exit', (code) => {
      clearInterval(check);
      reject(new Error(`PostgreSQL exited with ${code}`));
    });
  });
}
await new Promise((resolve, reject) => {
  const child = run('node_modules/typescript/bin/tsc', ['-p', 'packages/contracts/tsconfig.json']);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error('Contracts build failed')),
  );
});
run('node_modules/tsx/dist/cli.mjs', ['watch', 'apps/api/src/server.ts']);
run('node_modules/vite/bin/vite.js', ['apps/web', '--host', '127.0.0.1']);
console.log('Open http://localhost:5173. Ctrl+C stops the services started by this command.');
const stop = () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
