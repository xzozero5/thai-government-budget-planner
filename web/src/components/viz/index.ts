/**
 * T-412 — barrel export ของ `components/viz/*` (CLAUDE.md §7: named exports)
 *
 * สำคัญ: ห้าม export `TrendChart` (ตัวจริงที่ import `recharts`) จากไฟล์นี้แบบ static — เข้าถึงได้
 * ผ่าน `TrendChartLazy` เท่านั้น (dynamic `import()` ภายใน `TrendChartLazy.tsx`) เพื่อกัน `recharts`
 * หลุดเข้า initial bundle (06 §3, ดูคอมเมนต์หัวไฟล์ `TrendChart.tsx`/`TrendChartLazy.tsx`)
 */

export { Sparkline } from '@/components/viz/Sparkline';
export type { SparklinePoint, SparklineProps } from '@/components/viz/Sparkline';

export { TrendChartLazy } from '@/components/viz/TrendChartLazy';
export type {
  TrendChartBasis,
  TrendChartLabels,
  TrendChartPoint,
  TrendChartProps,
} from '@/components/viz/TrendChartLazy';

export { StatCard } from '@/components/viz/StatCard';
export type {
  StatCardBasis,
  StatCardBasisKind,
  StatCardProps,
  StatCardSparkline,
} from '@/components/viz/StatCard';

export { IllustrationFrame } from '@/components/viz/IllustrationFrame';
export type { IllustrationFrameProps } from '@/components/viz/IllustrationFrame';

export { getSvgElementForExport } from '@/components/viz/svgExport';
