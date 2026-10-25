import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgres://guto:guto@localhost:5432/guto_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } }],
  webServer: {
    command: 'node apps/server/dist/main.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_URL: E2E_DB,
      PUBLIC_BASE_URL: `http://localhost:${PORT}`,
      WEB_DIST: 'apps/web/dist',
      UPLOAD_DIR: 'test-results/uploads',
      LOG_LEVEL: 'warn',
      LOGIN_RATE_LIMIT: '1000',
      CHECKOUT_RATE_LIMIT: '1000',
      MIGRATIONS_DIR: 'apps/server/migrations',
    },
  },
});
