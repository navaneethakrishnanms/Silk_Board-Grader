/**
 * PWA installability on the PRODUCTION build (WP3.4).
 * Lighthouse 12 removed its PWA category, so this asks Chrome directly through the
 * DevTools protocol (Page.getInstallabilityErrors) — the same check Chrome uses for "Install app".
 * Run: npm run build -w @silkgrade/web && npx vite preview --port 4173 (in frontend/)  then
 *      PWA_URL=http://localhost:4173 npx playwright test e2e/pwa.spec.ts --project=desktop
 */
import { expect, test } from '@playwright/test';

const URL = process.env.PWA_URL ?? 'http://localhost:4173';

test('production build is installable', async ({ page, browserName }) => {
  test.skip(!process.env.PWA_URL, 'set PWA_URL to a running production preview (vite preview)');
  test.skip(browserName !== 'chromium', 'installability check uses the Chrome DevTools protocol');
  await page.goto(`${URL}/login`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const manifest = await (await page.request.get(`${URL}/manifest.webmanifest`)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  // once the service worker controls the page (second load), the app shell works offline
  await page.reload();
  await expect(page.getByRole('heading', { name: 'SilkGrade' })).toBeVisible();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'SilkGrade' })).toBeVisible();
  await page.context().setOffline(false);
});
