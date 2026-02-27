import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
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
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        // Use system Chrome instead of bundled Chromium for HEVC codec support
        // Must run headed (not headless) as headless Chrome lacks hardware video decoding
        channel: 'chrome',
        headless: false,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        // Headless mobile emulation — no HEVC video decoding needed for mobile layout tests
      },
    },
  ],
  webServer: {
    command: isCI ? 'npm run preview' : 'npm run dev',
    url: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
})
