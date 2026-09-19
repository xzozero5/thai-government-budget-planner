import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Accordion } from '@/components/ui/Accordion';

describe('Accordion', () => {
  it('เปิดทุกส่วนโดย default (06 §4.3)', () => {
    render(
      <Accordion
        items={[
          { id: 'a', title: 'สรุป', content: 'เนื้อหา A' },
          { id: 'b', title: 'BOQ', content: 'เนื้อหา B' },
        ]}
      />,
    );
    expect(screen.getByText('เนื้อหา A')).toBeInTheDocument();
    expect(screen.getByText('เนื้อหา B')).toBeInTheDocument();
  });

  it('defaultOpen:false ปิดตอนแรก และคลิกหัวข้อสลับเปิด/ปิด', async () => {
    const user = userEvent.setup();
    render(
      <Accordion
        items={[{ id: 'a', title: 'ความเสี่ยง', content: 'เนื้อหาเสี่ยง', defaultOpen: false }]}
      />,
    );
    expect(screen.queryByText('เนื้อหาเสี่ยง')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'ความเสี่ยง' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('เนื้อหาเสี่ยง')).toBeInTheDocument();
    await user.click(button);
    expect(screen.queryByText('เนื้อหาเสี่ยง')).not.toBeInTheDocument();
  });
});
