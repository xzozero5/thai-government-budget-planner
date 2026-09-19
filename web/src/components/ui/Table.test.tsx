import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';

describe('Table', () => {
  it('render th scope=col และ thead sticky', () => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>รายการ</TableHeaderCell>
            <TableHeaderCell numeric>รวม</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>เครื่องปรับอากาศ</TableCell>
            <TableCell numeric>28,000</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const header = screen.getByRole('columnheader', { name: 'รายการ' });
    expect(header).toHaveAttribute('scope', 'col');
    expect(header.closest('thead')?.className).toContain('sticky');
  });

  it('TableCell numeric ใช้ tabular-nums และชิดขวา', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell numeric>28,000</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = screen.getByText('28,000');
    expect(cell.className).toContain('tabular-nums');
    expect(cell.className).toContain('text-right');
  });
});
