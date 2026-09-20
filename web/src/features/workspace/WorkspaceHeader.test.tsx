import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';
import { WorkspaceHeader } from './WorkspaceHeader';

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

function renderHeader(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <WorkspaceHeader />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSessionStore.setState({
    theme: 'light',
    spentUsd: 0,
    maxCostUsdPerSession: 3,
    budgetWarningShown: false,
    budgetWarningAt: null,
  });
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('WorkspaceHeader — M3 (po-review): เตือนงบ 80%', () => {
  it('budgetWarningAt เปลี่ยนจาก null เป็น timestamp → แสดง toast เตือนงบครั้งเดียว', () => {
    renderHeader();
    expect(screen.queryByText(t('toast.budgetWarning', { percent: 80 }))).not.toBeInTheDocument();

    act(() => {
      useSessionStore.setState({ spentUsd: 2.4, budgetWarningAt: Date.now() });
    });

    expect(screen.getByText(t('toast.budgetWarning', { percent: 80 }))).toBeInTheDocument();
  });

  it('budgetWarningAt เดิม re-render ซ้ำ → ไม่เด้ง toast ซ้ำสอง', () => {
    const at = Date.now();
    useSessionStore.setState({ spentUsd: 2.4, budgetWarningAt: at });
    renderHeader();

    act(() => {
      // ค่าเดิมเป๊ะ (re-render จากเหตุอื่น) — ต้องไม่ถือเป็นเหตุการณ์ใหม่
      useSessionStore.setState({ budgetWarningAt: at });
    });

    expect(screen.getAllByText(t('toast.budgetWarning', { percent: 80 })).length).toBe(1);
  });

  it('costMeterTooltip ผูกกับ meter ค่าใช้จ่าย', () => {
    renderHeader();
    expect(screen.getByText(t('workspace.costMeterTooltip'))).toBeInTheDocument();
  });
});
