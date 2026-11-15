import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  use: { baseURL: 'http://localhost:5199', viewport: { width: 1100, height: 1300 } },
  webServer: {
    command: 'npx vite --mode mock --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
