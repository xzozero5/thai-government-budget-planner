import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { cn } from '@/components/ui/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** การ์ดพื้นผิวมาตรฐาน (06 §1: flat, ขอบมน, เงาต่ำ) */
export function Card({ children, className, ...rest }: CardProps): ReactElement {
  return (
    <div
      className={cn('rounded-md border border-line bg-surface p-4 shadow-1', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className, ...rest }: CardProps): ReactElement {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ children, className, ...rest }: CardProps): ReactElement {
  return (
    <div className={cn('text-fg', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className, ...rest }: CardProps): ReactElement {
  return (
    <div className={cn('mt-3 flex items-center gap-2', className)} {...rest}>
      {children}
    </div>
  );
}
