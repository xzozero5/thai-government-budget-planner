/**
 * T-203 §4 — route ของหน้า harness (data layer) ที่ต้องไม่มีใน production bundle ปกติ
 *
 * คุมด้วย `import.meta.env.MODE` ซึ่ง Vite แทนที่เป็นค่าคงที่ (string literal) ตอน build เสมอ —
 * เมื่อรัน `npm run build`/`vite build` ตรง ๆ (ไม่ส่ง `--mode`) ค่านี้คือ `'production'` เสมอ ทำให้
 * เงื่อนไขด้านล่าง fold เป็น `false` คงที่ตอน build และถูก dead-code-eliminate ทิ้งทั้ง branch
 * (รวมถึง `React.lazy` + `import()` ข้างใน) — ยืนยันด้วยการอ่าน `dist/assets/*.js` หลัง
 * `npm run build` แล้วไม่พบ "DataHarnessPage"/"__data-harness" เลย (ดูรายงานของ T-203)
 *
 * ทดสอบจริงต้อง build แยกด้วย `vite build --mode e2e-harness` (ดู `playwright.config.ts` — ไม่แตะ
 * `package.json` ตามขอบเขตงาน เรียก vite CLI ตรง ๆ ใน webServer.command)
 */
import { lazy, Suspense } from 'react';
import { Route } from 'react-router-dom';

const HARNESS_MODE = 'e2e-harness';

const LazyDataHarnessPage = lazy(() =>
  import('./DataHarnessPage').then((m) => ({ default: m.DataHarnessPage })),
);

export const dataHarnessRoute =
  import.meta.env.MODE === HARNESS_MODE ? (
    <Route
      key="__data-harness"
      path="/__data-harness"
      element={
        <Suspense fallback={null}>
          <LazyDataHarnessPage />
        </Suspense>
      }
    />
  ) : null;
