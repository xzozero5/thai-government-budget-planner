import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/components/ui/utils';

export type BadgeVariant = 'neutral' | 'success' | 'warn' | 'danger' | 'info';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-2 text-fg',
  success: 'bg-surface-2 text-success',
  warn: 'bg-surface-2 text-warn',
  danger: 'bg-surface-2 text-danger',
  info: 'bg-surface-2 text-info',
};

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

/** ป้ายสถานะทั่วไป — ข้อความรับผ่าน `children` เสมอ (ไม่ hardcode ไทย, ดู docs/ui/copy.th.json) */
export function Badge({ variant = 'neutral', children, className }: BadgeProps): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type Basis = 'historical' | 'market' | 'estimate';

const BASIS_CLASSES: Record<Basis, string> = {
  historical: 'bg-basis-historical-bg text-basis-historical',
  market: 'bg-basis-market-bg text-basis-market',
  estimate: 'bg-basis-estimate-bg text-basis-estimate',
};

// 06 §2: "ต้องผ่าน contrast 4.5:1 ทั้ง 2 โหมด และมี ไอคอน/ตัวอักษรกำกับ ไม่ใช้สีอย่างเดียว"
// ใช้ตัวอักษรกำกับคงที่ (ไม่ใช่ข้อความยาว) + label เต็มมาจาก props เพื่อไม่ hardcode ไทยใน primitive
const BASIS_MARK: Record<Basis, string> = {
  historical: 'จ',
  market: 'ต',
  estimate: '~',
};

export interface BasisBadgeProps {
  basis: Basis;
  /** ข้อความเต็ม เช่น "จากงบจริง" / "ราคาตลาด" / "ประมาณการ" (06 §5) — มาจาก copy กลาง ไม่ hardcode ที่นี่ */
  label: string;
  className?: string;
}

/** ป้าย basis ของตัวเลข (N3) — สี + ตัวอักษรกำกับ + label เต็ม เพื่อไม่พึ่งสีอย่างเดียว */
export function BasisBadge({ basis, label, className }: BasisBadgeProps): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium',
        BASIS_CLASSES[basis],
        className,
      )}
    >
      <span aria-hidden="true" className="font-bold">
        {BASIS_MARK[basis]}
      </span>
      <span>{label}</span>
    </span>
  );
}
