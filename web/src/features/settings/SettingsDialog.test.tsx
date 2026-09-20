import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT, DEFAULT_MODEL_ID } from '@/ai/models';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';
import { SettingsDialog } from './SettingsDialog';

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
  useSessionStore.setState({
    model: DEFAULT_MODEL_ID,
    effort: DEFAULT_EFFORT,
    enableWebSearch: true,
    maxCostUsdPerTurn: 0.5,
    maxCostUsdPerSession: 3,
    spentUsd: 0.42,
    hasKey: true,
  });
});

describe('SettingsDialog (06 §4.6)', () => {
  it('แสดง effort เมื่อโมเดลรองรับ และซ่อนเมื่อเปลี่ยนไปโมเดลที่ไม่รองรับ (Haiku 4.5)', () => {
    render(<SettingsDialog open onClose={() => undefined} />);
    expect(screen.getByLabelText(t('settings.effortLabel'))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t('settings.modelLabel')), {
      target: { value: 'claude-haiku-4-5-20251001' },
    });

    expect(useSessionStore.getState().model).toBe('claude-haiku-4-5-20251001');
    expect(screen.queryByLabelText(t('settings.effortLabel'))).not.toBeInTheDocument();
  });

  it('เปิด/ปิด web search อัปเดต sessionStore และแสดงข้อความเตือนเมื่อปิด', () => {
    render(<SettingsDialog open onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('switch', { name: t('settings.webSearchLabel') }));

    expect(useSessionStore.getState().enableWebSearch).toBe(false);
    expect(screen.getByText(t('settings.webSearchOffNotice'))).toBeInTheDocument();
  });

  it('ใส่เพดานต่อคำถามเป็น 0 → error และไม่บันทึกค่า', () => {
    render(<SettingsDialog open onClose={() => undefined} />);
    const input = screen.getByLabelText(t('settings.budgetTurnLabel'));

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(screen.getByText(t('settings.budgetInvalid'))).toBeInTheDocument();
    expect(useSessionStore.getState().maxCostUsdPerTurn).toBe(0.5);
  });

  it('ใส่เพดานต่อ session เกิน 20 → error และไม่บันทึกค่า', () => {
    render(<SettingsDialog open onClose={() => undefined} />);
    const input = screen.getByLabelText(t('settings.budgetSessionLabel'));

    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.blur(input);

    expect(screen.getByText(t('settings.budgetInvalid'))).toBeInTheDocument();
    expect(useSessionStore.getState().maxCostUsdPerSession).toBe(3);
  });

  it('ใส่ค่าที่ถูกต้อง (ระหว่าง 0 กับ 20) → บันทึกค่าใหม่', () => {
    render(<SettingsDialog open onClose={() => undefined} />);
    const input = screen.getByLabelText(t('settings.budgetTurnLabel'));

    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.blur(input);

    expect(screen.queryByText(t('settings.budgetInvalid'))).not.toBeInTheDocument();
    expect(useSessionStore.getState().maxCostUsdPerTurn).toBe(1.5);
  });

  it('แสดงยอดใช้สะสมด้วย formatUsd', () => {
    render(<SettingsDialog open onClose={() => undefined} />);
    expect(screen.getByText(t('settings.usageValue', { amount: '$0.42' }))).toBeInTheDocument();
  });
});
