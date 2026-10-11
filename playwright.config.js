import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/form8-converter/',
    browserName: 'chromium',
    headless: true
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/form8-converter/',
    reuseExistingServer: false,
    timeout: 45000
  }
});
