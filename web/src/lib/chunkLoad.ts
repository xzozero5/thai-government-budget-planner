/**
 * จัดการ "ไฟล์ JS ของเวอร์ชันที่เปิดค้างอยู่ถูกแทนที่หลัง deploy" (พบจริง 2 ครั้งระหว่าง demo ของคุณนิว: เว็บ static บน
 * GitHub Pages แทนที่ไฟล์ทั้งชุดทุกครั้งที่ deploy → lazy chunk ที่แท็บเก่ายังไม่เคยโหลดจะ 404 ตอนถูกเรียก)
 *
 * สองชั้น: (1) `prefetchWhenIdle` — โหลด lazy chunk ที่ผู้ใช้น่าจะต้องใช้ล่วงหน้าตอนหน้าเว็บว่าง เพื่อให้แท็บที่เปิดค้างมี
 * ไฟล์ครบก่อนที่ deploy รอบใหม่จะมาถึง (เป็นไฟล์ static same-origin ล้วน — N5 ไม่กระทบ) (2) `isChunkLoadError` —
 * ให้ ErrorBoundary แยกกรณีนี้ออกจาก error ทั่วไป แล้วบอกทางออกที่ได้ผลจริง (รีเฟรช) แทนปุ่ม "ลองใหม่" ที่ไม่มีทาง
 * สำเร็จ (React.lazy จำ promise ที่ reject ไว้ และไฟล์เดิมไม่มีบนเซิร์ฟเวอร์แล้ว)
 */

/** ข้อความ error ของ dynamic import ที่ล้ม — ต่างกันตามเบราว์เซอร์ (Chromium / Firefox / Safari) */
const CHUNK_LOAD_ERROR_PATTERNS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

export function isChunkLoadError(message: string): boolean {
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

const IDLE_FALLBACK_DELAY_MS = 1500;

/**
 * เรียก `loaders` ทุกตัวตอนเบราว์เซอร์ว่าง (`requestIdleCallback`; ไม่มี = `setTimeout`) — เงียบ ๆ ไม่ throw ถ้าโหลดไม่ได้
 * (offline ฯลฯ: ตัวเรียกจริงจะ import ใหม่เองตอนใช้งาน) คืนฟังก์ชันยกเลิกสำหรับ cleanup ของ `useEffect`
 */
export function prefetchWhenIdle(loaders: readonly (() => Promise<unknown>)[]): () => void {
  let cancelled = false;
  const run = (): void => {
    if (cancelled) return;
    for (const load of loaders) {
      void load().catch(() => undefined);
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run);
    return () => {
      cancelled = true;
      window.cancelIdleCallback(handle);
    };
  }
  const timer = window.setTimeout(run, IDLE_FALLBACK_DELAY_MS);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}
