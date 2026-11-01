import { mkdir, writeFile } from 'node:fs/promises';
const names = ['sdolle1775/marvel-lcg', 'sdolle1775/FESProject_Summarist'];
const records = [];
async function get(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ReleaseDesk-fixture-recorder',
    },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}`);
  return response.json();
}
for (const name of names) {
  const repo = await get(`/repos/${name}`);
  const recent = await get(`/repos/${name}/commits?per_page=6`);
  const base = recent.at(-1).parents[0]?.sha ?? recent.at(-1).sha;
  const head = recent[0].sha;
  const comparison = await get(`/repos/${name}/compare/${base}...${head}`);
  if (comparison.total_commits !== comparison.commits.length)
    throw new Error('Fixture comparison must be complete');
  records.push({
    githubId: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    baseSha: base,
    headSha: head,
    commits: comparison.commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login ?? c.commit.author?.name ?? 'Unknown author',
      date: c.commit.author?.date ?? c.commit.committer.date,
      url: c.html_url,
    })),
  });
}
await mkdir(new URL('../fixtures/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../fixtures/public-repositories.json', import.meta.url),
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      source: 'Public GitHub REST API comparisons; no private data or credentials',
      repositories: records,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Recorded ${records.length} complete public comparisons.`);
