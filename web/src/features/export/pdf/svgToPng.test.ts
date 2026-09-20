import { describe, expect, it } from 'vitest';
import { resolveSvgDimensions, svgToPngDataUrl } from './svgToPng';

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
