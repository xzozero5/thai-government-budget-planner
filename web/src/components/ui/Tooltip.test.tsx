import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from '@/components/ui/Tooltip';

describe('Tooltip', () => {
  it('trigger เชื่อมกับ tooltip ผ่าน aria-describedby', () => {
    render(
      <Tooltip content="unit_price n=1 — ตัวอย่างน้อย">
        <button type="button">ⓘ</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button');
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('แสดงเมื่อ focus และซ่อนเมื่อ blur', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="รายละเอียด">
        <button type="button">ⓘ</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button');
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.className).toContain('invisible');
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(tooltip.className).toContain('visible');
    await user.tab();
    expect(tooltip.className).toContain('invisible');
  });
});
