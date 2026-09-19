import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const DATA_HARNESS_PORT = 4174;
const DATA_HARNESS_BASE_URL = `http://localhost:${DATA_HARNESS_PORT.toString()}/thai-government-budget-planner/`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${PORT.toString()}/thai-government-budget-planner/`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/data/**'],
    },
    {
      // T-203 §4: data layer integration (DuckDB-WASM + repo) รันกับ build จริงที่เปิด harness
      // route ไว้ (`--mode e2e-harness`) — build แยกจาก dist ปกติเสมอ (ห้ามมี harness ใน bundle
      // production — ดู vite.config.ts / DataHarnessRoute.stub.tsx)
      // timeout สูงกว่าปกติ: query แรกของแต่ละ test ต้องโหลด+instantiate DuckDB-WASM (~38 MB ไม่บีบ
      // อัดตอน local preview) ก่อนถึงจะ query ได้จริง
      name: 'chromium-data',
      testMatch: ['**/data/**'],
      timeout: 120_000,
      use: { ...devices['Desktop Chrome'], baseURL: DATA_HARNESS_BASE_URL },
    },
  ],
  webServer: [
    {
      command: 'npm run preview -- --port 4173',
      url: `http://localhost:${PORT.toString()}/thai-government-budget-planner/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // ไม่ใช้ npm script ใหม่ (ห้ามแก้ package.json ตามขอบเขตงาน T-203) — เรียก vite CLI ตรง ๆ
      // build ลง outDir แยก (`dist-e2e-harness`) แล้ว preview คนละพอร์ตจาก dist ปกติ ข้อมูลจริงใน
      // `web/public/data/` + `web/public/duckdb-ext/` ถูกคัดลอกไปด้วยอัตโนมัติ (Vite publicDir)
      command:
        'npx vite build --mode e2e-harness --outDir dist-e2e-harness && ' +
        `npx vite preview --outDir dist-e2e-harness --port ${DATA_HARNESS_PORT.toString()} --strictPort`,
      url: DATA_HARNESS_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
