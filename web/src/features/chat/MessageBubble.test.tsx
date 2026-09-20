import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/stores/chatStore';
import { t } from '@/i18n';
import { MessageBubble } from './MessageBubble';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    text: '',
    status: 'done',
    toolActivities: [],
    warnings: [],
    ...overrides,
  };
}

describe('MessageBubble — render เป็น text node เท่านั้น (N9/T-307)', () => {
  it('ไม่สร้าง element จริงจากข้อความที่มีลักษณะคล้าย HTML', () => {
    render(<MessageBubble message={message({ text: '<b>bold</b>' })} />);

    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
  });

  it('ขึ้นบรรทัดใหม่ในข้อความยังคงอยู่ (whitespace-pre-wrap ไม่ใช่ markdown)', () => {
    render(<MessageBubble message={message({ text: 'บรรทัดที่ 1\nบรรทัดที่ 2' })} />);

    expect(screen.getByText((_, node) => node?.textContent === 'บรรทัดที่ 1\nบรรทัดที่ 2')).toBeInTheDocument();
  });
});

describe('MessageBubble — สถานะจบ turn', () => {
  it('cancelled → แสดงข้อความหยุดกลางคัน', () => {
    render(<MessageBubble message={message({ status: 'cancelled' })} />);
    expect(screen.getByText(t('errors.cancelled'))).toBeInTheDocument();
  });

  it('error + onRetry → กดปุ่มแล้วเรียก callback', () => {
    const onRetry = vi.fn();
    render(<MessageBubble message={message({ status: 'error', warnings: ['ผิดพลาด'] })} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('ผิดพลาด');
    fireEvent.click(screen.getByRole('button', { name: t('chat.regenerate') }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
