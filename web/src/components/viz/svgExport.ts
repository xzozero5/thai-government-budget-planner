/**
 * T-412 — `getSvgElementForExport`: ให้ PDF exporter (`features/export/**`) ดึง `SVGSVGElement` ที่ผ่าน
 * `sanitizeSvg` แล้ว โดยไม่ต้อง import `IllustrationFrame` (React component) เข้าไปในโค้ด export ที่
 * ไม่ใช่ React tree — คืน `null` เมื่อ sanitize ไม่ผ่าน (N9: ห้าม render อะไรจาก SVG ที่ไม่ปลอดภัยเลย)
 */
import { sanitizeSvg } from '@/lib/svgSanitizer';

export function getSvgElementForExport(svgText: string): SVGSVGElement | null {
  const result = sanitizeSvg(svgText);
  return result.ok ? result.node() : null;
}
