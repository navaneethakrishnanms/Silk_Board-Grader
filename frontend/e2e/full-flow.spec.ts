/**
 * Full flow (Section 11): create -> before upload -> regions -> pending -> after upload
 * -> grade -> review -> complete -> PDF.
 * Prerequisites: MySQL + API + engine + web running, seeded users, and synthetic images:
 *   python backend/engine/tools/make_synthetic.py --out storage/synthetic
 * Run: npx playwright install chromium && npm run e2e -w @silkgrade/web
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';

const CASE = path.resolve(process.cwd(), '../storage/synthetic/plain_shift_3_4');
const login = async (page: import('@playwright/test').Page, email: string, password: string) => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear()); // sign out any previous user
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
};

test('tester grades a test, expert reviews and completes it', async ({ page }) => {
  await login(page, 'tester@silkgrade.local', 'Tester@12345');
  await page.goto('/tests/new');
  const sampleId = `E2E-${Date.now()}`;
  await page.getByLabel('Sample ID *').fill(sampleId);
  await page.getByRole('button', { name: /Create test/ }).click();

  for (const [title, file] of [['Specimen (unwashed)', 'specimen_before.png'], ['Adjacent 1', 'adj1_before.png'], ['Adjacent 2', 'adj2_before.png']]) {
    const slot = page.locator('div.surface', { hasText: title }).first();
    await slot.locator('input[type=file]').first().setInputFiles(path.join(CASE, file));
    await expect(slot.getByText('Resolution')).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'Next: confirm regions' }).click();
  await page.getByRole('button', { name: /Looks right/ }).click();
  await expect(page).toHaveURL(/\/pending/);

  await page.getByRole('row', { name: new RegExp(sampleId) }).getByRole('button').click();
  for (const [title, file] of [['Specimen (washed)', 'specimen_after.png'], ['Adjacent 1', 'adj1_after.png'], ['Adjacent 2', 'adj2_after.png']]) {
    const slot = page.locator('div.surface', { hasText: title }).first();
    await slot.locator('input[type=file]').first().setInputFiles(path.join(CASE, file));
    await expect(slot.getByText('Resolution')).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'Next: confirm regions' }).click();
  await page.getByRole('button', { name: /check alignment/ }).click();
  await page.getByRole('button', { name: 'Grade now' }).click();
  await expect(page.getByText('Colour change — overall')).toBeVisible({ timeout: 60_000 });
  const url = page.url();

  await login(page, 'expert@silkgrade.local', 'Expert@12345');
  await page.goto(url);
  const accept = page.getByRole('button', { name: /^Accept/ });
  await expect(accept.first()).toBeVisible();
  // override the first REVIEW grade (reason required), accept the rest
  await page.getByRole('button', { name: 'Override' }).first().click();
  await page.getByRole('combobox', { name: 'Expert grade' }).selectOption('3.5');
  await page.getByPlaceholder('Reason (required for an override)').fill('E2E override — visible fading at the edge');
  await page.getByRole('button', { name: 'Save override' }).click();
  await expect(page.getByText('E2E override', { exact: false })).toBeVisible();
  while ((await accept.count()) > 0) {
    const n = await accept.count();
    await accept.first().click();
    await expect(accept).toHaveCount(n - 1);
  }
  await page.getByRole('button', { name: 'Complete & generate report' }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^SG-\d{4}-\d{6}\.pdf$/);
  await page.getByRole('button', { name: 'View report' }).click();
  await expect(page.locator('iframe[title="Report PDF"]')).toBeVisible();
});
