import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Select } from '@/components/ui/Select';

const OPTIONS = [
  { value: 'sonnet', label: 'Claude Sonnet' },
  { value: 'opus', label: 'Claude Opus' },
];

describe('Select', () => {
  it('label เชื่อมกับ select และเลือกค่าได้', async () => {
    const user = userEvent.setup();
    render(<Select label="โมเดล" options={OPTIONS} defaultValue="sonnet" />);
    const select = screen.getByLabelText('โมเดล');
    await user.selectOptions(select, 'opus');
    expect(select).toHaveValue('opus');
  });

  it('แสดง error เป็น role=alert', () => {
    render(<Select label="โมเดล" options={OPTIONS} error="ต้องเลือกโมเดล" />);
    expect(screen.getByRole('alert')).toHaveTextContent('ต้องเลือกโมเดล');
  });
});
