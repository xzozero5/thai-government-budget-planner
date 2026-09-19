/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { cspMetaPlugin } from './vite-plugins/cspMeta';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages project site: https://xzozero5.github.io/thai-government-budget-planner/
  // (docs/04-ARCHITECTURE.md §D8) — ทุก data URL ต้องอ้างผ่าน import.meta.env.BASE_URL
  base: '/thai-government-budget-planner/',
  plugins: [react(), cspMetaPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
