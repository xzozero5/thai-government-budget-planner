import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Textarea } from '@/components/ui/Textarea';

describe('Textarea', () => {
  it('label เชื่อมกับ textarea และพิมพ์ได้', async () => {
    const user = userEvent.setup();
    render(<Textarea label="ข้อความ" />);
    const textarea = screen.getByLabelText('ข้อความ');
    await user.type(textarea, 'บรรทัดที่ 1{enter}บรรทัดที่ 2');
    expect(textarea).toHaveValue('บรรทัดที่ 1\nบรรทัดที่ 2');
  });

  it('ปรับความสูงตาม scrollHeight เมื่อพิมพ์ (auto-grow)', async () => {
    const user = userEvent.setup();
    render(<Textarea label="ข้อความ" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('ข้อความ');
    // jsdom ไม่มี layout engine จริง — จำลอง scrollHeight เพื่อยืนยันว่าโค้ด resize ถูกเรียกและ apply กับ style.height
    Object.defineProperty(textarea, 'scrollHeight', { value: 96, configurable: true });
    await user.type(textarea, 'ข้อความยาว');
    expect(textarea.style.height).toBe('96px');
  });

  it('จำกัดความสูงสูงสุดด้วย maxHeightPx', async () => {
    const user = userEvent.setup();
    render(<Textarea label="ข้อความ" maxHeightPx={80} />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('ข้อความ');
    Object.defineProperty(textarea, 'scrollHeight', { value: 200, configurable: true });
    await user.type(textarea, 'x');
    expect(textarea.style.height).toBe('80px');
  });

  it('error แสดง role=alert', () => {
    render(<Textarea label="โน้ต" error="กรอกไม่ครบ" />);
    expect(screen.getByRole('alert')).toHaveTextContent('กรอกไม่ครบ');
  });

  it('เรียก onInput เดิมที่ส่งเข้ามาด้วย', async () => {
    const user = userEvent.setup();
    const onInput = vi.fn();
    render(<Textarea label="ข้อความ" onInput={onInput} />);
    await user.type(screen.getByLabelText('ข้อความ'), 'a');
    expect(onInput).toHaveBeenCalled();
  });
});
