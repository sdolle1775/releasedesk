import { test, expect, type Page } from '@playwright/test';
async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'A little clarity. A better release.' }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
});

test('a human edit survives sync, exports exactly, and finalizes into immutable history', async ({
  page,
}, info) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await demo(page);
  if (info.project.name === 'desktop')
    await page.screenshot({ path: 'docs/screenshots/overview.png', fullPage: true });
  await page.getByRole('button', { name: 'Try the sync demo' }).click();
  await expect(page.getByTestId('release-title')).toBeVisible();
  const first = page.getByTestId('changelog-entry').first();
  const before = await page.getByTestId('changelog-entry').count();
  await first.getByRole('button', { name: /Edit entry/ }).click();
  await first.getByLabel('Entry title').fill('A careful human rewrite that survives sync');
  await first.getByLabel('Category', { exact: true }).selectOption('feature');
  await first
    .getByLabel('Notes', { exact: true })
    .fill('Reviewed by a person. Keep this exact context.');
  await expect(page.getByRole('button', { name: 'Sync commits' })).toBeDisabled();
  await first.getByRole('button', { name: 'Save entry' }).click();
  await page.getByRole('button', { name: 'Sync commits' }).click();
  await expect(page.getByRole('status')).toContainText('2 new commits added');
  await expect(
    first.getByRole('heading', { name: 'A careful human rewrite that survives sync' }),
  ).toBeVisible();
  expect(await page.getByTestId('changelog-entry').count()).toBe(before + 2);
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Markdown preview', exact: true }).click();
  await page.getByRole('button', { name: 'Show Markdown source' }).click();
  const markdown = await page.getByRole('textbox', { name: 'Exported Markdown' }).inputValue();
  expect(markdown).toContain('A careful human rewrite that survives sync');
  expect(markdown).toContain('Reviewed by a person. Keep this exact context.');
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Entries & checklist' }).click();
  const checks = page.getByRole('checkbox');
  for (let i = 0; i < (await checks.count()); i++) await checks.nth(i).check();
  await page.getByRole('button', { name: 'Finalize release', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finalize release' }).click();
  await expect(page.getByText('A permanent record of what you shipped.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync commits' })).toHaveCount(0);
  const current = page.url();
  await page.reload();
  await expect(page.getByText('A permanent record of what you shipped.')).toBeVisible();
  expect(page.url()).toBe(current);
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Markdown preview', exact: true }).click();
  await page.getByRole('button', { name: 'Show Markdown source' }).click();
  expect(await page.getByRole('textbox', { name: 'Exported Markdown' }).inputValue()).toBe(
    markdown,
  );
  expect(failures).toEqual([]);
});

test('creates a draft from references and prevents accidental navigation away from edits', async ({
  page,
}, info) => {
  await demo(page);
  await page.getByRole('button', { name: 'New release', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Release title').fill('Browser-created release');
  await dialog.getByLabel('Base reference').fill('v1');
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByTestId('release-title')).toBeVisible();
  const first = page.getByTestId('changelog-entry').first();
  await first.getByRole('button', { name: /Edit entry/ }).click();
  await first.getByLabel('Entry title').fill('Unsaved change');
  await page.getByRole('link', { name: /ReleaseDesk/ }).click();
  await expect(page.getByRole('dialog', { name: 'Leave unsaved edits?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await first.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Rename release' }).click();
  await page.getByLabel('Release title', { exact: true }).fill('Renamed browser release');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  if (info.project.name === 'desktop')
    await page.screenshot({ path: 'docs/screenshots/release-workspace.png', fullPage: true });
  else await page.screenshot({ path: 'docs/screenshots/mobile-workspace.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('separate demo sessions remain isolated after a reset', async ({ page, browser }, info) => {
  test.skip(
    info.project.name === 'mobile',
    'Isolation already exercises two independent browser sessions on desktop.',
  );
  await demo(page);
  await page.getByTestId('release-card').first().click();
  const firstUrl = page.url();
  const context = await browser.newContext();
  const other = await context.newPage();
  await demo(other);
  await other.getByTestId('release-card').first().click();
  const otherUrl = other.url();
  expect(firstUrl).not.toBe(otherUrl);
  await page.goto(otherUrl);
  await expect(page.getByRole('alert')).toContainText('could not be found');
  await page.getByRole('button', { name: 'Reset sandbox' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sandbox' }).click();
  await expect(
    page.getByRole('heading', { name: 'A little clarity. A better release.' }),
  ).toBeVisible();
  await page.goto(firstUrl);
  await expect(page.getByRole('alert')).toContainText('could not be found');
  await other.reload();
  await expect(other.getByTestId('release-title')).toBeVisible();
  await context.close();
});
