import { describe, expect, it } from 'vitest';
import {
  effectiveCategory,
  effectiveTitle,
  escapeMarkdown,
  renderMarkdown,
  suggestCategory,
} from '../src/logic.js';
import type { Entry } from '@releasedesk/contracts';
const entry = (values: Partial<Entry> = {}): Entry => ({
  id: '1',
  commitSha: 'a'.repeat(40),
  message: 'fix: old title',
  author: 'sam',
  committedAt: '2026-10-01T00:00:00Z',
  htmlUrl: 'https://github.com/test/repo/commit/' + 'a'.repeat(40),
  suggestedCategory: 'fix',
  position: 0,
  missing: false,
  titleOverride: null,
  categoryOverride: null,
  notes: '',
  excluded: false,
  ...values,
});
describe('release editorial logic', () => {
  it.each([
    ['feat(ui): add editor', 'feature'],
    ['fix: preserve notes', 'fix'],
    ['feat!: change API', 'breaking'],
    ['chore: cleanup\n\nBREAKING CHANGE: old format removed', 'breaking'],
    ['documentation', 'internal'],
  ])('categorizes %s', (message, expected) => expect(suggestCategory(message)).toBe(expected));
  it('uses explicit overrides and restores facts when cleared', () => {
    const e = entry({ titleOverride: 'My title', categoryOverride: 'feature' });
    expect(effectiveTitle(e)).toBe('My title');
    expect(effectiveCategory(e)).toBe('feature');
    expect(effectiveTitle({ ...e, titleOverride: null })).toBe('fix: old title');
  });
  it('renders groups chronologically and omits excluded and missing entries', () => {
    const md = renderMarkdown(
      { title: 'v1 [test]', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) },
      { htmlUrl: 'https://github.com/test/repo' },
      [
        entry({ titleOverride: 'Second', position: 2 }),
        entry({ titleOverride: 'First', position: 1, notes: 'A useful note' }),
        entry({ titleOverride: 'Hidden', excluded: true }),
        entry({ titleOverride: 'Missing', missing: true }),
      ],
    );
    expect(md.indexOf('First')).toBeLessThan(md.indexOf('Second'));
    expect(md).toContain('  A useful note');
    expect(md).not.toContain('Hidden');
    expect(md).not.toContain('Missing');
    expect(md).toContain('v1 \\[test\\]');
  });
  it('escapes Markdown titles and has a stable empty result', () => {
    expect(escapeMarkdown('<script>[click](javascript:bad)')).toContain('\\<script\\>');
    expect(
      renderMarkdown({ title: 'Empty', baseSha: null, headSha: null }, { htmlUrl: '' }, []),
    ).toContain('No changes included.');
  });
});
