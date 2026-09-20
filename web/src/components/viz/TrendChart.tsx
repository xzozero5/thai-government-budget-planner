/**
 * T-412 — TrendChart: เส้น median + แถบ p25–p75 ของ `PriceTrend.points` (Recharts)
 * ไฟล์นี้ import `recharts` ที่ module scope โดยตั้งใจ — ห้าม import ไฟล์นี้แบบ static จากที่อื่น
 * นอกจาก `TrendChartLazy.tsx` (ผ่าน `import()`) มิฉะนั้น `recharts` จะหลุดเข้า initial bundle (06 §3)
 *
 * ป้าย basis/ข้อความ "ข้อมูลน้อย"/หัวตาราง sr-only ยังไม่มี key ใน `docs/ui/copy.th.json` (T-401
 * ยังไม่ได้ออกแบบ copy ของ component นี้) — รับ override ผ่าน prop `labels` ได้เสมอ (ไม่ hard-code
 * ข้อความไทยกระจายไปมากกว่าจุดเดียวที่นี่ ตามที่ตกลงกับ main thread เมื่อ key ยังไม่มี)
 */
import { useId, useMemo } from 'react';
import type { ReactElement } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DotItemDotProps, TooltipContentProps } from 'recharts';
import type { PriceTrend } from '@/data';
import { formatFiscalYearBe, formatNumber, formatThb } from '@/lib/format';
import { cx } from './utils';

export type TrendChartBasis = PriceTrend['basis'];
export type TrendChartPoint = PriceTrend['points'][number];

/** จำนวนตัวอย่างต่ำกว่านี้ = "ข้อมูลน้อย" (ตรงกับ `MIN_N_FOR_CHANGE_PCT` ใน `data/trends.ts`) */
const LOW_SAMPLE_THRESHOLD = 3;
const DEFAULT_HEIGHT = 240;

export interface TrendChartLabels {
  yearColumn: string;
  medianColumn: string;
  countColumn: string;
  lowSample: string;
  basisUnitPrice: string;
  basisAmountPerLine: string;
  emptyState: string;
}

export const DEFAULT_TREND_CHART_LABELS: TrendChartLabels = {
  yearColumn: 'ปี (พ.ศ.)',
  medianColumn: 'มัธยฐาน (บาท)',
  countColumn: 'จำนวนตัวอย่าง (n)',
  lowSample: 'ข้อมูลน้อย',
  basisUnitPrice: 'ราคาต่อหน่วย',
  basisAmountPerLine: 'ยอดต่อรายการงบ — ไม่ใช่ราคาต่อหน่วย',
  emptyState: 'ยังไม่มีข้อมูลแนวโน้มของรายการนี้',
};

export interface TrendChartProps {
  points: TrendChartPoint[];
  basis: TrendChartBasis;
  /** อธิบายกราฟสำหรับ screen reader (region label) */
  ariaLabel: string;
  height?: number;
  labels?: Partial<TrendChartLabels>;
  className?: string;
}

export interface TrendChartRow {
  yearBe: number;
  median: number | null;
  p25: number | null;
  bandHeight: number | null;
  n: number;
  lowSample: boolean;
  hasData: boolean;
}

/** ปีต่อเนื่องตั้งแต่ปีแรกถึงปีสุดท้ายที่มีข้อมูล — ปีที่ไม่มีข้อมูลจะกลายเป็นแถว `hasData:false` (ช่องว่าง) */
export function buildYearRange(points: TrendChartPoint[]): number[] {
  if (points.length === 0) {
    return [];
  }
  const years = points.map((p) => p.yearBe);
  const min = Math.min(...years);
  const max = Math.max(...years);
  const out: number[] = [];
  for (let y = min; y <= max; y += 1) {
    out.push(y);
  }
  return out;
}

/** แปลง sparse points → แถวต่อเนื่องทุกปี (pure function — ทดสอบได้โดยไม่ต้อง render Recharts) */
export function toChartRows(points: TrendChartPoint[]): TrendChartRow[] {
  const byYear = new Map(points.map((p) => [p.yearBe, p]));
  return buildYearRange(points).map((yearBe) => {
    const p = byYear.get(yearBe);
    if (!p) {
      return {
        yearBe,
        median: null,
        p25: null,
        bandHeight: null,
        n: 0,
        lowSample: false,
        hasData: false,
      };
    }
    const p25 = p.p25 ?? p.median;
    const p75 = p.p75 ?? p.median;
    return {
      yearBe,
      median: p.median,
      p25,
      bandHeight: Math.max(0, p75 - p25),
      n: p.n,
      lowSample: p.n < LOW_SAMPLE_THRESHOLD,
      hasData: true,
    };
  });
}

export function basisLabel(basis: TrendChartBasis, labels: TrendChartLabels): string {
  return basis === 'unit_price_per_line' ? labels.basisUnitPrice : labels.basisAmountPerLine;
}

/** จุดที่ n < 3 แสดงเป็นวงกลมกลวง (ปกติทึบ) — boundary: `payload` ของ recharts เป็น `any` โดย library เอง */
function renderMedianDot(props: DotItemDotProps): ReactElement {
  const dotX = props.cx;
  const dotY = props.cy;
  // boundary: recharts พิมพ์ payload เป็น `any` — แคสต์ตาม shape ที่เราส่งเข้า `data` เอง (ไม่ destructure
  // ตรง ๆ เพราะ `payload` เป็น `any` — จะกลายเป็น unsafe assignment ทันทีที่สร้าง binding ใหม่)
  const row = props.payload as TrendChartRow;
  if (dotX === undefined || dotY === undefined || !row.hasData || row.median === null) {
    return <circle cx={dotX ?? 0} cy={dotY ?? 0} r={0} fill="none" stroke="none" />;
  }
  if (row.lowSample) {
    return (
      <circle
        cx={dotX}
        cy={dotY}
        r={3}
        fill="var(--surface)"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeDasharray="2 2"
      />
    );
  }
  return <circle cx={dotX} cy={dotY} r={3} fill="var(--primary)" stroke="none" />;
}

/**
 * boundary: `Tooltip` ของ recharts ไม่ใช่ generic function ที่รับ type argument ตอนใช้เป็น JSX
 * (`export declare function Tooltip(outsideProps: TooltipProps<ValueType, NameType>): ...`) จึงต้องรับ
 * `TooltipContentProps` แบบ default generic (`ValueType`/`NameType`) แล้วแคสต์ `payload` เป็น
 * `TrendChartRow` เองข้างใน แทนการ narrow generic ตรง prop (ไม่งั้น `content=` ไม่ตรง type ที่ recharts
 * ประกาศไว้)
 */
function ChartTooltip({
  active,
  payload,
  labels,
}: TooltipContentProps & { labels: TrendChartLabels }): ReactElement | null {
  // `payload` เป็น required array ใน `TooltipContentProps` เสมอ (อาจว่างเปล่า) — เช็คแค่ length พอ
  if (!active || payload.length === 0) {
    return null;
  }
  // boundary: recharts พิมพ์ payload[].payload เป็น `any`
  const row = payload[0]?.payload as TrendChartRow | undefined;
  if (!row || !row.hasData || row.median === null) {
    return null;
  }
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-2">
      <p className="font-medium text-fg tabular-nums">
        {formatFiscalYearBe(row.yearBe, { withEra: true })}: {formatThb(row.median)} (n={String(row.n)})
      </p>
      {row.lowSample && <p className="text-xs text-fg-muted">{labels.lowSample}</p>}
    </div>
  );
}

/**
 * เส้น median + แถบ p25–p75 (Area ซ้อนแบบ stacked: baseline โปร่งใส + แถบสูง p75-p25)
 * ปีที่ไม่มีข้อมูล = `null` ใน data → recharts เว้นช่องว่างให้เอง (ไม่ลากเส้นเชื่อม)
 */
export function TrendChart({
  points,
  basis,
  ariaLabel,
  height = DEFAULT_HEIGHT,
  labels: labelsOverride,
  className,
}: TrendChartProps): ReactElement {
  const labels = { ...DEFAULT_TREND_CHART_LABELS, ...labelsOverride };
  const gradientId = useId();
  const rows = useMemo(() => toChartRows(points), [points]);
  const hasAnyData = rows.some((r) => r.hasData);

  if (rows.length === 0 || !hasAnyData) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        className={cx(
          'flex items-center justify-center rounded-md border border-dashed border-line bg-surface-2 text-sm text-fg-muted',
          className,
        )}
        style={{ height }}
      >
        {labels.emptyState}
      </div>
    );
  }

  return (
    <div className={cx('w-full', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded-sm bg-basis-historical-bg px-2 py-0.5 text-xs font-medium text-basis-historical">
          {basisLabel(basis, labels)}
        </span>
      </div>
      <div role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id={`trend-band-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--basis-historical)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--basis-historical)" stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="yearBe"
              tickFormatter={(value: number) => formatFiscalYearBe(value)}
              stroke="var(--text-muted)"
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(value: number) => formatNumber(value)}
              stroke="var(--text-muted)"
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              width={64}
            />
            <RechartsTooltip
              content={(props: TooltipContentProps) => <ChartTooltip {...props} labels={labels} />}
            />
            <Area
              dataKey="p25"
              stackId="band"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              connectNulls={false}
            />
            <Area
              dataKey="bandHeight"
              stackId="band"
              stroke="none"
              fill={`url(#trend-band-${gradientId})`}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              dataKey="median"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={renderMedianDot}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive
              animationDuration={250}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only" data-testid="trend-chart-table">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.yearColumn}</th>
            <th scope="col">{labels.medianColumn}</th>
            <th scope="col">{labels.countColumn}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.yearBe}>
              <td>{formatFiscalYearBe(row.yearBe)}</td>
              <td>{row.hasData && row.median !== null ? formatThb(row.median) : ''}</td>
              <td>
                {row.hasData ? formatNumber(row.n) : ''}
                {row.lowSample ? ` (${labels.lowSample})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
