/**
 * Stub ของ `DataHarnessRoute.tsx` — ใช้แทนที่ตัวจริงตอน build ปกติ (ทุก mode ยกเว้น
 * `e2e-harness`) ผ่าน `resolve.alias` ใน `vite.config.ts`
 *
 * เหตุผลที่ต้องสลับที่ระดับ config (ไม่ใช่แค่ `if (import.meta.env.MODE === ...)` ในโค้ด):
 * ทดลองจริงแล้วพบว่า Rollup สร้าง chunk แยกให้กับ `import()` ที่อยู่ใน `React.lazy()` เสมอ แม้จะอยู่
 * หลัง condition ที่ fold เป็น `false` คงที่ตอน build ก็ตาม (Rollup ตัดสินใจแบ่ง chunk จากการเจอ
 * `import()` แบบ static-scan ก่อนขั้น minify/DCE จริง) — ยืนยันด้วยการรัน `npm run build` แล้วพบไฟล์
 * `DataHarnessPage-*.js` + `duckdb-eh-*.wasm` ปนอยู่ใน `dist/assets/` ทั้งที่ route ไม่ถูกใช้เลย
 * ⇒ ต้องกันที่ระดับ module resolution เพื่อไม่ให้ Rollup เห็นไฟล์จริงเลยตอน build ปกติ
 */
export const dataHarnessRoute = null;
