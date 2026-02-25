import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: isCI ? 'npm run preview' : 'npm run dev',
    url: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
})
