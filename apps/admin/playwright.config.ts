import { defineConfig, devices } from '@playwright/test'

const isLiveMode = process.env.E2E_LIVE_API === '1' || process.env.E2E_LIVE_PERSISTED === '1'
const useLiveApi = isLiveMode
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const superAdminEmails =
  process.env.SUPER_ADMIN_EMAILS ?? process.env.E2E_ADMIN_EMAIL ?? 'smoke.admin@example.com'

const frontendWebServer = {
  command: 'bun run dev --host 127.0.0.1 --port 4173',
  cwd: '.',
  url: 'http://127.0.0.1:4173',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
} as const

const apiWebServer = {
  command:
    `bun run dev --port 8787 --var BETTER_AUTH_SECRET:test-secret-at-least-32-characters --var SUPER_ADMIN_EMAILS:${superAdminEmails}`,
  cwd: '../api',
  url: 'http://127.0.0.1:8787',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
} as const

export default defineConfig({
  testDir: './e2e',
  testIgnore: isLiveMode ? [] : ['**/live-*.spec.ts'],
  outputDir: '.playwright/test-results',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        },
      },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : useLiveApi
      ? [apiWebServer, frontendWebServer]
      : frontendWebServer,
})
