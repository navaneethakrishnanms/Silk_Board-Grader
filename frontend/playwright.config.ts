import { defineConfig, devices } from '@playwright/test';

/** E2E: requires API + engine + web running (see README). */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
