/**
 * T-412 — `TrendChartLazy`: จุดเดียวที่ import `./TrendChart` (แบบ dynamic `import()`) เพื่อให้
 * `recharts` ถูกแยกเป็น chunk ของตัวเอง ไม่ปนใน initial bundle (06 §3 initial load < 3 MB gz)
 * ห้าม import `TrendChart` แบบ static ที่ไหนอีก (รวมถึงใน `index.ts` ของโฟลเดอร์นี้)
 */
import { lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import { Skeleton } from '@/components/ui';
import type { TrendChartProps } from './TrendChart';

const LazyTrendChart = lazy(() =>
  import('./TrendChart').then((mod) => ({ default: mod.TrendChart })),
);

export type { TrendChartProps, TrendChartBasis, TrendChartPoint, TrendChartLabels } from './TrendChart';

/** wrapper ที่โหลด `recharts` แบบ lazy — ใช้ตัวนี้ในหน้าจอจริงเสมอ (ไม่ใช่ `TrendChart` ตรง ๆ) */
export function TrendChartLazy(props: TrendChartProps): ReactElement {
  return (
    <Suspense fallback={<Skeleton height={props.height ?? 240} rounded="md" className="w-full" />}>
      <LazyTrendChart {...props} />
    </Suspense>
  );
}
