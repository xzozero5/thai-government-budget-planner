import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tabs } from '@/components/ui/Tabs';

const ITEMS = [
  { id: 'chat', label: 'แชท', content: <p>เนื้อหาแชท</p> },
  { id: 'proposal', label: 'ข้อเสนอ', content: <p>เนื้อหาข้อเสนอ</p> },
];

describe('Tabs', () => {
  it('แท็บแรกเลือกอยู่โดย default และแสดง panel ที่ตรงกัน', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tab', { name: 'แชท' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('เนื้อหาแชท')).toBeVisible();
  });

  it('คลิกแท็บเปลี่ยน panel ที่แสดง', async () => {
    const user = userEvent.setup();
    render(<Tabs items={ITEMS} />);
    await user.click(screen.getByRole('tab', { name: 'ข้อเสนอ' }));
    expect(screen.getByRole('tab', { name: 'ข้อเสนอ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('เนื้อหาข้อเสนอ')).toBeVisible();
  });

  it('ArrowRight/ArrowLeft เลื่อนแท็บและโฟกัสตาม', async () => {
    const user = userEvent.setup();
    render(<Tabs items={ITEMS} />);
    screen.getByRole('tab', { name: 'แชท' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'ข้อเสนอ' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'ข้อเสนอ' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'แชท' })).toHaveFocus();
  });
});
