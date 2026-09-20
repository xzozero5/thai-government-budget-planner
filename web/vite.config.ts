/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { cspMetaPlugin } from './vite-plugins/cspMeta';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages project site: https://xzozero5.github.io/thai-government-budget-planner/
  // (docs/04-ARCHITECTURE.md §D8) — ทุก data URL ต้องอ้างผ่าน import.meta.env.BASE_URL
  base: '/thai-government-budget-planner/',
  plugins: [react(), cspMetaPlugin()],
  resolve: {
    alias: [
      // T-203 §4: harness ของ data layer (Playwright e2e เท่านั้น) ต้องไม่มีใน production bundle
      // ปกติแม้แต่เป็น lazy chunk เปล่า ๆ — สลับไปใช้ stub นี้ (ก่อน Rollup จะเห็น `import()` จริงเลย)
      // ยกเว้นตอน build/dev ด้วย `--mode e2e-harness` เท่านั้น (ดู playwright.config.ts และ
      // src/app/dataHarness/DataHarnessRoute.stub.tsx) — **ต้องอยู่ก่อน** alias `@` เสมอ เพราะ
      // `@rollup/plugin-alias` ใช้ entry แรกที่ match (alias `@` แบบ prefix จะ match ก่อนเสมอถ้าอยู่
      // ก่อนหน้านี้ ทำให้ entry นี้ไม่มีผลเลย — เคยพลาดจุดนี้มาแล้ว ดู commit message)
      ...(mode === 'e2e-harness'
        ? []
        : [
            {
              find: '@/app/dataHarness/DataHarnessRoute',
              replacement: path.resolve(
                dirname,
                './src/app/dataHarness/DataHarnessRoute.stub.tsx',
              ),
            },
          ]),
      { find: '@', replacement: path.resolve(dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'tests/screenshots/**'],
  },
}));
