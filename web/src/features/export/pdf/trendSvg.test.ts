import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '@/lib/svgSanitizer';
import { buildTrendSvg, TREND_SVG_MIN_SOLID_N, type TrendSvgPoint } from './trendSvg';

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('buildTrendSvg', () => {
  it('ผ่าน sanitizeSvg (ok:true) เสมอ — N9 defense-in-depth แม้สร้างเองไม่ใช่ AI', () => {
    const points: TrendSvgPoint[] = [
      { yearBe: 2565, median: 100, n: 5 },
      { yearBe: 2566, median: 120, p25: 90, p75: 150, n: 8 },
      { yearBe: 2567, median: 90, p25: 80, p75: 130, n: 2 },
    ];
    const svg = buildTrendSvg({ title: 'เครื่องปรับอากาศ 18,000 บีทียู', points });
    const result = sanitizeSvg(svg);
    expect(result.ok).toBe(true);
  });

  it('มี viewBox และ root เป็น <svg>', () => {
    const svg = buildTrendSvg({ title: 'ทดสอบ', points: [{ yearBe: 2567, median: 10, n: 5 }] });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox=');
  });

  it('T-602 (เก็บตก PDF, N3) — มีจุดข้อมูลจริง: title ไม่ถูกวาดซ้ำในรูปอีกต่อไป (ซ้ำกับ SubHeading เหนือรูปใน ProposalDocument.tsx) แต่ escape ป้ายค่าต่ำสุด/สูงสุด (ตัวเลขล้วน) อยู่แล้วโดยไม่ต้องพึ่ง title', () => {
    const svg = buildTrendSvg({
      title: '<script>alert(1)</script> & "ทดสอบ"',
      points: [{ yearBe: 2567, median: 10, n: 5 }],
    });
    expect(svg).not.toContain('<script>');
    // title ไม่ปรากฏในรูปเลยไม่ว่า escape แล้วหรือดิบ — ตัดความซ้ำซ้อนกับหัวข้อที่แสดงนอกรูป
    expect(svg).not.toContain('ทดสอบ');
    expect(svg).not.toContain('&lt;script&gt;');
    expect(sanitizeSvg(svg).ok).toBe(true);
  });

  it('escape อักขระพิเศษในชื่อรายการของ placeholder "ไม่มีข้อมูล" (กัน XML แตก และกัน XSS หากมีคนพยายามยัด "<")', () => {
    const svg = buildTrendSvg({
      title: '<script>alert(1)</script> & "ทดสอบ"',
      points: [],
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(sanitizeSvg(svg).ok).toBe(true);
  });

  it('จุดที่ n < TREND_SVG_MIN_SOLID_N วาดเป็นวงกลมกลวง (fill ขาว + stroke) ส่วน n สูงวาดทึบ', () => {
    expect(TREND_SVG_MIN_SOLID_N).toBe(3);
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [
        { yearBe: 2565, median: 100, n: 2 }, // hollow
        { yearBe: 2566, median: 110, n: 3 }, // solid (เท่ากับเกณฑ์ = ยังทึบ)
        { yearBe: 2567, median: 120 }, // ไม่มี n เลย = ทึบเสมอ (เช่นตัวชี้วัดเศรษฐกิจ)
      ],
    });
    expect(countOccurrences(svg, 'fill="#ffffff" stroke=')).toBe(1);
    expect(countOccurrences(svg, '<circle')).toBe(3);
  });

  it('ปีที่ไม่มีข้อมูลคั่นกลาง (gap) ไม่ลากเส้นมัธยฐานเชื่อมข้าม — ได้ 2 subpath (M) แยกกัน', () => {
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [
        { yearBe: 2565, median: 100, n: 5 },
        { yearBe: 2566, median: 110, n: 5 },
        // ขาดปี 2567
        { yearBe: 2568, median: 130, n: 5 },
        { yearBe: 2569, median: 140, n: 5 },
      ],
    });
    // แต่ละ subpath ของเส้นมัธยฐานขึ้นต้นด้วย M หนึ่งครั้ง (path ของแถบ p25/p75 ไม่มีในเคสนี้เพราะไม่มี p25/p75)
    const pathTags = svg.match(/<path[^>]*>/g) ?? [];
    expect(pathTags).toHaveLength(2);
    for (const tag of pathTags) {
      expect(countOccurrences(tag, 'M')).toBe(1);
    }
  });

  it('จุดเดี่ยว (ไม่มีจุดติดกัน) ไม่มีเส้นมัธยฐานเลย แต่ยังมีวงกลมของจุดนั้น', () => {
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [
        { yearBe: 2565, median: 100, n: 5 },
        // ขาดปี 2566
        { yearBe: 2567, median: 130, n: 5 },
        // ขาดปี 2568
        { yearBe: 2569, median: 140, n: 5 },
      ],
    });
    expect(svg).not.toMatch(/<path/);
    expect(countOccurrences(svg, '<circle')).toBe(3);
  });

  it('แถบ p25–p75 วาดเฉพาะจุดที่มีค่าทั้งคู่ — series แบบ amount_per_line (ไม่มี p25/p75 เลย) ไม่มี polygon', () => {
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [
        { yearBe: 2567, median: 100, n: 5 },
        { yearBe: 2568, median: 120, n: 5 },
      ],
    });
    expect(svg).not.toContain('<polygon');
  });

  it('มีแกนปี พ.ศ. ครบทุกจุด (label ปี)', () => {
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [
        { yearBe: 2565, median: 100, n: 5 },
        { yearBe: 2567, median: 120, n: 5 },
      ],
    });
    expect(svg).toContain('>2565<');
    expect(svg).toContain('>2567<');
  });

  it('มีป้ายค่าต่ำสุด/สูงสุด (ตัวเลขจัดรูปแบบแบบไทย)', () => {
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [
        { yearBe: 2565, median: 1000, n: 5 },
        { yearBe: 2566, median: 25000, n: 5 },
      ],
    });
    expect(svg).toContain('>1,000<');
    expect(svg).toContain('>25,000<');
  });

  it('ทุกจุดค่าเดียวกัน (min=max) — แสดงป้ายเดียว ไม่ซ้ำ', () => {
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [
        { yearBe: 2565, median: 500, n: 5 },
        { yearBe: 2566, median: 500, n: 5 },
      ],
    });
    expect(countOccurrences(svg, '>500<')).toBe(1);
  });

  it('ฟอนต์ระบบเท่านั้น (system-ui) และไม่มี <style>/inline CSS', () => {
    const svg = buildTrendSvg({
      title: 'ทดสอบ',
      points: [{ yearBe: 2567, median: 10, n: 5 }],
    });
    expect(svg).toContain('font-family="system-ui, sans-serif"');
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('style="');
  });

  it('ไม่มีจุดข้อมูลเลย — คืน SVG placeholder ที่ยัง sanitize ผ่าน (ไม่ throw)', () => {
    const svg = buildTrendSvg({ title: 'ไม่มีข้อมูล', points: [] });
    expect(sanitizeSvg(svg).ok).toBe(true);
    expect(svg).toContain('ไม่มีข้อมูล');
  });
});
