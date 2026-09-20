import { defineConfig, devices } from '@playwright/test';

/**
 * config แยกสำหรับถ่ายภาพหน้าจอประกอบ README (`tests/screenshots/`) — ไม่อยู่ใน CI และไม่ปนกับ
 * `playwright.config.ts` (e2e) ใช้ `dist` ปกติ (ต้อง `npx vite build` ก่อน) ที่พอร์ตเดียวกับ e2e
 */
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT.toString()}/thai-government-budget-planner/`;

export default defineConfig({
  testDir: './tests/screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'th-TH',
    colorScheme: 'light',
  },
  webServer: {
    command: `npm run preview -- --port ${PORT.toString()}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
