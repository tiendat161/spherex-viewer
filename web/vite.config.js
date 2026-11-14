import { defineConfig } from 'vite';
import { mockApi } from './mock/plugin.js';

// `vite --mode mock`: serve /api from web/mock (dev server only).
// `vite` (default mode): proxy /api to the real API on :8000.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'mock' ? [mockApi()] : [],
  server: {
    port: 5173,
    proxy: mode === 'mock' ? undefined : { '/api': 'http://localhost:8000' },
  },
  build: { outDir: 'dist', sourcemap: false },
}));
