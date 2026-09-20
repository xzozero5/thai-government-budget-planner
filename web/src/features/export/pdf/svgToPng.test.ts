import { describe, expect, it } from 'vitest';
import {
  clampCanvasSize,
  MAX_CANVAS_DIMENSION_PX,
  resolveSvgDimensions,
  svgToPngDataUrl,
} from './svgToPng';

const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" width="100%" height="100%">' +
  '<rect width="400" height="240" fill="#fff"/></svg>';

describe('resolveSvgDimensions', () => {
  it('อ่านขนาดจาก viewBox ก่อนเสมอ (แม่นยำกว่า width/height ที่อาจเป็น % สำหรับ responsive)', () => {
    expect(resolveSvgDimensions(SAMPLE_SVG, { width: 1, height: 1 })).toEqual({
      width: 400,
      height: 240,
    });
  });

  it('fallback ไป width/height attribute เมื่อไม่มี viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"></svg>';
    expect(resolveSvgDimensions(svg, { width: 1, height: 1 })).toEqual({ width: 300, height: 150 });
  });

  it('fallback ไปค่าเริ่มต้นที่ระบุเมื่อไม่มีทั้ง viewBox และ width/height', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(resolveSvgDimensions(svg, { width: 800, height: 450 })).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('T-602 (NEW-L7): viewBox ที่ width/height เป็น 0 (ไม่ใช่ตัวเลขบวก) → fallback ปลอดภัย', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"></svg>';
    expect(resolveSvgDimensions(svg, { width: 800, height: 450 })).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('T-602 (NEW-L7): viewBox ที่ตัวเลขยาวผิดปกติจน overflow เป็น Infinity → fallback ปลอดภัย (ไม่ใช่ตัวเลขบวก "จำกัด")', () => {
    const hugeDigits = '9'.repeat(400); // Number(...) ของสตริงนี้ overflow เป็น Infinity
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${hugeDigits} ${hugeDigits}"></svg>`;
    expect(resolveSvgDimensions(svg, { width: 800, height: 450 })).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('T-602 (NEW-L7): width/height attribute ที่ overflow เป็น Infinity → fallback ปลอดภัยเช่นกัน', () => {
    const hugeDigits = '9'.repeat(400);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${hugeDigits}" height="${hugeDigits}"></svg>`;
    expect(resolveSvgDimensions(svg, { width: 800, height: 450 })).toEqual({
      width: 800,
      height: 450,
    });
  });
});

describe('clampCanvasSize (T-602 NEW-L7) — จำกัดขนาด canvas ≤ 4000px ต่อด้าน คงอัตราส่วนไว้', () => {
  it('ขนาดที่ไม่เกินเพดานอยู่แล้ว → คืนเท่าเดิม (ปัดเป็นจำนวนเต็ม)', () => {
    expect(clampCanvasSize(800, 450)).toEqual({ width: 800, height: 450 });
  });

  it('กว้างเกินเพดาน → ลดทั้งสองด้านตามอัตราส่วนเดิม', () => {
    const result = clampCanvasSize(8000, 4500);
    expect(result.width).toBe(MAX_CANVAS_DIMENSION_PX);
    expect(result.height).toBe(Math.round(4500 * (MAX_CANVAS_DIMENSION_PX / 8000)));
    // อัตราส่วนต้องใกล้เคียงเดิม (ยอมรับ error จากการปัดเศษเล็กน้อย)
    expect(Math.abs(result.width / result.height - 8000 / 4500)).toBeLessThan(0.01);
  });

  it('สูงเกินเพดาน (แนวตั้ง) → ลดทั้งสองด้านตามอัตราส่วนเดิม', () => {
    const result = clampCanvasSize(1000, 9000);
    expect(result.height).toBe(MAX_CANVAS_DIMENSION_PX);
    expect(result.width).toBeLessThan(1000);
  });

  it('ค่า Infinity/NaN (viewBox ผิดปกติหลุดมาถึงชั้นนี้) → คืน 1×1 อย่างปลอดภัย ไม่ throw', () => {
    expect(() => clampCanvasSize(Infinity, Infinity)).not.toThrow();
    expect(clampCanvasSize(Infinity, Infinity)).toEqual({ width: 1, height: 1 });
    expect(clampCanvasSize(NaN, 100)).toEqual({ width: 1, height: 1 });
    expect(clampCanvasSize(100, 0)).toEqual({ width: 1, height: 1 });
    expect(clampCanvasSize(-100, 100)).toEqual({ width: 1, height: 1 });
  });
});

describe('svgToPngDataUrl — guard เมื่อไม่มี canvas 2D จริง (jsdom ไม่มี native `canvas` package)', () => {
  it('คืน null แทนการ hang/throw เมื่อ runtime นี้ (jsdom) ไม่รองรับ canvas 2D จริง', async () => {
    const result = await svgToPngDataUrl(SAMPLE_SVG);
    expect(result).toBeNull();
  });

  it('รับ SVGSVGElement (ผลจาก sanitizeSvg().node()) ได้เหมือนกับสตริง — ยังคืน null ใน jsdom', async () => {
    const doc = new DOMParser().parseFromString(SAMPLE_SVG, 'image/svg+xml');
    const node = doc.documentElement as unknown as SVGSVGElement;
    const result = await svgToPngDataUrl(node);
    expect(result).toBeNull();
  });
});
