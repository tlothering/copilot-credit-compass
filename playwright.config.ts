import { defineConfig, devices } from '@playwright/test';

/**
 * The port is parameterised because `reuseExistingServer` will happily adopt *any*
 * listener already bound to the port — including a dev server from an unrelated
 * repository — and the whole suite then silently asserts against the wrong app.
 * Set E2E_PORT to run against an isolated port, or E2E_BASE_URL to skip the
 * managed server entirely.
 */
const port = Number(process.env.E2E_PORT ?? 3000);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './e2e-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -- --port ${port} --hostname 127.0.0.1`,
        url: origin,
        // Only ever adopt a running server when the caller has explicitly asked for it.
        reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
        timeout: 180_000,
        env: { PERSISTENCE_MODE: 'file', NODE_ENV: 'production' },
      },
});
