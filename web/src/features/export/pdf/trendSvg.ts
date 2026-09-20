/**
 * T-504 (US-8.3) — `buildTrendSvg`: สร้างสตริง SVG ของกราฟ "แนวโน้มราคาที่เกี่ยวข้อง" ที่ฝังใน PDF
 * (เส้นมัธยฐาน + แถบ p25–p75 + แกนปี พ.ศ. + ป้ายค่าต่ำสุด/สูงสุด) — pure function ล้วน ๆ ไม่ import
 * React/DOM (module boundary เดียวกับ `citationRegistry.ts`/`thaiText.ts` ในโฟลเดอร์นี้)
 *
 * ต่างจาก `components/viz/TrendChart.tsx` (ใช้ Recharts วาดบนหน้าเว็บ) — ที่นี่ต้องได้ "สตริง SVG" ล้วน ๆ
 * เพื่อส่งต่อให้ `sanitizeSvg` (N9 defense-in-depth แม้จะเป็น SVG ที่ระบบสร้างเองไม่ใช่ AI) แล้วแปลงเป็น
 * PNG ด้วย `svgToPng.ts` ก่อนฝัง `<Image>` ของ react-pdf (react-pdf ไม่รองรับ SVG ตรง ๆ อย่างสมบูรณ์ — S5)
 * ดู `ExportDialog.tsx#buildTrendImages` สำหรับจุดที่เรียกทั้งสามขั้นตอนต่อกัน
 *
 * กติกาตาม BACKLOG T-504:
 * - เส้นมัธยฐาน (median) ต่อเฉพาะระหว่างปีที่ "ติดกัน" จริง (yearBe ต่างกัน 1) — ปีที่ขาดข้อมูลคั่นกลาง
 *   ต้องไม่มีเส้นลากข้าม (ตัดเป็นหลาย subpath)
 * - แถบ p25–p75 วาดเฉพาะจุดที่มีค่าทั้งสอง (`amount_per_line` ไม่มี p25/p75 ตาม docs/03 §3.4 — จุดพวกนี้
 *   จะไม่มีแถบเลย ซึ่งถูกต้องแล้ว)
 * - จุดที่ `n < TREND_SVG_MIN_SOLID_N` วาดเป็นวงกลมกลวง (สื่อว่าตัวอย่างน้อย ไม่ควรอ่านตัวเลขนี้ตรง ๆ);
 *   จุดที่ไม่มีแนวคิด `n` เลย (เช่นตัวชี้วัดเศรษฐกิจ) ถือว่าเชื่อถือได้เสมอ → วงกลมทึบ
 * - สีคงที่ (ไม่รับ palette จากภายนอก) และฟอนต์ระบบ (`font-family: system-ui, sans-serif`) เท่านั้น —
 *   ไม่มี `<style>`/inline CSS (จะโดน `sanitizeSvg` ตัดทิ้งอยู่ดี)
 */
import { formatNumber } from '@/lib/format';
import { pdfCopy } from './copy';

export interface TrendSvgPoint {
  yearBe: number;
  median: number;
  p25?: number;
  p75?: number;
  /** จำนวนตัวอย่างของจุดนี้ — `undefined` เมื่อไม่มีแนวคิด n (เช่นตัวชี้วัดเศรษฐกิจ) = วาดเป็นจุดทึบเสมอ */
  n?: number;
}

export interface BuildTrendSvgInput {
  title: string;
  points: TrendSvgPoint[];
}

/** จำนวนตัวอย่างขั้นต่ำที่ถือว่าพอเชื่อถือได้ — น้อยกว่านี้วาดเป็นวงกลมกลวง (สอดคล้องกับเกณฑ์เดียวกันที่ใช้
 * ตัดสิน `confidence` ของ BOQ ใน `ai/tools/proposal.ts`) */
export const TREND_SVG_MIN_SOLID_N = 3;

const WIDTH = 640;
const HEIGHT = 360;
// T-602 (เก็บตก PDF, N3) — เดิม `top: 44` เผื่อพื้นที่ให้ title ที่วาดในรูปเอง ตอนนี้ชื่อกราฟแสดงเป็น
// `SubHeading` จริง (PDF text ที่ค้นหา/คัดลอกได้) เหนือรูปใน `ProposalDocument.tsx` แล้วเพียงจุดเดียว —
// ตัด title ออกจากในรูป (กัน "ชื่อกราฟซ้ำ 2 ที่") จึงลดระยะขอบบนลง เหลือพอสำหรับป้ายค่าสูงสุดที่ลอยเหนือจุด
const MARGIN = { top: 24, right: 28, bottom: 44, left: 60 } as const;
const PLOT_LEFT = MARGIN.left;
const PLOT_RIGHT = WIDTH - MARGIN.right;
const PLOT_TOP = MARGIN.top;
const PLOT_BOTTOM = HEIGHT - MARGIN.bottom;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;

const COLOR_TEXT = '#1a1a1a';
const COLOR_MUTED = '#5b5b5b';
const COLOR_AXIS = '#8a8fa3';
const COLOR_LINE = '#1a56b8';
const COLOR_BAND = '#1a56b8';
const BAND_FILL_OPACITY = '0.14';
const FONT_FAMILY = 'system-ui, sans-serif';

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

/** พิกัด SVG ปัดเป็น 2 ตำแหน่งทศนิยม — อ่านง่ายและไฟล์เล็กลง (ไม่กระทบภาพที่มองเห็น) */
function px(n: number): string {
  return n.toFixed(2);
}

/** แบ่งรายการที่เรียงตาม `yearBe` แล้วเป็นช่วงต่อเนื่อง (ต่างกันทีละ 1 ปี) — ใช้ทั้งเส้นมัธยฐานและแถบ p25–p75
 * (ปีที่ขาดข้อมูลคั่นกลาง = คนละช่วง ไม่ลากเส้น/แถบเชื่อมข้าม ตามสเปค T-504) */
function toConsecutiveRuns<T extends { yearBe: number }>(items: readonly T[]): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  let prevYear: number | null = null;
  for (const item of items) {
    if (prevYear !== null && item.yearBe - prevYear > 1) {
      runs.push(current);
      current = [];
    }
    current.push(item);
    prevYear = item.yearBe;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** หาไอเทมที่ "ชนะ" ตาม `pick` โดยไม่ต้อง index เข้า array เลย (เลี่ยง non-null assertion ตามธรรมเนียม
 * เดียวกับ `firstAndLast` ใน `data/trends.ts`) */
function reduceExtreme<T>(items: readonly T[], pick: (a: T, b: T) => T): T | null {
  let result: T | null = null;
  for (const item of items) {
    result = result === null ? item : pick(result, item);
  }
  return result;
}

function emptyStateSvg(title: string): string {
  const cx = px(WIDTH / 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}" width="100%" height="100%">`,
    `<text x="${cx}" y="${px(HEIGHT / 2 - 10)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="16" font-weight="bold" fill="${COLOR_TEXT}">${escapeXml(title)}</text>`,
    `<text x="${cx}" y="${px(HEIGHT / 2 + 14)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="13" fill="${COLOR_MUTED}">${escapeXml(pdfCopy.noData)}</text>`,
    '</svg>',
  ].join('');
}

interface Scales {
  x: (yearBe: number) => number;
  y: (value: number) => number;
}

/** ค่าต่ำสุด/สูงสุดของแกนราคา — รวมทั้ง median และ p25/p75 (ถ้ามี) แล้วเผื่อขอบ 12% ทั้งบน-ล่าง */
function valueDomain(points: readonly TrendSvgPoint[]): { min: number; max: number } {
  const values: number[] = [];
  for (const p of points) {
    values.push(p.median);
    if (p.p25 !== undefined) values.push(p.p25);
    if (p.p75 !== undefined) values.push(p.p75);
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}

function buildScales(sorted: readonly TrendSvgPoint[]): Scales {
  const years = sorted.map((p) => p.yearBe);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearSpan = maxYear - minYear;
  const { min: minV, max: maxV } = valueDomain(sorted);
  const valueSpan = maxV - minV || 1;

  function x(yearBe: number): number {
    if (yearSpan === 0) return PLOT_LEFT + PLOT_WIDTH / 2;
    return PLOT_LEFT + ((yearBe - minYear) / yearSpan) * PLOT_WIDTH;
  }
  function y(value: number): number {
    return PLOT_TOP + PLOT_HEIGHT - ((value - minV) / valueSpan) * PLOT_HEIGHT;
  }
  return { x, y };
}

function buildAxis(sorted: readonly TrendSvgPoint[], scales: Scales): string[] {
  const axisY = px(PLOT_BOTTOM);
  const parts = [
    `<line x1="${px(PLOT_LEFT)}" y1="${axisY}" x2="${px(PLOT_RIGHT)}" y2="${axisY}" stroke="${COLOR_AXIS}" stroke-width="1" />`,
  ];
  for (const p of sorted) {
    const tickX = px(scales.x(p.yearBe));
    parts.push(
      `<line x1="${tickX}" y1="${axisY}" x2="${tickX}" y2="${px(PLOT_BOTTOM + 5)}" stroke="${COLOR_AXIS}" stroke-width="1" />`,
      `<text x="${tickX}" y="${px(PLOT_BOTTOM + 19)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="10.5" fill="${COLOR_MUTED}">${String(p.yearBe)}</text>`,
    );
  }
  return parts;
}

function buildBandShapes(sorted: readonly TrendSvgPoint[], scales: Scales): string[] {
  const withBand = sorted.filter(
    (p): p is TrendSvgPoint & { p25: number; p75: number } =>
      p.p25 !== undefined && p.p75 !== undefined,
  );
  const runs = toConsecutiveRuns(withBand);
  const shapes: string[] = [];
  for (const run of runs) {
    if (run.length >= 2) {
      const top = run.map((p) => `${px(scales.x(p.yearBe))},${px(scales.y(p.p75))}`);
      const bottom = [...run].reverse().map((p) => `${px(scales.x(p.yearBe))},${px(scales.y(p.p25))}`);
      shapes.push(
        `<polygon points="${[...top, ...bottom].join(' ')}" fill="${COLOR_BAND}" fill-opacity="${BAND_FILL_OPACITY}" stroke="none" />`,
      );
      continue;
    }
    const only = run[0];
    if (only !== undefined) {
      const lineX = px(scales.x(only.yearBe));
      shapes.push(
        `<line x1="${lineX}" y1="${px(scales.y(only.p75))}" x2="${lineX}" y2="${px(scales.y(only.p25))}" stroke="${COLOR_BAND}" stroke-width="4" stroke-opacity="0.35" stroke-linecap="round" />`,
      );
    }
  }
  return shapes;
}

function buildMedianLines(sorted: readonly TrendSvgPoint[], scales: Scales): string[] {
  const runs = toConsecutiveRuns(sorted).filter((run) => run.length >= 2);
  return runs.map((run) => {
    const cmds = run
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(scales.x(p.yearBe))},${px(scales.y(p.median))}`)
      .join(' ');
    return `<path d="${cmds}" fill="none" stroke="${COLOR_LINE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
  });
}

function buildMarkers(sorted: readonly TrendSvgPoint[], scales: Scales): string[] {
  return sorted.map((p) => {
    const cx = px(scales.x(p.yearBe));
    const cy = px(scales.y(p.median));
    const hollow = p.n !== undefined && p.n < TREND_SVG_MIN_SOLID_N;
    if (hollow) {
      return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#ffffff" stroke="${COLOR_LINE}" stroke-width="2" />`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="4" fill="${COLOR_LINE}" />`;
  });
}

function buildExtremeLabels(sorted: readonly TrendSvgPoint[], scales: Scales): string[] {
  const maxPoint = reduceExtreme(sorted, (a, b) => (b.median > a.median ? b : a));
  const minPoint = reduceExtreme(sorted, (a, b) => (b.median < a.median ? b : a));
  const labels: string[] = [];

  function label(point: TrendSvgPoint, dy: number): string {
    const x = px(scales.x(point.yearBe));
    const y = px(scales.y(point.median) + dy);
    return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="11" font-weight="bold" fill="${COLOR_TEXT}">${escapeXml(formatNumber(point.median))}</text>`;
  }

  if (maxPoint !== null) {
    labels.push(label(maxPoint, -12));
  }
  if (minPoint !== null && minPoint !== maxPoint) {
    labels.push(label(minPoint, 20));
  }
  return labels;
}

/**
 * สร้าง SVG string ของกราฟแนวโน้มราคา — ผลลัพธ์ต้องผ่าน `sanitizeSvg` (`@/lib/svgSanitizer`) เสมอก่อนแปลง
 * เป็น PNG จริง (ดูหัวไฟล์) แม้จะสร้างจากในระบบเอง ไม่ใช่จาก AI ก็ตาม (N9 defense-in-depth)
 *
 * T-602 (เก็บตก PDF, N3) — `title` **ไม่ถูกวาดซ้ำในรูป** อีกต่อไปเมื่อมีจุดข้อมูล (เดิมซ้ำกับ `SubHeading`
 * ที่ `ProposalDocument.tsx` วาดไว้เหนือรูปแล้ว — เก็บชื่อไว้จุดเดียวที่เป็น PDF text จริง ค้นหา/คัดลอกได้
 * ต่างจากตัวหนังสือที่ raster เป็นพิกเซลในรูป) กรณี "ไม่มีข้อมูล" (`emptyStateSvg`) ยังคงแสดง title ในรูป
 * เหมือนเดิม เพราะเป็น placeholder ที่ไม่ถูกใช้ในเส้นทางจริงของแอป (จุดที่ไม่มีข้อมูลถูกกรองออกไปก่อนแล้ว
 * ใน `ExportDialog.tsx#buildTrendImages`) — เก็บไว้เพื่อ debug/ทดสอบเท่านั้น
 */
export function buildTrendSvg({ title, points }: BuildTrendSvgInput): string {
  const sorted = [...points].sort((a, b) => a.yearBe - b.yearBe);
  if (sorted.length === 0) {
    return emptyStateSvg(title);
  }

  const scales = buildScales(sorted);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}" width="100%" height="100%">`,
    ...buildAxis(sorted, scales),
    ...buildBandShapes(sorted, scales),
    ...buildMedianLines(sorted, scales),
    ...buildMarkers(sorted, scales),
    ...buildExtremeLabels(sorted, scales),
    '</svg>',
  ];
  return parts.join('');
}
