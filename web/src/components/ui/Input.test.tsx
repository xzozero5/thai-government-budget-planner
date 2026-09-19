import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  it('label เชื่อมกับ input ผ่าน htmlFor/id', () => {
    render(<Input label="API key" />);
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
  });

  it('พิมพ์ข้อความได้', async () => {
    const user = userEvent.setup();
    render(<Input label="ชื่อโครงการ" />);
    const input = screen.getByLabelText('ชื่อโครงการ');
    await user.type(input, 'ฝายน้ำล้น');
    expect(input).toHaveValue('ฝายน้ำล้น');
  });

  it('error แสดงเป็น role=alert และ aria-invalid', () => {
    render(<Input label="งบสูงสุด" error="ต้องมากกว่า 0" />);
    const input = screen.getByLabelText('งบสูงสุด');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('ต้องมากกว่า 0');
    expect(input).toHaveAccessibleDescription('ต้องมากกว่า 0');
  });

  it('helperText แสดงเมื่อไม่มี error', () => {
    render(<Input label="โมเดล" helperText="เลือกได้ภายหลัง" />);
    expect(screen.getByText('เลือกได้ภายหลัง')).toBeInTheDocument();
  });
});
