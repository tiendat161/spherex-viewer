import * as pw from '@playwright/test';
const { defineConfig } = pw;

const VIEWPORT = { width: 1100, height: 1300 };
// Browsers to run: E2E_BROWSERS=chromium,firefox,webkit (default: chromium only, so a
// machine without the other browsers installed still passes). Install them once with
// `npx playwright install firefox webkit` (binaries live outside the repo).
const names = (process.env.E2E_BROWSERS || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const devices = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' };
const projects = names.map((name) => ({ name, use: { ...pw.devices[devices[name]], viewport: VIEWPORT } }));


export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  use: { baseURL: 'http://localhost:5199', viewport: VIEWPORT },
  projects,
  webServer: {
    command: 'npx vite --mode mock --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
