/**
 * T-504 — แปลง SVG (ที่ผ่าน `sanitizeSvg` แล้วเท่านั้น — ดู `@/lib/svgSanitizer`) เป็น PNG data URL
 * ด้วย `<canvas>` เพื่อฝังใน PDF (react-pdf `<Image>` รองรับ SVG แค่บางส่วนเท่านั้น — S5)
 *
 * ใช้ `data:` URL เสมอ (**ไม่ใช้ `blob:`**) — docs/decisions/SPIKES.md §S5 ยืนยันว่า `blob:` ถูก CSP
 * `img-src 'self' data:` (docs/04-ARCHITECTURE.md §D8) บล็อกใน production แต่ `data:` ผ่านและ canvas
 * ไม่ tainted
 *
 * browser-only: guard เมื่อไม่มี `document`/canvas 2D context จริง (เช่น jsdom ที่ไม่ได้ติดตั้ง native
 * `canvas` package — เราไม่เพิ่ม dependency นี้) โดยตรวจ **ก่อน** พยายามโหลดรูปเสมอ เพื่อไม่ให้ Promise
 * ค้าง (jsdom ไม่ fetch/decode `data:` image เลย `img.onload`/`onerror` จะไม่ยิงเลยถ้าปล่อยให้ไปถึงจุดนั้น)
 *
 * ห้ามใช้ `innerHTML`/`outerHTML` (ESLint บล็อกทั้งสอง, T-307) — ใช้ `XMLSerializer` เท่านั้นตอนแปลง
 * `SVGSVGElement` เป็นสตริง
 */

export interface SvgToPngOptions {
  /** อัตราส่วนขยายความละเอียด (retina) — ค่าเริ่มต้น 2 ตาม T-504 */
  scale?: number;
  /** ขนาดสำรอง (px) เมื่อ SVG ไม่มีทั้ง viewBox และ width/height */
  fallbackWidth?: number;
  fallbackHeight?: number;
}

const DEFAULT_SCALE = 2;
const DEFAULT_FALLBACK_WIDTH = 800;
const DEFAULT_FALLBACK_HEIGHT = 450;

/** T-602 (NEW-L7) — เพดานขนาด canvas ต่อด้าน (px) หลังคูณ `scale` แล้ว: `viewBox` ของ SVG (มาจากตัวระบบ
 * สร้างเอง `trendSvg.ts` ก็จริง แต่ผ่าน sanitizer/serializer มาก่อน — กันไว้เป็น defense-in-depth เผื่อ
 * ค่าที่ผิดปกติ/ใหญ่ผิดธรรมชาติหลุดมาถึงจุดนี้) ไม่ควรทำให้เบราว์เซอร์พยายามจอง canvas ขนาดมหาศาลจนค้าง/
 * ล่ม (DoS ฝั่ง client) */
export const MAX_CANVAS_DIMENSION_PX = 4000;

/** จำกัดขนาด canvas เป้าหมายไม่ให้เกิน `maxPx` ต่อด้าน โดยคงอัตราส่วนกว้าง/ยาวเดิมไว้เสมอ — ค่าที่ไม่ใช่
 * ตัวเลขจำกัด (`NaN`/`Infinity`) ถือว่าใช้ไม่ได้ ปัดกลับเป็นขนาดขั้นต่ำ 1×1 อย่างปลอดภัย (ไม่ throw) */
export function clampCanvasSize(
  widthPx: number,
  heightPx: number,
  maxPx: number = MAX_CANVAS_DIMENSION_PX,
): { width: number; height: number } {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return { width: 1, height: 1 };
  }
  const width = Math.max(1, Math.round(widthPx));
  const height = Math.max(1, Math.round(heightPx));
  const largest = Math.max(width, height);
  if (largest <= maxPx) {
    return { width, height };
  }
  const ratio = maxPx / largest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** true เฉพาะตัวเลขบวกที่ finite (ปฏิเสธ `NaN`/`Infinity`/0/ติดลบ) — ค่าจาก `viewBox`/`width`/`height`
 * ของ SVG ที่ผิดปกติ (เช่นสตริงตัวเลขยาวผิดธรรมชาติจน overflow เป็น `Infinity`) ต้องไม่ถูกใช้ตรง ๆ */
function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** อ่านขนาดจริงของ SVG จาก `viewBox` ก่อน (แม่นยำสุด) แล้วค่อย fallback ไป `width`/`height` attribute —
 * ค่าที่ parse ได้แต่ไม่ใช่ตัวเลขบวกจำกัด (0/ติดลบ/`Infinity` จากสตริงยาวผิดปกติ) ถือว่าใช้ไม่ได้ ปัดกลับไป
 * ใช้ `fallback` เสมอแทนการปล่อยค่าที่ผิดปกติออกไป (T-602 NEW-L7) */
export function resolveSvgDimensions(
  svgString: string,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const viewBoxMatch =
    /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svgString);
  if (viewBoxMatch?.[1] !== undefined && viewBoxMatch[2] !== undefined) {
    const width = Number(viewBoxMatch[1]);
    const height = Number(viewBoxMatch[2]);
    if (isFinitePositive(width) && isFinitePositive(height)) return { width, height };
  }
  const widthMatch = /\bwidth\s*=\s*["']?([\d.]+)/i.exec(svgString);
  const heightMatch = /\bheight\s*=\s*["']?([\d.]+)/i.exec(svgString);
  const width = widthMatch?.[1] !== undefined ? Number(widthMatch[1]) : fallback.width;
  const height = heightMatch?.[1] !== undefined ? Number(heightMatch[1]) : fallback.height;
  return {
    width: isFinitePositive(width) ? width : fallback.width,
    height: isFinitePositive(height) ? height : fallback.height,
  };
}

/** ตรวจว่า runtime นี้รองรับ canvas 2D จริง (ไม่ใช่แค่ jsdom stub) — ใช้เป็น guard ก่อนทำอย่างอื่น */
function hasRealCanvasSupport(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('2d') !== null;
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * แปลง SVG (string หรือ `SVGSVGElement` ที่ sanitize แล้ว) เป็น PNG data URL ที่ scale เท่าที่กำหนด —
 * คืน `null` เมื่อ runtime ไม่รองรับ (jsdom/Node), โหลดรูปไม่สำเร็จ, หรือ canvas ถูก taint
 */
export async function svgToPngDataUrl(
  svg: string | SVGSVGElement,
  options: SvgToPngOptions = {},
): Promise<string | null> {
  if (!hasRealCanvasSupport()) return null;

  const svgString = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
  const scale = options.scale ?? DEFAULT_SCALE;
  const { width, height } = resolveSvgDimensions(svgString, {
    width: options.fallbackWidth ?? DEFAULT_FALLBACK_WIDTH,
    height: options.fallbackHeight ?? DEFAULT_FALLBACK_HEIGHT,
  });

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  const img = await loadImage(dataUrl);
  if (img === null) return null;

  const canvas = document.createElement('canvas');
  const clamped = clampCanvasSize(width * scale, height * scale);
  canvas.width = clamped.width;
  canvas.height = clamped.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    // canvas ถูก tainted (ไม่ควรเกิดกับ data: URL แต่กันไว้เผื่อ browser/policy แปลก ๆ)
    return null;
  }
}
