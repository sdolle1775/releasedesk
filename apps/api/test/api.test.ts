import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { spawnSync } from 'node:child_process';
import { createPool, migrate, transaction } from '../src/db.js';
import { createApp } from '../src/app.js';
import { bootstrapUsers } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { Comparison, GitHubSource } from '../src/github.js';
import { AppError } from '../src/errors.js';
import type { ReleaseDetail } from '@releasedesk/contracts';

const sha = (n: number) => n.toString(16).padStart(40, '0');
const fact = (n: number) => ({
  sha: sha(n),
  message: `fix: change ${n}`,
  author: 'sam',
  date: '2026-10-01T12:00:00Z',
  url: `https://github.com/example/repository/commit/${sha(n)}`,
});
const pool = createPool(process.env.TEST_DATABASE_URL!);
const config: Config = {
  NODE_ENV: 'test',
  PORT: 3000,
  APP_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: process.env.TEST_DATABASE_URL!,
  SESSION_SECRET: 'test-only-secret-with-at-least-32-characters',
  GITHUB_TOKEN: '',
  OWNER_USERNAME: 'sam',
  OWNER_PASSWORD: 'test-owner-password',
  DEMO_USERNAME: 'demo',
  DEMO_PASSWORD: 'releasedesk',
  DEMO_ENABLED: 'true',
};
let current: Comparison = { baseSha: sha(0), headSha: sha(2), commits: [fact(1), fact(2)] };
const github: GitHubSource = {
  repository: vi.fn(async (owner, name) => ({
    githubId: 123,
    owner,
    name,
    defaultBranch: 'master',
    htmlUrl: `https://github.com/${owner}/${name}`,
    private: false,
  })),
  tags: vi.fn(async () => ({ tags: [{ name: 'v1', sha: sha(0) }], hasMore: false })),
  resolve: vi.fn(async (_owner, _name, ref) => (ref === 'v1' ? sha(0) : current.headSha)),
  compare: vi.fn(async () => current),
};
let app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;
async function session(agent: Agent) {
  return (await agent.get('/api/auth/session')).body;
}
async function login(username = 'sam', password = 'test-owner-password') {
  const agent = request.agent(app);
  const initial = await session(agent);
  await agent
    .post('/api/auth/login')
    .set('x-csrf-token', initial.csrfToken)
    .send({ username, password })
    .expect(200);
  return { agent, csrf: (await session(agent)).csrfToken as string };
}
async function draft(auth: Awaited<ReturnType<typeof login>>) {
  const repo = (
    await auth.agent
      .post('/api/repositories')
      .set('x-csrf-token', auth.csrf)
      .send({ owner: 'example', name: 'repository' })
      .expect(201)
  ).body;
  const release = (
    await auth.agent
      .post(`/api/repositories/${repo.id}/releases`)
      .set('x-csrf-token', auth.csrf)
      .send({ title: 'v2', baseRef: 'v1', headRef: 'master' })
      .expect(201)
  ).body as ReleaseDetail;
  return release;
}
const patch = (auth: Awaited<ReturnType<typeof login>>, path: string, input: unknown) =>
  auth.agent.patch(path).set('x-csrf-token', auth.csrf).send(input);
const post = (auth: Awaited<ReturnType<typeof login>>, path: string) =>
  auth.agent.post(path).set('x-csrf-token', auth.csrf).send({});
beforeAll(async () => {
  await migrate(config.DATABASE_URL);
  await migrate(config.DATABASE_URL);
  await bootstrapUsers(pool, config);
});
beforeEach(async () => {
  app = createApp(config, pool, github);
  await pool.query('DELETE FROM sessions');
  await pool.query('DELETE FROM demo_sync_events');
  await pool.query("DELETE FROM workspaces WHERE kind='demo'");
  await pool.query('DELETE FROM repositories');
  current = { baseSha: sha(0), headSha: sha(2), commits: [fact(1), fact(2)] };
  vi.mocked(github.compare)
    .mockReset()
    .mockImplementation(async () => current);
  vi.mocked(github.repository)
    .mockReset()
    .mockImplementation(async (owner, name) => ({
      githubId: 123,
      owner,
      name,
      defaultBranch: 'master',
      htmlUrl: `https://github.com/${owner}/${name}`,
      private: false,
    }));
});
afterEach(() => app.locals.sessionStore.close());
afterAll(async () => {
  await pool.end();
});

describe('persistent release API with real PostgreSQL', () => {
  it('rotates an owner password administratively and invalidates existing sessions', async () => {
    const run = (password: string) =>
      spawnSync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'apps/api/src/scripts/owner-password.ts'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ...config,
            DATABASE_URL: config.DATABASE_URL,
            OWNER_USERNAME: 'rotation-test-owner',
            OWNER_PASSWORD: password,
            PORT: '3000',
          },
          windowsHide: true,
        },
      );
    expect(run('first-test-password').status).toBe(0);
    const auth = await login('rotation-test-owner', 'first-test-password');
    expect(run('second-test-password').status).toBe(0);
    await auth.agent.get('/api/releases').expect(401);
    await login('rotation-test-owner', 'second-test-password');
  });
  it('bounds active demo sandboxes without exposing another workspace', async () => {
    const user = (await pool.query("SELECT id FROM users WHERE role='demo'")).rows[0];
    await pool.query(
      "INSERT INTO workspaces(user_id,kind,expires_at) SELECT $1,'demo',now()+interval '24 hours' FROM generate_series(1,100)",
      [user.id],
    );
    const agent = request.agent(app);
    const initial = await session(agent);
    const result = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', initial.csrfToken)
      .send({ username: 'demo', password: 'releasedesk' })
      .expect(503);
    expect(result.body.error.code).toBe('DEMO_CAPACITY');
  });
  it('reclaims an interrupted sync safely', async () => {
    const auth = await login();
    const release = await draft(auth);
    await pool.query(
      "INSERT INTO sync_runs(repository_id,release_id,status,started_at) VALUES($1,$2,'running',now()-interval '3 minutes')",
      [release.repositoryId, release.id],
    );
    const result = (await post(auth, `/api/releases/${release.id}/sync`).expect(200)).body;
    expect(result.syncRuns.some((r: any) => r.errorCode === 'SYNC_EXPIRED')).toBe(true);
    expect(result.entries).toEqual(release.entries);
  });
  it('keeps the demo IP quota across resets and new sandbox sessions', async () => {
    const auth = await login('demo', 'releasedesk');
    const releases = (await auth.agent.get('/api/releases')).body;
    for (let i = 0; i < 10; i++)
      await post(auth, `/api/releases/${releases[0].id}/sync`).expect(200);
    await post(auth, `/api/releases/${releases[0].id}/sync`).expect(429);
    await post(auth, '/api/demo/reset').expect(200);
    auth.csrf = (await session(auth.agent)).csrfToken;
    const fresh = (await auth.agent.get('/api/releases')).body;
    await post(auth, `/api/releases/${fresh[0].id}/sync`).expect(429);
  });
  it('requires explicit exclusion of missing commits before finalization', async () => {
    const auth = await login();
    const release = await draft(auth);
    current = { ...current, commits: [fact(2)] };
    await post(auth, `/api/releases/${release.id}/sync`).expect(200);
    for (const item of release.checklist)
      await patch(auth, `/api/releases/${release.id}/checklist/${item.id}`, { completed: true });
    const blocked = await post(auth, `/api/releases/${release.id}/finalize`).expect(409);
    expect(blocked.body.error.code).toBe('MISSING_COMMITS');
    await patch(auth, `/api/releases/${release.id}/entries/${release.entries[0].id}`, {
      excluded: true,
    });
    await post(auth, `/api/releases/${release.id}/finalize`).expect(200);
  });
  it('rotates login sessions and rejects the previous CSRF token', async () => {
    const agent = request.agent(app);
    const initial = await session(agent);
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', initial.csrfToken)
      .send({ username: 'sam', password: 'test-owner-password' })
      .expect(200);
    const currentSession = await session(agent);
    expect(currentSession.csrfToken).not.toBe(initial.csrfToken);
    await agent
      .post('/api/repositories')
      .set('x-csrf-token', initial.csrfToken)
      .send({ owner: 'example', name: 'repo' })
      .expect(403);
    await agent
      .post('/api/repositories')
      .set('x-csrf-token', 'é'.repeat(64))
      .send({ owner: 'example', name: 'repo' })
      .expect(403);
  });
  it('rate limits repeated invalid sign-ins', async () => {
    const agent = request.agent(app);
    const initial = await session(agent);
    for (let i = 0; i < 10; i++)
      await agent
        .post('/api/auth/login')
        .set('x-csrf-token', initial.csrfToken)
        .send({ username: 'sam', password: 'incorrect' })
        .expect(401);
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', initial.csrfToken)
      .send({ username: 'sam', password: 'incorrect' })
      .expect(429);
  });
  it('preserves every editorial decision and checklist when new commits arrive', async () => {
    const auth = await login();
    const release = await draft(auth);
    const first = release.entries[0];
    await patch(auth, `/api/releases/${release.id}/entries/${first.id}`, {
      titleOverride: 'A careful human rewrite',
      categoryOverride: 'breaking',
      notes: 'Keep this exact explanation',
      excluded: true,
    }).expect(200);
    await patch(auth, `/api/releases/${release.id}/checklist/${release.checklist[0].id}`, {
      text: 'My custom readiness check',
      completed: true,
    }).expect(200);
    current = { ...current, headSha: sha(3), commits: [fact(1), fact(2), fact(3)] };
    const synced = (await post(auth, `/api/releases/${release.id}/sync`).expect(200))
      .body as ReleaseDetail;
    expect(synced.entries.find((e) => e.id === first.id)).toMatchObject({
      titleOverride: 'A careful human rewrite',
      categoryOverride: 'breaking',
      notes: 'Keep this exact explanation',
      excluded: true,
    });
    expect(synced.checklist[0]).toMatchObject({
      text: 'My custom readiness check',
      completed: true,
    });
    expect(synced.entries).toHaveLength(3);
    expect(synced.baseSha).toBe(sha(0));
    await post(auth, `/api/releases/${release.id}/sync`).expect(200);
    expect((await auth.agent.get(`/api/releases/${release.id}`)).body.entries).toHaveLength(3);
  });
  it('keeps the same commit independent across two release drafts', async () => {
    const auth = await login();
    const a = await draft(auth);
    const b = await draft(auth);
    await patch(auth, `/api/releases/${a.id}/entries/${a.entries[0].id}`, {
      titleOverride: 'Only this release',
    }).expect(200);
    expect(
      (await auth.agent.get(`/api/releases/${b.id}`)).body.entries[0].titleOverride,
    ).toBeNull();
  });
  it('retains missing commits, suppresses export, and restores overrides on reappearance', async () => {
    const auth = await login();
    const release = await draft(auth);
    await patch(auth, `/api/releases/${release.id}/entries/${release.entries[0].id}`, {
      titleOverride: 'Preserved title',
    });
    current = { ...current, commits: [fact(2)] };
    const missing = (await post(auth, `/api/releases/${release.id}/sync`)).body;
    expect(missing.entries[0].missing).toBe(true);
    expect(missing.markdown).not.toContain('Preserved title');
    current = { ...current, commits: [fact(1), fact(2)] };
    const restored = (await post(auth, `/api/releases/${release.id}/sync`)).body;
    expect(restored.entries[0]).toMatchObject({ missing: false, titleOverride: 'Preserved title' });
  });
  it('rolls back failed syncs and retains a failure audit', async () => {
    const auth = await login();
    const release = await draft(auth);
    vi.mocked(github.compare).mockRejectedValueOnce(
      new AppError(502, 'INCOMPLETE_COMPARISON', 'Later page failed'),
    );
    await post(auth, `/api/releases/${release.id}/sync`).expect(502);
    const saved = (await auth.agent.get(`/api/releases/${release.id}`)).body;
    expect(saved.entries).toEqual(release.entries);
    expect(saved.headSha).toBe(release.headSha);
    expect(saved.syncRuns[0].status).toBe('failed');
  });
  it('requires complete checklists, freezes Markdown, and rejects every finalized mutation', async () => {
    const auth = await login();
    const release = await draft(auth);
    await post(auth, `/api/releases/${release.id}/finalize`).expect(409);
    for (const item of release.checklist)
      await patch(auth, `/api/releases/${release.id}/checklist/${item.id}`, {
        completed: true,
      }).expect(200);
    const final = (await post(auth, `/api/releases/${release.id}/finalize`).expect(200)).body;
    expect(final.status).toBe('finalized');
    expect(final.markdown).toBe(release.markdown);
    await patch(auth, `/api/releases/${release.id}`, { title: 'Nope' }).expect(409);
    await patch(auth, `/api/releases/${release.id}/entries/${release.entries[0].id}`, {
      excluded: true,
    }).expect(409);
    await patch(auth, `/api/releases/${release.id}/checklist/${release.checklist[0].id}`, {
      completed: false,
    }).expect(409);
    await post(auth, `/api/releases/${release.id}/sync`).expect(409);
    await auth.agent
      .delete(`/api/releases/${release.id}`)
      .set('x-csrf-token', auth.csrf)
      .expect(409);
  });
  it('rejects finalization during an active sync and rejects overlapping syncs', async () => {
    const auth = await login();
    const release = await draft(auth);
    let resolve!: (value: Comparison) => void;
    let started!: () => void;
    const entered = new Promise<void>((r) => (started = r));
    vi.mocked(github.compare).mockImplementationOnce(() => {
      started();
      return new Promise((r) => (resolve = r));
    });
    const pending = post(auth, `/api/releases/${release.id}/sync`).then((r) => r);
    await entered;
    await post(auth, `/api/releases/${release.id}/sync`).expect(409);
    await post(auth, `/api/releases/${release.id}/finalize`).expect(409);
    resolve(current);
    expect((await pending).status).toBe(200);
  });
  it('isolates visitor sandboxes and reset cannot touch another visitor or owner', async () => {
    const owner = await login();
    const personal = await draft(owner);
    const a = await login('demo', 'releasedesk');
    const b = await login('demo', 'releasedesk');
    const aReleases = (await a.agent.get('/api/releases')).body;
    const bReleases = (await b.agent.get('/api/releases')).body;
    expect(aReleases).toHaveLength(2);
    expect(aReleases[0].id).not.toBe(bReleases[0].id);
    await a.agent.get(`/api/releases/${bReleases[0].id}`).expect(404);
    await a.agent.get(`/api/releases/${personal.id}`).expect(404);
    await post(a, '/api/demo/reset').expect(200);
    await a.agent.get(`/api/releases/${aReleases[0].id}`).expect(404);
    await b.agent.get(`/api/releases/${bReleases[0].id}`).expect(200);
    await owner.agent.get(`/api/releases/${personal.id}`).expect(200);
  });
  it('enforces CSRF, session rotation, validation, logout, and sandbox expiry', async () => {
    const auth = await login();
    await auth.agent.post('/api/repositories').send({ owner: 'a', name: 'b' }).expect(403);
    await auth.agent
      .post('/api/repositories')
      .set('x-csrf-token', auth.csrf)
      .set('origin', 'https://evil.example')
      .send({ owner: 'a', name: 'b' })
      .expect(403);
    await auth.agent
      .post('/api/repositories')
      .set('x-csrf-token', auth.csrf)
      .send({ owner: '../bad', name: 'b' })
      .expect(422);
    const demo = await login('demo', 'releasedesk');
    const info = await session(demo.agent);
    await pool.query("UPDATE workspaces SET expires_at=now()-interval '1 second' WHERE id=$1", [
      info.workspace.id,
    ]);
    await demo.agent.get('/api/releases').expect(401);
    await post(auth, '/api/auth/logout').expect(204);
    await auth.agent.get('/api/releases').expect(401);
  });
  it('rejects private repositories even when the GitHub source permits them', async () => {
    const auth = await login();
    vi.mocked(github.repository).mockResolvedValueOnce({
      githubId: 9,
      owner: 'example',
      name: 'private',
      private: true,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/example/private',
    });
    await auth.agent
      .post('/api/repositories')
      .set('x-csrf-token', auth.csrf)
      .send({ owner: 'example', name: 'private' })
      .expect(422);
    const release = await draft(auth);
    vi.mocked(github.repository).mockResolvedValueOnce({
      githubId: 123,
      owner: 'example',
      name: 'repository',
      private: true,
      defaultBranch: 'master',
      htmlUrl: 'https://github.com/example/repository',
    });
    await post(auth, `/api/releases/${release.id}/sync`).expect(422);
    expect((await auth.agent.get(`/api/releases/${release.id}`)).body.entries).toEqual(
      release.entries,
    );
  });
  it('supports empty comparisons, checklist CRUD, template snapshots, and draft deletion', async () => {
    const auth = await login();
    current = { baseSha: sha(0), headSha: sha(0), commits: [] };
    const release = await draft(auth);
    expect(release.entries).toEqual([]);
    await patch(auth, `/api/repositories/${release.repositoryId}`, {
      checklistTemplate: ['Only future drafts'],
    }).expect(200);
    expect((await auth.agent.get(`/api/releases/${release.id}`)).body.checklist).toHaveLength(5);
    const updated = (
      await post(auth, `/api/releases/${release.id}/checklist`).send({ text: 'Extra item' })
    ).body;
    expect(updated.checklist).toHaveLength(6);
    await auth.agent
      .delete(`/api/releases/${release.id}/checklist/${updated.checklist[5].id}`)
      .set('x-csrf-token', auth.csrf)
      .expect(200);
    await auth.agent
      .delete(`/api/releases/${release.id}`)
      .set('x-csrf-token', auth.csrf)
      .expect(204);
    await auth.agent.get(`/api/releases/${release.id}`).expect(404);
  });
  it('uses real transaction rollback when persistence fails after an upsert', async () => {
    const auth = await login();
    const release = await draft(auth);
    await transaction(pool, async (db) => {
      await db.query(
        "CREATE OR REPLACE FUNCTION reject_test_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.message='FAIL_TEST' THEN RAISE EXCEPTION 'intentional test failure'; END IF; RETURN NEW; END $$",
      );
      await db.query(
        'CREATE TRIGGER reject_test_commit BEFORE INSERT ON changelog_entries FOR EACH ROW EXECUTE FUNCTION reject_test_commit()',
      );
    });
    try {
      current = {
        ...current,
        headSha: sha(4),
        commits: [fact(1), fact(3), { ...fact(4), message: 'FAIL_TEST' }],
      };
      await post(auth, `/api/releases/${release.id}/sync`).expect(502);
      expect((await auth.agent.get(`/api/releases/${release.id}`)).body.entries).toEqual(
        release.entries,
      );
    } finally {
      await pool.query(
        'DROP TRIGGER reject_test_commit ON changelog_entries; DROP FUNCTION reject_test_commit()',
      );
    }
  });
});
