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

/** อ่านขนาดจริงของ SVG จาก `viewBox` ก่อน (แม่นยำสุด) แล้วค่อย fallback ไป `width`/`height` attribute */
export function resolveSvgDimensions(
  svgString: string,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const viewBoxMatch =
    /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svgString);
  if (viewBoxMatch?.[1] !== undefined && viewBoxMatch[2] !== undefined) {
    const width = Number(viewBoxMatch[1]);
    const height = Number(viewBoxMatch[2]);
    if (width > 0 && height > 0) return { width, height };
  }
  const widthMatch = /\bwidth\s*=\s*["']?([\d.]+)/i.exec(svgString);
  const heightMatch = /\bheight\s*=\s*["']?([\d.]+)/i.exec(svgString);
  const width = widthMatch?.[1] !== undefined ? Number(widthMatch[1]) : fallback.width;
  const height = heightMatch?.[1] !== undefined ? Number(heightMatch[1]) : fallback.height;
  return {
    width: width > 0 ? width : fallback.width,
    height: height > 0 ? height : fallback.height,
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
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
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
