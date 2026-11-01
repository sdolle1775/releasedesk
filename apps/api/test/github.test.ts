import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPool, migrate } from '../src/db.js';
import { GitHubClient } from '../src/github.js';
const pool = createPool(process.env.TEST_DATABASE_URL!);
const sha = (n: number) => n.toString(16).padStart(40, '0');
const commit = (n: number) => ({
  sha: sha(n),
  html_url: `https://github.com/example/repo/commit/${sha(n)}`,
  commit: {
    message: `feat: commit ${n}`,
    author: { name: 'Sam', date: '2026-10-01T00:00:00Z' },
    committer: { date: '2026-10-01T00:00:00Z' },
  },
  author: { login: 'sam' },
});
const response = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
beforeAll(async () => migrate(process.env.TEST_DATABASE_URL!));
beforeEach(async () => {
  await pool.query('DELETE FROM github_cache');
});
afterAll(async () => pool.end());
describe('GitHub adapter with recorded HTTP responses', () => {
  it('imports more than 250 commits using immutable SHAs and every pagination link', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const u = new URL(String(url));
      const page = Number(u.searchParams.get('page'));
      const start = (page - 1) * 100 + 1;
      const end = Math.min(page * 100, 301);
      return response(
        {
          status: 'ahead',
          total_commits: 301,
          commits: Array.from({ length: end - start + 1 }, (_, i) => commit(start + i)),
          files: [{ patch: 'not stored' }],
        },
        page < 4
          ? { link: `<${u.origin}${u.pathname}?per_page=100&page=${page + 1}>; rel="next"` }
          : {},
      );
    });
    const client = new GitHubClient(pool, 'test-token', fetcher);
    const result = await client.compare('example', 'repo', sha(0), sha(301));
    expect(result.commits).toHaveLength(301);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const call of fetcher.mock.calls)
      expect(String(call[0])).toContain(`${sha(0)}...${sha(301)}`);
    const cached = (await pool.query('SELECT body FROM github_cache LIMIT 1')).rows[0].body;
    expect(cached.files).toBeUndefined();
  });
  it('reuses the cached body on 304 and sends the ETag with authorization', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ sha: sha(1) }, { etag: '"recorded"' }))
      .mockResolvedValueOnce(response(null, {}, 304));
    const client = new GitHubClient(pool, 'test-token', fetcher);
    expect(await client.resolve('example', 'repo', 'feature/editor')).toBe(sha(1));
    expect(await client.resolve('example', 'repo', 'feature/editor')).toBe(sha(1));
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      'If-None-Match': '"recorded"',
      Authorization: 'Bearer test-token',
    });
    expect(String(fetcher.mock.calls[0][0])).toContain('feature%2Feditor');
  });
  it('rejects truncated pages, duplicate commits, and a failure after the first page', async () => {
    const incomplete = new GitHubClient(
      pool,
      '',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          response({ status: 'ahead', total_commits: 2, commits: [commit(1)] }),
        ),
    );
    await expect(incomplete.compare('example', 'repo', sha(0), sha(2))).rejects.toMatchObject({
      code: 'INCOMPLETE_COMPARISON',
    });
    const duplicate = new GitHubClient(
      pool,
      '',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          response({ status: 'ahead', total_commits: 2, commits: [commit(1), commit(1)] }),
        ),
    );
    await expect(duplicate.compare('example', 'repo', sha(0), sha(2))).rejects.toMatchObject({
      code: 'INCOMPLETE_COMPARISON',
    });
    const failed = new GitHubClient(
      pool,
      '',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          response(
            { status: 'ahead', total_commits: 2, commits: [commit(1)] },
            {
              link: `<https://api.github.com/repos/example/repo/compare/${sha(0)}...${sha(2)}?page=2>; rel="next"`,
            },
          ),
        )
        .mockResolvedValueOnce(response({}, {}, 503)),
    );
    await expect(failed.compare('example', 'repo', sha(0), sha(2))).rejects.toMatchObject({
      code: 'GITHUB_ERROR',
    });
  });
  it.each(['behind', 'diverged'])('rejects %s ranges', async (status) => {
    const client = new GitHubClient(
      pool,
      '',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ status, total_commits: 1, commits: [commit(1)] })),
    );
    await expect(client.compare('example', 'repo', sha(0), sha(1))).rejects.toMatchObject({
      code: 'INVALID_RANGE',
      status: 422,
    });
  });
  it('rejects oversized ranges and allows identical empty ranges', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ status: 'ahead', total_commits: 1001, commits: [] }))
      .mockResolvedValueOnce(response({ status: 'identical', total_commits: 0, commits: [] }));
    const client = new GitHubClient(pool, '', fetcher);
    await expect(client.compare('example', 'repo', sha(0), sha(1))).rejects.toMatchObject({
      code: 'RANGE_TOO_LARGE',
    });
    expect((await client.compare('example', 'repo', sha(0), sha(0))).commits).toEqual([]);
  });
  it('handles rate limits without repeatedly calling GitHub', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          {},
          {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 120),
          },
          403,
        ),
      );
    const client = new GitHubClient(pool, '', fetcher);
    await expect(client.resolve('example', 'repo', 'main')).rejects.toMatchObject({
      status: 429,
      code: 'GITHUB_RATE_LIMIT',
      retryAt: expect.any(String),
    });
    await expect(client.resolve('example', 'repo', 'main')).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects private repositories and gives unknown refs a useful error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          id: 1,
          private: true,
          owner: { login: 'example' },
          name: 'repo',
          default_branch: 'master',
          html_url: 'https://github.com/example/repo',
        }),
      )
      .mockResolvedValueOnce(response({}, {}, 404));
    const client = new GitHubClient(pool, '', fetcher);
    await expect(client.repository('example', 'repo')).rejects.toMatchObject({
      code: 'PRIVATE_REPOSITORY',
    });
    await expect(client.resolve('example', 'repo', 'missing')).rejects.toMatchObject({
      code: 'GITHUB_NOT_FOUND',
    });
  });
  it('rejects pagination outside the same comparison', async () => {
    const client = new GitHubClient(
      pool,
      '',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          response(
            { status: 'ahead', total_commits: 2, commits: [commit(1)] },
            { link: '<https://evil.example/steal>; rel="next"' },
          ),
        ),
    );
    await expect(client.compare('example', 'repo', sha(0), sha(2))).rejects.toMatchObject({
      code: 'UPSTREAM_URL',
    });
  });
});
