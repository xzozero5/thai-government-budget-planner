import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TotalsSection } from './TotalsSection';

describe('TotalsSection (M6, po-review ชุด B)', () => {
  it('แสดง subtotal, ค่าเผื่อเหลือเผื่อขาด (% + จำนวนเงิน), VAT ยังไม่รวม, รวมทั้งสิ้น', () => {
    render(
      <TotalsSection
        totals={{
          subtotal_thb: 389330,
          contingency_pct: 5,
          contingency_thb: 19466.5,
          vat_included: false,
          grand_total_thb: 408796.5,
        }}
      />,
    );
    expect(screen.getByText('389,330 บาท')).toBeInTheDocument();
    expect(screen.getByText('5% (19,466.5 บาท)')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่รวม — ต้องคำนวณเพิ่มก่อนอนุมัติ')).toBeInTheDocument();
    expect(screen.getByText('408,796.5 บาท')).toBeInTheDocument();
  });

  it('vat_included=true → แสดง "รวมในราคาแล้ว"', () => {
    render(
      <TotalsSection
        totals={{ subtotal_thb: 100000, vat_included: true, grand_total_thb: 107000 }}
      />,
    );
    expect(screen.getByText('รวมในราคาแล้ว')).toBeInTheDocument();
  });

  it('ไม่มี contingency เลย → ไม่แสดงแถวค่าเผื่อเหลือเผื่อขาด', () => {
    render(<TotalsSection totals={{ subtotal_thb: 100000, vat_included: true, grand_total_thb: 107000 }} />);
    expect(screen.queryByText('ค่าใช้จ่ายสำรอง')).not.toBeInTheDocument();
  });
});
