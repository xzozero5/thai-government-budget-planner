import type { Plugin } from 'vite';

/**
 * Content-Security-Policy สำหรับ production build (GitHub Pages ไม่รองรับการตั้ง HTTP
 * response header เอง จึงต้องฝัง CSP ผ่าน <meta http-equiv> ใน index.html แทน)
 *
 * อ้างอิง docs/04-ARCHITECTURE.md §D8 — ค่าตรงตามที่ระบุไว้เป๊ะ ๆ ยกเว้น `frame-ancestors`
 * ซึ่ง**ใช้ใน <meta> ไม่ได้** (บราวเซอร์รองรับ frame-ancestors เฉพาะตอนส่งเป็น HTTP response
 * header เท่านั้น ถ้าใส่ใน <meta> จะถูก browser เพิกเฉย/เตือนใน console) จึงตัดออกจาก
 * ค่านี้ — ไม่มีทางแก้อื่นบน GitHub Pages เพราะไม่มี server-side ให้ตั้ง header (N1)
 */
export const CSP_CONTENT =
  "default-src 'self'; connect-src 'self' https://api.anthropic.com; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:";

export const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}" />`;

/**
 * ฝัง CSP meta tag ลงใน dist/index.html เฉพาะตอน build เท่านั้น (ไม่ใช่ dev server)
 * เพราะ Vite dev server ต้องการ inline script/eval และ WebSocket (HMR) ซึ่ง CSP นี้จะบล็อก
 * ถ้าเปิดใช้งานระหว่าง `npm run dev`
 */
export function injectCspMetaHtml(html: string): string {
  // เช็คด้วย tag เต็ม ๆ ที่เราจะแทรกจริง (ไม่ใช่แค่คำว่า "Content-Security-Policy" เฉย ๆ)
  // เพราะ index.html มีคอมเมนต์อธิบายเหตุผลที่พูดถึง CSP อยู่แล้ว ถ้าเช็คแบบหลวมเกินไปจะ
  // short-circuit แล้วไม่ฝัง meta tag จริงเลย
  if (html.includes(CSP_META_TAG)) return html;
  const charsetTag = '<meta charset="UTF-8" />';
  if (!html.includes(charsetTag)) {
    throw new Error('cspMeta: ไม่พบ <meta charset="UTF-8" /> ใน index.html ให้ตรวจ template');
  }
  return html.replace(charsetTag, `${charsetTag}\n    ${CSP_META_TAG}`);
}

export function cspMetaPlugin(): Plugin {
  return {
    name: 'tgbp-csp-meta',
    apply: 'build',
    transformIndexHtml(html: string) {
      return injectCspMetaHtml(html);
    },
  };
}
