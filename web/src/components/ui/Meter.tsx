import type { ReactElement } from 'react';
import { cn } from '@/components/ui/utils';

export interface MeterProps {
  /** ค่าปัจจุบัน (เช่น ต้นทุน USD ที่ใช้ไปแล้ว) */
  value: number;
  /** ค่าสูงสุด/เพดาน */
  max: number;
  /** ชื่อสิ่งที่วัด เช่น "ค่าใช้จ่าย session นี้" — ใช้เป็น accessible name */
  label: string;
  /** ข้อความแสดงค่าปัจจุบัน/max ที่จัดรูปแบบแล้ว (เช่น "$0.15 / $2.00") — ผู้เรียกจัดรูปแบบเอง (lib/format.ts) */
  valueText?: string;
  className?: string;
}

/** มิเตอร์ค่าใช้จ่าย/เพดาน (06 §4.2 token/cost meter) — role="meter" (ปริมาณเทียบเพดาน ไม่ใช่ progress ของงาน) */
export function Meter({ value, max, label, valueText, className }: MeterProps): ReactElement {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const isNearLimit = ratio >= 0.8;
  const isOverLimit = ratio >= 1;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{label}</span>
        {valueText && <span className="tabular-nums">{valueText}</span>}
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-2 w-full overflow-hidden rounded-sm bg-surface-2"
      >
        <div
          className={cn(
            'h-full rounded-sm transition-[width] duration-base ease-out',
            isOverLimit ? 'bg-danger' : isNearLimit ? 'bg-warn' : 'bg-accent',
          )}
          style={{ width: `${String(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}
