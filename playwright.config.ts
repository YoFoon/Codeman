import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  retries: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:13337',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
