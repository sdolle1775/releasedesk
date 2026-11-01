import { CATEGORY_LABELS, type Category, type Entry } from '@releasedesk/contracts';

export function suggestCategory(message: string): Category {
  if (/^[\w-]+(?:\([^\n)]*\))?!:/m.test(message) || /^BREAKING[ -]CHANGE:/m.test(message))
    return 'breaking';
  if (/^feat(?:\([^\n)]*\))?:/i.test(message)) return 'feature';
  if (/^fix(?:\([^\n)]*\))?:/i.test(message)) return 'fix';
  return 'internal';
}
export function escapeMarkdown(text: string) {
  return text.replace(/[\\`*_{}[\]<>#+.!|~-]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}
export function effectiveTitle(entry: Entry) {
  return entry.titleOverride ?? entry.message.split(/\r?\n/)[0];
}
export function effectiveCategory(entry: Entry) {
  return entry.categoryOverride ?? entry.suggestedCategory;
}
export function renderMarkdown(
  release: { title: string; baseSha: string | null; headSha: string | null },
  repository: { htmlUrl: string },
  entries: Entry[],
) {
  const lines = [`# ${escapeMarkdown(release.title)}`, ''];
  const included = entries
    .filter((e) => !e.excluded && !e.missing)
    .sort((a, b) => a.position - b.position || a.commitSha.localeCompare(b.commitSha));
  for (const category of ['breaking', 'feature', 'fix', 'internal'] as Category[]) {
    const group = included.filter((e) => effectiveCategory(e) === category);
    if (!group.length) continue;
    lines.push(`## ${CATEGORY_LABELS[category]}`, '');
    for (const entry of group) {
      lines.push(
        `- ${escapeMarkdown(effectiveTitle(entry))} ([${entry.commitSha.slice(0, 7)}](${entry.htmlUrl}))`,
      );
      if (entry.notes.trim())
        lines.push(
          ...entry.notes
            .trim()
            .split('\n')
            .map((line) => `  ${line}`),
        );
    }
    lines.push('');
  }
  if (!included.length) lines.push('No changes included.', '');
  if (release.baseSha && release.headSha)
    lines.push(
      `[Full comparison](${repository.htmlUrl}/compare/${release.baseSha}...${release.headSha})`,
      '',
    );
  return lines.join('\n');
}
