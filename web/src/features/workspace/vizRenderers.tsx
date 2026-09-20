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
import { Button, Skeleton, Tooltip } from '@/components/ui';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
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

/** ของใหม่จากชุด A ที่ยังไม่ถูกใช้ (po-review): `proposal.boq.trendAriaLabel`/`trendTooltip` ต้องการ
 * ปี/มัธยฐาน/n ของจุดล่าสุด ซึ่งมีความหมายชัดเจนเฉพาะ `PriceTrend` (จุดของ `EconTrend` มีแค่ค่าเดียว ไม่มี
 * แนวคิด median/n ต่อปี) — ใช้ key ใหม่เฉพาะกรณี `PriceTrend` ที่มีจุดข้อมูลจริง ส่วน `EconTrend` คง label
 * แบบย่อเดิมไว้ (ไม่ทำให้ placeholder {median}/{count} ค้างเป็นข้อความดิบ) */
function trendAriaLabel(result: TrendResult): string {
  if (isPriceTrend(result)) {
    const last = result.points[result.points.length - 1];
    if (last) {
      return t('proposal.boq.trendAriaLabel', {
        item: result.key,
        median: formatNumber(last.median),
        count: last.n,
      });
    }
    return `${t('proposal.boq.colTrend')}: ${result.key}`;
  }
  return `${t('proposal.boq.colTrend')}: ${result.label_th}`;
}

/** เนื้อหา tooltip ของ sparkline (hover/focus) — `undefined` เมื่อไม่มีจุดข้อมูลจริงให้สรุป (EconTrend หรือ
 * PriceTrend ที่ยังไม่มีจุดใด ๆ) */
function trendTooltipContent(result: TrendResult): string | undefined {
  if (!isPriceTrend(result)) {
    return undefined;
  }
  const last = result.points[result.points.length - 1];
  if (!last) {
    return undefined;
  }
  return t('proposal.boq.trendTooltip', { year: last.yearBe, median: formatNumber(last.median), count: last.n });
}

function trendSublabel(result: TrendResult): string {
  return isPriceTrend(result) ? result.unitLabel : result.unit;
}

/** S8 (US-8.2, po-review ชุด B) — Δ% ของช่วงที่ใช้ (มีทั้งใน `PriceTrend`/`EconTrend` เป็น `changePct`
 * เดียวกันอยู่แล้ว จาก `data/trends.ts`) ตัวอย่างน้อยเกินไปจนสรุป % ไม่ได้ → `changePct` เป็น `null` และ
 * `StatCard` จะไม่แสดง Δ% เลย (ไม่ประดิษฐ์ตัวเลข) */
function statCardDeltaPct(result: TrendResult): number | undefined {
  return result.changePct?.pct;
}

/** ป้ายแหล่งที่มา — มีเฉพาะ `EconTrend` (มี `source_name` ติดมาจาก snapshot จริง) `PriceTrend` มาจาก
 * งบเบิกจ่ายจริงในคลังของเว็บเอง ไม่มีชื่อแหล่งภายนอกให้แสดงแยก จึงไม่ใส่ sourceLabel ให้ (ต่างจาก verified
 * ที่ยังตัดสินได้แม้ไม่มี source_name) */
function statCardSourceLabel(result: TrendResult): string | undefined {
  return isPriceTrend(result) ? undefined : t('proposal.stat.sourceLabel', { source: result.source_name });
}

/** verified (US-8.2 "ป้าย verified"): `PriceTrend` มาจากงบเบิกจ่ายจริงที่ตรวจสอบ/normalize แล้วในคลังของ
 * เว็บเอง (N3 ถือว่ายืนยันแล้ว) ส่วน `EconTrend` เป็น snapshot ตัวชี้วัดเศรษฐกิจที่ยังไม่ตรวจทานซ้ำทีละค่า
 * (`data/trends.ts` — `verified: false` เสมอ ณ วันนี้) */
function statCardVerified(result: TrendResult): boolean {
  return isPriceTrend(result) ? true : result.verified;
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
  const sparkline = <Sparkline points={points} ariaLabel={trendAriaLabel(state.data)} />;
  const tooltip = trendTooltipContent(state.data);
  if (tooltip === undefined) {
    return sparkline;
  }
  return (
    <Tooltip content={tooltip}>
      <span tabIndex={0}>{sparkline}</span>
    </Tooltip>
  );
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
  const deltaPct = statCardDeltaPct(state.data);
  const sourceLabel = statCardSourceLabel(state.data);

  return (
    <StatCard
      label={card.headline_th}
      value={value ?? t('common.unknown')}
      sublabel={trendSublabel(state.data)}
      verified={statCardVerified(state.data)}
      {...(deltaPct !== undefined ? { deltaPct } : {})}
      {...(sourceLabel !== undefined ? { sourceLabel } : {})}
      {...(points.length > 0 ? { sparkline: { points, ariaLabel: trendAriaLabel(state.data) } } : {})}
    />
  );
}

/** S9 (po-review ชุด B, US-7.1) — การ์ด "ซ่อนไว้แล้ว" แทนที่ `IllustrationFrame` เต็มตัวเมื่อผู้ใช้กด
 * "ซ่อนภาพ" — คงชื่อภาพให้เห็นบริบท พร้อมปุ่ม "แสดงภาพ" กลับ (state จริงอยู่ที่ container — ดู
 * `features/workspace/slots.tsx#ProposalPaneContainer`, component นี้แค่ presentational) */
function HiddenIllustrationPlaceholder({
  title,
  onShow,
}: {
  title: string;
  onShow?: () => void;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-line bg-surface-2 p-3 text-sm text-fg-muted">
      <span>{title}</span>
      {onShow && (
        <Button variant="ghost" size="sm" onClick={onShow}>
          {t('proposal.illustration.show')}
        </Button>
      )}
    </div>
  );
}

/** ภาพประกอบของ proposal (T-412 slot `renderIllustration`) — ดึง SVG (sanitize แล้วตั้งแต่
 * `emit_illustration`) จาก `IllustrationSink` ตาม id; `IllustrationFrame` เอง sanitize ซ้ำอีกชั้นก่อน
 * mount DOM จริงเสมอ (N9 defense-in-depth) — ไม่พบใน sink (เช่นโหลดจากไฟล์ `.tgbp.json` เก่าที่ไม่มี
 * ภาพประกอบจริงแนบมา) → ไม่ render อะไรเลย (ไม่ใช่ error เพราะเป็นข้อจำกัดที่ทราบอยู่แล้วของ T-403)
 *
 * S9 — `hidden`/`onShow` เป็น state ของ container (ไม่ใช่ของไฟล์นี้ — presentational ล้วน) `onRegenerate`
 * ถ้าส่งมา container ควรงดส่งตอน AI กำลังรัน (`isAiRunning`) แทนการส่งมาแต่ disable ปุ่มเอง เพราะ
 * `IllustrationFrame` (`components/viz/**`, ไม่ได้เป็นเจ้าของไฟล์นี้) ไม่มี prop ปิดปุ่มแยกจาก "ไม่ส่ง
 * callback มาเลย" */
export function ProposalIllustration({
  illustrationRef,
  illustrationSink,
  hidden = false,
  onHide,
  onShow,
  onRegenerate,
}: {
  illustrationRef: IllustrationRef;
  illustrationSink: IllustrationSink | null;
  hidden?: boolean;
  onHide?: () => void;
  onShow?: () => void;
  onRegenerate?: () => void;
}): ReactElement | null {
  const stored = illustrationSink?.get(illustrationRef.illustration_id);
  if (!stored) {
    return null;
  }
  if (hidden) {
    return <HiddenIllustrationPlaceholder title={stored.title} {...(onShow ? { onShow } : {})} />;
  }
  return (
    <IllustrationFrame
      svgText={stored.svg}
      title={stored.title}
      caption={stored.caption}
      {...(onHide ? { onHide } : {})}
      {...(onRegenerate ? { onRegenerate } : {})}
    />
  );
}
