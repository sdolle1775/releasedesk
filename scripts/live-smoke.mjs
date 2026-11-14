import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const origin = new URL(process.env.RELEASEDESK_URL || 'http://127.0.0.1:3000');
assert.ok(
  ['http:', 'https:'].includes(origin.protocol) &&
    !origin.username &&
    !origin.password &&
    origin.pathname === '/' &&
    !origin.search &&
    !origin.hash,
  'RELEASEDESK_URL must be an HTTP(S) origin without credentials or a page path.',
);
const record = JSON.parse(
  await readFile(new URL('../fixtures/public-repositories.json', import.meta.url), 'utf8'),
).repositories[0];

class DemoClient {
  cookies = new Map();
  csrf = '';
  authenticated = false;

  async request(path, method = 'GET', body, expected = 200) {
    const response = await fetch(new URL(`/api${path}`, origin), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      headers: {
        cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(method === 'GET' ? {} : { 'x-csrf-token': this.csrf }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const separator = pair.indexOf('=');
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const value = response.status === 204 ? null : await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${path} returned ${response.status}. ${value?.error?.message ?? ''} ${value?.error?.retryAt ? `Retry after ${value.error.retryAt}.` : ''}`,
    );
    if (value?.csrfToken) this.csrf = value.csrfToken;
    return value;
  }

  async login() {
    const initial = await this.request('/auth/session');
    assert.ok(initial.demo.enabled, 'Enable the demo workspace before running this check.');
    await this.request('/auth/login', 'POST', {
      username: initial.demo.username,
      password: initial.demo.password,
    });
    this.authenticated = true;
    const session = await this.request('/auth/session');
    assert.equal(session.workspace.kind, 'demo');
    assert.notEqual(session.csrfToken, initial.csrfToken, 'Login must rotate the CSRF token.');
    return session;
  }

  async logout() {
    await this.request('/auth/logout', 'POST', {}, 204);
    this.authenticated = false;
  }
}

const first = new DemoClient();
const second = new DemoClient();
try {
  assert.equal((await first.request('/health')).status, 'ok');
  const firstSession = await first.login();
  const secondSession = await second.login();
  assert.notEqual(firstSession.workspace.id, secondSession.workspace.id);
  const otherReleases = await second.request('/releases');
  assert.ok(otherReleases.length, 'Expected seeded releases in the second sandbox.');

  const repository = await first.request(
    '/repositories',
    'POST',
    {
      owner: record.owner,
      name: record.name,
    },
    201,
  );
  let release = await first.request(
    `/repositories/${repository.id}/releases`,
    'POST',
    {
      title: 'Live release readiness check',
      baseRef: record.baseSha,
      headRef: record.headSha,
    },
    201,
  );
  assert.ok(release.entries.length, 'The live comparison must contain commits.');
  assert.equal(release.source, 'github');
  assert.equal(release.baseSha, record.baseSha);
  assert.equal(release.headSha, record.headSha);
  const entry = release.entries[0];
  const editorial = {
    titleOverride: 'Human edit preserved by live sync',
    categoryOverride: 'fix',
    notes: 'Verified against the public GitHub API.',
  };
  await first.request(`/releases/${release.id}/entries/${entry.id}`, 'PATCH', editorial);
  const check = release.checklist[0];
  await first.request(`/releases/${release.id}/checklist/${check.id}`, 'PATCH', {
    text: 'Live import reviewed',
    completed: true,
  });
  release = await first.request(`/releases/${release.id}/sync`, 'POST', {});
  const savedEntry = release.entries.find((item) => item.id === entry.id);
  for (const [key, value] of Object.entries(editorial)) assert.equal(savedEntry[key], value);
  assert.equal(release.checklist.find((item) => item.id === check.id).text, 'Live import reviewed');
  assert.equal(release.checklist.find((item) => item.id === check.id).completed, true);
  assert.equal(release.syncRuns[0].status, 'succeeded');
  console.log(
    `Live import and edit-preserving sync passed for ${record.owner}/${record.name} (${release.entries.length} commits).`,
  );

  for (const item of release.checklist) {
    if (!item.completed) {
      await first.request(`/releases/${release.id}/checklist/${item.id}`, 'PATCH', {
        completed: true,
      });
    }
  }
  const exported = await first.request(`/releases/${release.id}/markdown`);
  assert.ok(exported.markdown.includes(editorial.titleOverride));
  assert.ok(exported.markdown.includes(editorial.notes));
  const final = await first.request(`/releases/${release.id}/finalize`, 'POST', {});
  assert.equal(final.status, 'finalized');
  assert.equal(final.markdown, exported.markdown);
  const blocked = await first.request(
    `/releases/${release.id}`,
    'PATCH',
    { title: 'Blocked change' },
    409,
  );
  assert.equal(blocked.error.code, 'FINALIZED');
  await first.request(`/releases/${release.id}/sync`, 'POST', {}, 409);
  const reloaded = await first.request(`/releases/${release.id}`);
  assert.equal(reloaded.markdown, exported.markdown);
  assert.equal(reloaded.title, final.title);
  await second.request(`/releases/${release.id}`, 'GET', undefined, 404);
  console.log('Exact Markdown export, immutable finalization, and workspace isolation passed.');

  await first.request('/demo/reset', 'POST', {});
  const reset = await first.request('/auth/session');
  assert.notEqual(reset.workspace.id, firstSession.workspace.id);
  await first.request(`/releases/${release.id}`, 'GET', undefined, 404);
  await second.request(`/releases/${otherReleases[0].id}`);
  await first.logout();
  await first.request('/releases', 'GET', undefined, 401);
  console.log('Sandbox reset and logout passed. Live release readiness check complete.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const client of [first, second]) {
    if (client.authenticated) {
      try {
        await client.logout();
      } catch {
        console.error(
          'Could not sign out a verification session. Its demo sandbox expires normally.',
        );
        process.exitCode = 1;
      }
    }
  }
}
