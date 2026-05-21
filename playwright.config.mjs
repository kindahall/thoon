import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.THOON_E2E_PORT ?? 3210);
const baseURL = process.env.THOON_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const e2eDataFile = join(tmpdir(), `thoon-playwright-${process.pid}.json`);

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  reporter: [['list']],
  retries: process.env.CI ? 1 : 0,
  testDir: './tests/e2e',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.THOON_E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -- -p ${port}`,
        env: {
          NEXT_TELEMETRY_DISABLED: '1',
          THOON_ADMIN_EMAIL: 'e2e-owner@thoon.local',
          THOON_ADMIN_PASSWORD_HASH: 'pbkdf2_sha256$310000$2mnroyUR4Tucq8tmE_FvHg$P4vCeukoNKLuLEpqHgvcq0E2zGBSS7W8OrhGnI-WrA8',
          THOON_AUTH_MODE: 'local-required',
          THOON_AUTH_SESSION_SECRET: 'playwright-local-session-secret-minimum-32-characters',
          THOON_COOKIE_SECURE: 'false',
          THOON_CRON_SECRET: 'playwright-local-cron-secret-minimum-32-characters',
          THOON_DATA_FILE: e2eDataFile,
          THOON_MARKET_DATA_PROVIDER: 'binance',
          THOON_MUTATION_RATE_LIMIT_MAX: '300',
        },
        reuseExistingServer: false,
        timeout: 90_000,
        url: `${baseURL}/charts`,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
