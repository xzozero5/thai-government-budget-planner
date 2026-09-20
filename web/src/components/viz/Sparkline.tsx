/**
 * T-412 — Sparkline: กราฟเส้นเล็กในตาราง BOQ/StatCard วาดเอง (ไม่ใช้ Recharts เพื่อความเบา)
 * ข้อมูลปีที่ไม่มีค่า (`y: null`) ต้องเว้นช่องว่าง ไม่ลากเส้นเชื่อม (เหมือน TrendChart)
 * ตัวเลขต้องมีคอลัมน์ข้าง ๆ เสมอ — sparkline นี้จึงมี `role="img"` เท่านั้น ไม่ใช่แหล่งข้อมูลเดียว
 */
import { useId } from 'react';
import type { ReactElement } from 'react';
import { cx, usePrefersReducedMotion } from './utils';

export interface SparklinePoint {
  x: number;
  y: number | null;
}

export interface SparklineProps {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  /** aria-label บังคับ (06 §7 ข้อ 21: "role=img + aria-label") */
  ariaLabel: string;
  /** สีเส้น — ค่า CSS (แนะนำ `var(--basis-historical)` ฯลฯ) ค่าเริ่มต้น `var(--primary)` */
  stroke?: string;
  className?: string;
}

const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 24;
const PADDING = 2;

interface Segment {
  points: { x: number; y: number }[];
}

/** แบ่ง points เป็นช่วงต่อเนื่องที่ไม่มี null คั่น (ใช้สร้างหลาย `<path>` แทนการลากผ่านช่องว่าง) */
function toSegments(points: SparklinePoint[]): Segment[] {
  const segments: Segment[] = [];
  let current: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (current.length > 0) {
        segments.push({ points: current });
        current = [];
      }
      continue;
    }
    current.push({ x: p.x, y: p.y });
  }
  if (current.length > 0) {
    segments.push({ points: current });
  }
  return segments;
}

/** map ค่าจริง → พิกัด SVG (y กลับด้าน: ค่ามากอยู่ด้านบน) */
function project(
  points: SparklinePoint[],
  width: number,
  height: number,
): { segments: { x: number; y: number }[][]; lastPoint: { x: number; y: number } | null } {
  const xs = points.map((p) => p.x);
  const ys = points.filter((p): p is { x: number; y: number } => p.y !== null).map((p) => p.y);

  if (xs.length === 0 || ys.length === 0) {
    return { segments: [], lastPoint: null };
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const innerWidth = width - PADDING * 2;
  const innerHeight = height - PADDING * 2;

  function projectPoint(p: { x: number; y: number }): { x: number; y: number } {
    const px = PADDING + ((p.x - minX) / spanX) * innerWidth;
    const py = PADDING + innerHeight - ((p.y - minY) / spanY) * innerHeight;
    return { x: px, y: py };
  }

  const rawSegments = toSegments(points);
  const segments = rawSegments.map((seg) => seg.points.map(projectPoint));

  const lastRaw = [...points].reverse().find((p): p is { x: number; y: number } => p.y !== null);
  const lastPoint = lastRaw ? projectPoint(lastRaw) : null;

  return { segments, lastPoint };
}

function segmentToPath(points: { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${String(p.x)} ${String(p.y)}`)
    .join(' ');
}

/** `useId()` คืนรูปแบบ `:r0:` ที่ใช้เป็นชื่อ CSS identifier ตรง ๆ ไม่ได้ — jsdom ไม่มี `CSS.escape` ด้วย
 * (ต่างจากเบราว์เซอร์จริง) จึงแทนที่อักขระที่ไม่ปลอดภัยเองแทนพึ่ง `CSS.escape` */
function toCssIdent(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * SVG เขียนเอง: เส้น draw-in ด้วย `stroke-dashoffset` (ใช้ `pathLength=1` เพื่อไม่ต้องเรียก
 * `getTotalLength()` — jsdom ไม่ implement เมธอดนี้ และค่าที่คำนวณเองก็ไม่ตรง geometry จริงอยู่ดี)
 * ปิด animation เมื่อ `prefers-reduced-motion: reduce` (แสดงเส้นเต็มทันที)
 */
export function Sparkline({
  points,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  ariaLabel,
  stroke = 'var(--primary)',
  className,
}: SparklineProps): ReactElement {
  const reducedMotion = usePrefersReducedMotion();
  const animationId = toCssIdent(useId());
  const { segments, lastPoint } = project(points, width, height);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className={cx('overflow-visible', className)}
    >
      {!reducedMotion && (
        <style>{`
          @keyframes sparkline-draw-${animationId} {
            from { stroke-dashoffset: 1; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      )}
      {segments
        .filter((segPoints) => segPoints.length >= 2)
        .map((segPoints, i) => (
        <path
          key={i}
          d={segmentToPath(segPoints)}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          style={
            reducedMotion
              ? undefined
              : {
                  strokeDasharray: 1,
                  animation: `sparkline-draw-${animationId} 600ms var(--ease-out) forwards`,
                }
          }
        />
      ))}
      {lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r={2.5} fill={stroke} />}
    </svg>
  );
}
