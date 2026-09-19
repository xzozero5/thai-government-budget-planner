import type { ReactElement } from 'react';
import { cn } from '@/components/ui/utils';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

const FILLED_COUNT: Record<ConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const DEFAULT_LABEL: Record<ConfidenceLevel, string> = {
  high: 'ความเชื่อมั่นสูง',
  medium: 'ความเชื่อมั่นปานกลาง',
  low: 'ความเชื่อมั่นต่ำ',
};

export interface ConfidenceDotsProps {
  level: ConfidenceLevel;
  /** ข้อความ aria/tooltip — override ได้ (ค่าเริ่มต้นภาษาไทย) */
  label?: string;
  className?: string;
}

/** ●●●/●●○/●○○ + tooltip/aria-label (06 §2) */
export function ConfidenceDots({ level, label, className }: ConfidenceDotsProps): ReactElement {
  const text = label ?? DEFAULT_LABEL[level];
  const filled = FILLED_COUNT[level];

  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={cn('inline-flex items-center gap-0.5 text-fg', className)}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden="true" className={i < filled ? 'opacity-100' : 'opacity-30'}>
          ●
        </span>
      ))}
    </span>
  );
}
