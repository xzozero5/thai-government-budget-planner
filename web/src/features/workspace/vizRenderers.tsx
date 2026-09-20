/**
 * T-405 (ต่อสาย) — implementation จริงของ `renderTrend`/`renderStatCards`/`renderIllustration` slot
 * ของ `ProposalPaneProps` (`@/features/proposal`) ต่อกับ `@/components/viz` (T-412) + facade `@/data`
 * (ผ่าน `useTrendResult`/`trendData.ts`) + `IllustrationSink` (`@/ai/illustrationSink`)
 *
 * หมายเหตุขอบเขต: BOQ มีช่อง trend เป็นคอลัมน์แคบ ๆ ในตาราง (ดูคอมเมนต์หัวไฟล์ `BoqTable.tsx`:
 * "sparkline slot") จึงใช้ `Sparkline` (เบา ไม่ใช่ Recharts) แทน `TrendChartLazy` (กราฟเต็มพร้อม
 * Recharts) ที่นี่ — `TrendChartLazy` ยังไม่มีจุดใช้งานจริงใน 06-UI-SPEC ปัจจุบันนอกจากคอลัมน์นี้ ถ้า
 * ภายหลังมี section ใหม่ (เช่น modal ดูแนวโน้มแบบเต็ม) ค่อยต่อ `TrendChartLazy` เพิ่มจากจุดนี้ได้ทันที
 * (ข้อมูล `TrendResult` ที่โหลดแล้วพร้อมใช้อยู่แล้ว)
 *
 * ป้าย aria-label ของ Sparkline/StatCard ยังไม่มี key เฉพาะใน `docs/ui/copy.th.json` (มีแต่
 * `proposal.boq.colTrend` = "แนวโน้ม" ระดับหัวคอลัมน์) — ประกอบข้อความเองที่นี่ตามธรรมเนียมเดิมของ
 * repo เมื่อ copy ยังไม่มี (ดู `TrendChart.tsx` DEFAULT_TREND_CHART_LABELS) รายงานเป็น key ที่ขาดท้ายงาน
 */
import type { ReactElement } from 'react';
import type { IllustrationRef, StatCard as StatCardData, TrendRef } from '@/ai/tools/proposal';
import type { IllustrationSink } from '@/ai/illustrationSink';
import { IllustrationFrame, Sparkline, StatCard, type SparklinePoint } from '@/components/viz';
import { Skeleton } from '@/components/ui';
import { t } from '@/i18n';
import { isPriceTrend, type TrendResult } from './trendData';
import { useTrendResult } from './useTrendResult';

function toSparklinePoints(result: TrendResult): SparklinePoint[] {
  if (isPriceTrend(result)) {
    return result.points.map((p) => ({ x: p.yearBe, y: p.median }));
  }
  return result.points.map((p) => ({ x: p.yearBe, y: p.value }));
}

function latestValue(result: TrendResult): number | null {
  if (isPriceTrend(result)) {
    const last = result.points[result.points.length - 1];
    return last ? last.median : null;
  }
  const last = result.points[result.points.length - 1];
  return last ? last.value : null;
}

function trendAriaLabel(result: TrendResult): string {
  // ยังไม่มี key ใน copy.th.json สำหรับ aria-label ของกราฟแนวโน้ม (ดูคอมเมนต์หัวไฟล์) — ประกอบเองชั่วคราว
  return isPriceTrend(result)
    ? `${t('proposal.boq.colTrend')}: ${result.key}`
    : `${t('proposal.boq.colTrend')}: ${result.label_th}`;
}

function trendSublabel(result: TrendResult): string {
  return isPriceTrend(result) ? result.unitLabel : result.unit;
}

/** ช่องคอลัมน์ "แนวโน้ม" ของตาราง BOQ (T-412 slot `renderTrend`) */
export function BoqTrendCell({ trendRef }: { trendRef: TrendRef }): ReactElement {
  const state = useTrendResult(trendRef);

  if (state.status === 'loading') {
    return <Skeleton width={72} height={20} />;
  }
  if (state.status === 'error' || state.data === null) {
    return <span className="text-xs text-fg-muted">{t('proposal.boq.trendEmpty')}</span>;
  }
  const points = toSparklinePoints(state.data);
  if (points.length === 0) {
    return <span className="text-xs text-fg-muted">{t('proposal.boq.trendEmpty')}</span>;
  }
  return <Sparkline points={points} ariaLabel={trendAriaLabel(state.data)} />;
}

/** การ์ดสถิติของ proposal (T-412 slot `renderStatCards`) — ค่า/sparkline มาจาก `stat_cards[].trend_ref`
 * (`StatCardSchema` มีแค่ `trend_ref` + `headline_th` ไม่มีค่าตัวเลขมาให้ตรง ๆ — ต้องโหลด series เอง) */
export function ProposalStatCard({ card }: { card: StatCardData }): ReactElement {
  const state = useTrendResult(card.trend_ref);

  if (state.status === 'loading') {
    return <StatCard label={card.headline_th} value={t('common.loading')} />;
  }
  if (state.status === 'error' || state.data === null) {
    return <StatCard label={card.headline_th} value={t('common.unknown')} />;
  }

  const value = latestValue(state.data);
  const points = toSparklinePoints(state.data);

  return (
    <StatCard
      label={card.headline_th}
      value={value ?? t('common.unknown')}
      sublabel={trendSublabel(state.data)}
      {...(points.length > 0 ? { sparkline: { points, ariaLabel: trendAriaLabel(state.data) } } : {})}
    />
  );
}

/** ภาพประกอบของ proposal (T-412 slot `renderIllustration`) — ดึง SVG (sanitize แล้วตั้งแต่
 * `emit_illustration`) จาก `IllustrationSink` ตาม id; `IllustrationFrame` เอง sanitize ซ้ำอีกชั้นก่อน
 * mount DOM จริงเสมอ (N9 defense-in-depth) — ไม่พบใน sink (เช่นโหลดจากไฟล์ `.tgbp.json` เก่าที่ไม่มี
 * ภาพประกอบจริงแนบมา) → ไม่ render อะไรเลย (ไม่ใช่ error เพราะเป็นข้อจำกัดที่ทราบอยู่แล้วของ T-403) */
export function ProposalIllustration({
  illustrationRef,
  illustrationSink,
  onHide,
}: {
  illustrationRef: IllustrationRef;
  illustrationSink: IllustrationSink | null;
  onHide?: () => void;
}): ReactElement | null {
  const stored = illustrationSink?.get(illustrationRef.illustration_id);
  if (!stored) {
    return null;
  }
  return (
    <IllustrationFrame
      svgText={stored.svg}
      title={stored.title}
      caption={stored.caption}
      {...(onHide ? { onHide } : {})}
    />
  );
}
