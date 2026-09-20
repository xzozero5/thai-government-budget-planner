/**
 * T-412 — StatCard: การ์ดตัวชี้วัดใน proposal pane (06 §4.3) ค่าใหญ่ + count-up เมื่อค่าเปลี่ยน
 * (motion.md #10: rAF, ≤600ms, ease-out, ปิดเมื่อ reduced-motion — ค่าปลายทางต้องอยู่ใน DOM เสมอ
 * ไม่ใช่แค่ตอน animation จบ เพื่อไม่ให้ screen reader อ่านค่ากลางอนิเมชัน)
 */
import type { ReactElement } from 'react';
import { useCountUp } from '@/components/motion/useCountUp';
import { formatNumber } from '@/lib/format';
import { Sparkline, type SparklinePoint } from './Sparkline';
import { cx, FOCUS_RING, usePrefersReducedMotion } from './utils';

export type StatCardBasisKind = 'historical' | 'market' | 'estimate';

export interface StatCardBasis {
  kind: StatCardBasisKind;
  /** ข้อความเต็ม เช่น "จากงบจริง" (06 §5) — ไม่ hard-code ที่นี่ ผู้เรียกส่งจาก copy กลาง */
  label: string;
}

export interface StatCardSparkline {
  points: SparklinePoint[];
  ariaLabel: string;
}

export interface StatCardProps {
  label: string;
  /** ค่าที่ format แล้ว (string) หรือค่าดิบ (number) — number เท่านั้นที่ count-up ได้ */
  value: number | string;
  /** ใช้ format ค่า `value` เมื่อเป็น number — ค่าเริ่มต้น `formatNumber` (th-TH) */
  formatter?: (n: number) => string;
  sublabel?: string;
  basis?: StatCardBasis;
  sparkline?: StatCardSparkline;
  onClick?: () => void;
  /** ระยะเวลา count-up สูงสุด (ms) — ค่าเริ่มต้น/เพดาน 600ms ตาม motion.md #10 */
  animationDurationMs?: number;
  className?: string;
}

const MAX_ANIMATION_MS = 600;

const BASIS_CLASSES: Record<StatCardBasisKind, string> = {
  historical: 'bg-basis-historical-bg text-basis-historical',
  market: 'bg-basis-market-bg text-basis-market',
  estimate: 'bg-basis-estimate-bg text-basis-estimate',
};

function ValueDisplay({
  value,
  formatter,
  animationDurationMs,
}: {
  value: number | string;
  formatter: (n: number) => string;
  animationDurationMs: number;
}): ReactElement {
  const reducedMotion = usePrefersReducedMotion();
  const numericValue = typeof value === 'number' ? value : null;
  // ค่า string ไม่มี "ก่อนหน้า" ให้ไล่ตัวเลข — ส่ง 0 เป็น placeholder เฉย ๆ (hook ต้องเรียกแบบไม่มีเงื่อนไข)
  const displayed = useCountUp(numericValue ?? 0, animationDurationMs, reducedMotion);

  const finalText = numericValue === null ? value : formatter(numericValue);
  const visibleText = numericValue === null ? value : formatter(displayed);

  return (
    <span className="text-2xl font-semibold tabular-nums text-fg">
      <span aria-hidden="true">{visibleText}</span>
      <span className="sr-only" aria-live="polite">
        {finalText}
      </span>
    </span>
  );
}

/** การ์ดตัวชี้วัด (06 §4.3): label, ค่าใหญ่ + count-up, sparkline/basis badge เป็นตัวเลือก */
export function StatCard({
  label,
  value,
  formatter = formatNumber,
  sublabel,
  basis,
  sparkline,
  onClick,
  animationDurationMs = MAX_ANIMATION_MS,
  className,
}: StatCardProps): ReactElement {
  const content = (
    <>
      <p className="text-sm text-fg-muted">{label}</p>
      <ValueDisplay value={value} formatter={formatter} animationDurationMs={animationDurationMs} />
      {sublabel && <p className="mt-1 text-xs text-fg-muted">{sublabel}</p>}
      <div className="mt-2 flex items-center gap-2">
        {basis && (
          <span
            className={cx(
              'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium',
              BASIS_CLASSES[basis.kind],
            )}
          >
            {basis.label}
          </span>
        )}
        {sparkline && (
          <Sparkline points={sparkline.points} ariaLabel={sparkline.ariaLabel} width={72} height={20} />
        )}
      </div>
    </>
  );

  const wrapperClassName = cx(
    'block w-full rounded-md border border-line bg-surface p-4 text-left shadow-1',
    onClick && 'transition duration-fast ease-out hover:-translate-y-0.5 hover:shadow-2',
    onClick && FOCUS_RING,
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={wrapperClassName}>
        {content}
      </button>
    );
  }

  return <div className={wrapperClassName}>{content}</div>;
}
