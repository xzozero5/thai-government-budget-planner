import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionChatController } from '@/ai/session/chatController';
import { t } from '@/i18n';
import { useChatStore } from '@/stores/chatStore';
import { useSessionStore } from '@/stores/sessionStore';
import { ChatPane } from './ChatPane';

vi.mock('@/ai/session/chatController', () => ({
  sessionChatController: {
    sendMessage: vi.fn(),
    cancel: vi.fn(),
    requestReview: vi.fn(),
    getToolLog: vi.fn(),
    getIllustrationSink: vi.fn(),
    isRunning: vi.fn(() => false),
    reset: vi.fn(),
  },
}));

beforeEach(() => {
  useChatStore.getState().reset();
  useSessionStore.setState({ mode: 'draft' });
  vi.mocked(sessionChatController.sendMessage).mockClear();
  vi.mocked(sessionChatController.cancel).mockClear();
});

describe('ChatPane — empty state (06 §4.2)', () => {
  it('แสดงตัวอย่างโจทย์ 3 ข้อ และคลิกแล้วเติมข้อความลง composer (ไม่ส่งทันที)', () => {
    render(<ChatPane />);

    expect(screen.getByText(t('chat.emptyTitle'))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t('chat.example2Title')));

    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });
    expect(textarea).toHaveValue(t('chat.example2Text'));
    expect(sessionChatController.sendMessage).not.toHaveBeenCalled();
  });
});

describe('ChatPane — composer (06 §4.2/§4.6)', () => {
  it('พิมพ์แล้วกด Enter → เรียก controller.sendMessage และล้าง composer', () => {
    render(<ChatPane />);
    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });

    fireEvent.change(textarea, { target: { value: 'อบต. จะสร้างฝายน้ำล้น' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(sessionChatController.sendMessage).toHaveBeenCalledWith('อบต. จะสร้างฝายน้ำล้น');
    expect(textarea).toHaveValue('');
  });

  it('Shift+Enter ไม่ส่ง (ขึ้นบรรทัดใหม่)', () => {
    render(<ChatPane />);
    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });

    fireEvent.change(textarea, { target: { value: 'บรรทัดแรก' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(sessionChatController.sendMessage).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter ส่งข้อความเมื่อโฟกัสอยู่ที่ composer (คีย์ลัดของ 06 §4.6)', () => {
    render(<ChatPane />);
    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });

    fireEvent.change(textarea, { target: { value: 'ทดสอบคีย์ลัด' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(sessionChatController.sendMessage).toHaveBeenCalledWith('ทดสอบคีย์ลัด');
  });

  it('กำลังรันอยู่ → composer ปิด และปุ่มส่งกลายเป็นปุ่มหยุดที่เรียก cancel()', () => {
    useChatStore.setState({ isRunning: true });
    render(<ChatPane />);

    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });
    expect(textarea).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: t('chat.stop') }));
    expect(sessionChatController.cancel).toHaveBeenCalledOnce();
  });

  it('กด Esc ระหว่างกำลังรัน → ยกเลิก turn', () => {
    useChatStore.setState({ isRunning: true });
    render(<ChatPane />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(sessionChatController.cancel).toHaveBeenCalledOnce();
  });

  it('กด "/" ตอนไม่ได้โฟกัสช่องพิมพ์ → โฟกัส composer', () => {
    render(<ChatPane />);
    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });
    expect(textarea).not.toHaveFocus();

    fireEvent.keyDown(window, { key: '/' });

    expect(textarea).toHaveFocus();
  });

  it('กด Ctrl/⌘+K → โฟกัส composer (06 §4.6)', () => {
    render(<ChatPane />);
    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });
    expect(textarea).not.toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(textarea).toHaveFocus();
  });

  it('กด ⌘+K (metaKey) ก็ใช้ได้เหมือนกัน', () => {
    render(<ChatPane />);
    const textarea = screen.getByRole('textbox', { name: t('a11y.chatComposer') });

    fireEvent.keyDown(window, { key: 'K', metaKey: true });

    expect(textarea).toHaveFocus();
  });
});

describe('ChatPane — render ข้อความจากโมเดลเป็น text node เท่านั้น (N9/T-307)', () => {
  it('ข้อความที่มีลักษณะคล้าย HTML tag ไม่ถูกแปลงเป็น element จริง', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'done' });
    useChatStore.getState().appendText(id, '<img src=x onerror="window.__pwned=true">');

    render(<ChatPane />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror="window.__pwned=true">')).toBeInTheDocument();
  });
});

describe('ChatPane — tool activity card (06 §7 #25, T-307: web_search ต้องแสดง query ทุกครั้ง)', () => {
  it('แสดง query ของ web_search เสมอ', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'done', text: 'พบราคาจากเว็บแล้ว' });
    useChatStore.getState().upsertToolActivity(id, {
      id: 'ws_1',
      name: 'web_search',
      status: 'done',
      inputSummary: 'เครื่องปรับอากาศ 18000 บีทียู ราคา',
    });

    render(<ChatPane />);

    expect(screen.getByText(/เครื่องปรับอากาศ 18000 บีทียู ราคา/)).toBeInTheDocument();
  });

  it('client tool ที่กำลังทำงาน → แสดงสถานะ running', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    useChatStore.getState().upsertToolActivity(id, { id: 'call_1', name: 'search_catalog', status: 'running' });

    render(<ChatPane />);

    expect(screen.getByText(/กำลังค้นว่ามีรายการคล้าย/)).toBeInTheDocument();
  });

  it('client tool ที่ error → แสดงข้อความ error ด้วยสีแจ้งเตือน', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'done' });
    useChatStore.getState().upsertToolActivity(id, {
      id: 'call_2',
      name: 'search_catalog',
      status: 'error',
      inputSummary: 'search_catalog: เรียกใช้ไม่สำเร็จ',
    });

    render(<ChatPane />);

    expect(screen.getByText('search_catalog: เรียกใช้ไม่สำเร็จ')).toBeInTheDocument();
  });
});

describe('ChatPane — quick replies (06 §4.2)', () => {
  it('แสดงหลังผู้ช่วยตอบจบ และคลิกแล้วส่งข้อความชิปนั้นทันที', async () => {
    useChatStore.getState().addMessage({ role: 'user', text: 'สวัสดี', status: 'done' });
    useChatStore.getState().addMessage({ role: 'assistant', text: 'ขอถามเพิ่ม', status: 'done' });

    render(<ChatPane />);

    const skipButton = await screen.findByRole('button', { name: t('chat.quickReplySkip') });
    fireEvent.click(skipButton);

    expect(sessionChatController.sendMessage).toHaveBeenCalledWith(t('chat.quickReplySkip'));
  });

  it('ไม่แสดงเมื่อยังไม่มีข้อความ (empty state)', () => {
    render(<ChatPane />);
    expect(screen.queryByRole('button', { name: t('chat.quickReplySkip') })).not.toBeInTheDocument();
  });
});

describe('ChatPane — สถานะจบ turn', () => {
  it('status=error พร้อม warning → แสดงข้อความและปุ่มให้ตอบใหม่ที่ส่งข้อความ user ล่าสุดซ้ำ', async () => {
    useChatStore.getState().addMessage({ role: 'user', text: 'คำถามเดิม', status: 'done' });
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'error' });
    useChatStore.getState().addWarning(id, 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุระหว่างเรียก AI: ทดสอบ');

    render(<ChatPane />);

    expect(screen.getByRole('alert')).toHaveTextContent('ทดสอบ');
    fireEvent.click(screen.getByRole('button', { name: t('chat.regenerate') }));

    await waitFor(() => {
      expect(sessionChatController.sendMessage).toHaveBeenCalledWith('คำถามเดิม');
    });
  });

  it('status=cancelled → แสดงข้อความหยุดกลางคัน', () => {
    useChatStore.getState().addMessage({ role: 'assistant', status: 'cancelled' });
    render(<ChatPane />);

    expect(screen.getByText(t('errors.cancelled'))).toBeInTheDocument();
  });
});
