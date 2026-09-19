import type {
  HTMLAttributes,
  ReactElement,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from '@/components/ui/utils';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

/** ตารางพื้นฐาน (06 §4.3 BOQ table): thead sticky, ตัวเลข tabular-nums ชิดขวา ผ่าน `TableCell numeric` */
export function Table({ children, className, ...rest }: TableProps): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>): ReactElement {
  return (
    <thead
      className={cn('sticky top-0 z-10 bg-surface-2 text-left text-fg-muted', className)}
      {...rest}
    >
      {children}
    </thead>
  );
}

export function TableBody({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>): ReactElement {
  return (
    <tbody className={cn('divide-y divide-line', className)} {...rest}>
      {children}
    </tbody>
  );
}

export function TableRow({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableRowElement>): ReactElement {
  return (
    <tr className={cn('hover:bg-surface-2', className)} {...rest}>
      {children}
    </tr>
  );
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
  /** จัดชิดขวาสำหรับคอลัมน์ตัวเลข (ต้องตรงกับ `TableCell numeric` ในคอลัมน์เดียวกัน) */
  numeric?: boolean;
}

export function TableHeaderCell({
  children,
  scope = 'col',
  numeric = false,
  className,
  ...rest
}: TableHeaderCellProps): ReactElement {
  return (
    <th
      scope={scope}
      className={cn('px-3 py-2 font-medium', numeric && 'text-right', className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
  /** ค่าตัวเลข — จัดชิดขวา + `tabular-nums` (06 §2) */
  numeric?: boolean;
}

export function TableCell({
  children,
  numeric = false,
  className,
  ...rest
}: TableCellProps): ReactElement {
  return (
    <td
      className={cn('px-3 py-2 text-fg', numeric && 'text-right tabular-nums', className)}
      {...rest}
    >
      {children}
    </td>
  );
}
