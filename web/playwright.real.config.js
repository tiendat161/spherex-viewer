// Real-data run, started by verify/e2e.py, which serves the built app from the API
// and passes its address in E2E_BASE_URL. No dev server and no mock here.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e-real',
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL, viewport: { width: 1100, height: 900 } },
});
