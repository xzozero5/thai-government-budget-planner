import { describe, expect, it } from 'vitest';
import { getSvgElementForExport } from './svgExport';

const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
const DANGEROUS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>';
const MALFORMED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect>';

describe('getSvgElementForExport', () => {
  it('คืน SVGSVGElement เมื่อ sanitize ผ่าน', () => {
    const node = getSvgElementForExport(CLEAN_SVG);
    expect(node).not.toBeNull();
    expect(node?.tagName.toLowerCase()).toBe('svg');
    expect(node?.querySelector('rect')).not.toBeNull();
  });

  it('คืน node ที่ไม่มี <script> แม้ svgText ดิบมี script (sanitize ตัดออกก่อน)', () => {
    const node = getSvgElementForExport(DANGEROUS_SVG);
    expect(node).not.toBeNull();
    expect(node?.querySelector('script')).toBeNull();
  });

  it('คืน null เมื่อ sanitize ล้มเหลว (XML พัง)', () => {
    expect(getSvgElementForExport(MALFORMED_SVG)).toBeNull();
  });
});
