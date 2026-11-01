import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, ensure } from './errors.js';

export interface GitHubRepo { githubId: number; owner: string; name: string; defaultBranch: string; htmlUrl: string; private: boolean }
export interface CommitFact { sha: string; message: string; author: string; date: string; url: string }
export interface Comparison { baseSha: string; headSha: string; commits: CommitFact[] }
export interface GitHubSource {
  repository(owner: string, name: string): Promise<GitHubRepo>;
  tags(owner: string, name: string, page: number): Promise<{ tags: { name: string; sha: string }[]; hasMore: boolean }>;
  resolve(owner: string, name: string, ref: string, signal?: AbortSignal): Promise<string>;
  compare(owner: string, name: string, base: string, head: string, signal?: AbortSignal): Promise<Comparison>;
}
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/i);
const commitSchema = z.object({
  sha: shaSchema, html_url: z.url(),
  commit: z.object({ message: z.string(), author: z.object({ name: z.string().nullable(), date: z.iso.datetime({ offset: true }) }).nullable(), committer: z.object({ date: z.iso.datetime({ offset: true }) }) }),
  author: z.object({ login: z.string() }).nullable(),
});
export class GitHubClient implements GitHubSource {
  private tail: Promise<unknown> = Promise.resolve();
  private blockedUntil = 0;
  private context: string;
  constructor(private pool: Pool, private token: string, private fetcher: typeof fetch = fetch) {
    this.context = createHash('sha256').update(token).digest('hex').slice(0, 16);
  }
  private async request(url: string, signal?: AbortSignal): Promise<{ body: any; link: string | null }> {
    const task = this.tail.catch(() => {}).then(async () => {
      ensure(new URL(url).origin === 'https://api.github.com', 502, 'UPSTREAM_URL', 'GitHub returned an invalid pagination URL.');
      if (Date.now() < this.blockedUntil) throw new AppError(429, 'GITHUB_RATE_LIMIT', 'GitHub is rate limited. Please retry later.', new Date(this.blockedUntil).toISOString());
      const key = `${this.context}:${url}`;
      const cached = (await this.pool.query('SELECT etag,body,link FROM github_cache WHERE key=$1', [key])).rows[0];
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ReleaseDesk' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      let response: Response;
      try { response = await this.fetcher(url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), redirect: 'error' }); }
      catch { throw new AppError(504, 'GITHUB_TIMEOUT', 'GitHub could not be reached. Your saved draft is unchanged; retry shortly.'); }
      if (response.status === 304 && cached) return { body: cached.body, link: cached.link };
      if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
        const retryAfter = Number(response.headers.get('retry-after') || 0) * 1000;
        const reset = Number(response.headers.get('x-ratelimit-reset') || 0) * 1000;
        this.blockedUntil = Math.max(Date.now() + (retryAfter || 60000), reset);
        throw new AppError(429, 'GITHUB_RATE_LIMIT', 'GitHub is rate limited. Your saved draft is unchanged.', new Date(this.blockedUntil).toISOString());
      }
      if (response.status === 404) throw new AppError(422, 'GITHUB_NOT_FOUND', 'The public repository or reference was not found. Check owner, name, and references.');
      if (response.status === 401 || response.status === 403) throw new AppError(502, 'GITHUB_CREDENTIALS', 'The server GitHub credential is unavailable or lacks access.');
      if (response.status === 422 || response.status === 409) throw new AppError(422, 'INVALID_RANGE', 'GitHub could not compare these references. Choose a base commit that is an ancestor of the head.');
      if (!response.ok) throw new AppError(502, 'GITHUB_ERROR', 'GitHub returned an error. Your saved draft is unchanged.');
      let body: any;
      try { body = await response.json(); } catch { throw new AppError(502, 'GITHUB_RESPONSE', 'GitHub returned an invalid response.'); }
      // File patches are irrelevant to release entries and can dwarf the commit data.
      if (body && !Array.isArray(body) && 'files' in body) delete body.files;
      const link = response.headers.get('link');
      await this.pool.query('INSERT INTO github_cache(key,etag,body,link) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET etag=EXCLUDED.etag,body=EXCLUDED.body,link=EXCLUDED.link,cached_at=now()', [key, response.headers.get('etag'), JSON.stringify(body), link]);
      return { body, link };
    });
    this.tail = task;
    return task;
  }
  private path(owner: string, name: string) { return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`; }
  async repository(owner: string, name: string): Promise<GitHubRepo> {
    const { body } = await this.request(this.path(owner, name));
    const repo = z.object({ id: z.number().int().positive(), private: z.boolean(), owner: z.object({ login: z.string() }), name: z.string(), default_branch: z.string(), html_url: z.url() }).parse(body);
    ensure(!repo.private, 422, 'PRIVATE_REPOSITORY', 'ReleaseDesk supports public repositories only.');
    return { githubId: repo.id, owner: repo.owner.login, name: repo.name, defaultBranch: repo.default_branch, htmlUrl: repo.html_url, private: repo.private };
  }
  async tags(owner: string, name: string, page: number) {
    const { body, link } = await this.request(`${this.path(owner, name)}/tags?per_page=100&page=${page}`);
    const tags = z.array(z.object({ name: z.string(), commit: z.object({ sha: shaSchema }) })).parse(body);
    return { tags: tags.map(t => ({ name: t.name, sha: t.commit.sha })), hasMore: !!link?.includes('rel="next"') };
  }
  async resolve(owner: string, name: string, ref: string, signal?: AbortSignal) {
    const { body } = await this.request(`${this.path(owner, name)}/commits/${encodeURIComponent(ref)}`, signal);
    return shaSchema.parse(body.sha);
  }
  async compare(owner: string, name: string, base: string, head: string, signal?: AbortSignal): Promise<Comparison> {
    let next: string | null = `${this.path(owner, name)}/compare/${base}...${head}?per_page=100&page=1`;
    const commits: CommitFact[] = [];
    const visited = new Set<string>();
    let total = -1;
    while (next) {
      ensure(!visited.has(next) && visited.size < 11, 502, 'INCOMPLETE_COMPARISON', 'GitHub returned invalid pagination.');
      visited.add(next);
      const result = await this.request(next, signal);
      const body = z.object({ status: z.enum(['ahead', 'behind', 'diverged', 'identical']), total_commits: z.number().int().nonnegative(), commits: z.array(commitSchema) }).parse(result.body);
      ensure(body.status === 'ahead' || body.status === 'identical', 422, 'INVALID_RANGE', 'The base must be an ancestor of the head. Reversed or divergent ranges cannot be imported.');
      ensure(body.total_commits <= 1000, 422, 'RANGE_TOO_LARGE', 'Choose a smaller range: a release can import at most 1,000 commits.');
      if (total === -1) total = body.total_commits;
      ensure(total === body.total_commits, 502, 'INCOMPLETE_COMPARISON', 'GitHub changed the comparison during pagination.');
      commits.push(...body.commits.map(c => ({ sha: c.sha, message: c.commit.message, author: c.author?.login ?? c.commit.author?.name ?? 'Unknown author', date: c.commit.author?.date ?? c.commit.committer.date, url: c.html_url })));
      next = result.link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
      if (next) ensure(new URL(next).pathname === new URL([...visited][0]).pathname, 502, 'UPSTREAM_URL', 'GitHub returned invalid pagination.');
    }
    ensure(commits.length === total && new Set(commits.map(c => c.sha)).size === total, 502, 'INCOMPLETE_COMPARISON', 'GitHub returned an incomplete comparison. Your saved draft is unchanged.');
    return { baseSha: base, headSha: head, commits };
  }
}
