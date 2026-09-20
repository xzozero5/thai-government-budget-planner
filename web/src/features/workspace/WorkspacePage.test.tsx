import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { t } from '@/i18n';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { useSessionStore } from '@/stores/sessionStore';
import { WorkspacePage } from './WorkspacePage';

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

function renderPage(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <WorkspacePage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
  useProposalStore.getState().reset();
  useSessionStore.setState({ theme: 'light', hasKey: true });
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('WorkspacePage — desktop 2-pane (06 §4.2–4.3)', () => {
  it('แสดงทั้งสอง pane พร้อมกันโดย default', () => {
    renderPage();

    expect(screen.getByRole('region', { name: t('workspace.chatPane') })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: t('workspace.proposalPane') })).toBeInTheDocument();
  });

  it('กดย่อบทสนทนา → chat pane หาย, proposal ขยายเต็ม, กดขยายกลับคืนได้', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: t('workspace.collapseChat') }));
    expect(screen.queryByRole('region', { name: t('workspace.chatPane') })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: t('workspace.proposalPane') })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t('workspace.expandChat') }));
    expect(screen.getByRole('region', { name: t('workspace.chatPane') })).toBeInTheDocument();
  });
});

describe('WorkspacePage — header (06 §4.2)', () => {
  it('แสดงชื่อแอป โมเดล และ meter ค่าใช้จ่าย', () => {
    useSessionStore.setState({ spentUsd: 0.12, maxCostUsdPerSession: 3 });
    renderPage();

    expect(screen.getByText(t('common.appName'))).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: t('workspace.costMeterLabel') })).toBeInTheDocument();
  });

  it('ปุ่มสลับธีมตั้งค่า theme ใน sessionStore (App.tsx จะ sync ต่อเป็น data-theme บน <html>)', () => {
    renderPage();
    expect(useSessionStore.getState().theme).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: t('a11y.toggleTheme') }));

    expect(useSessionStore.getState().theme).toBe('dark');
  });

  it('กดล้าง key และออก → ต้องยืนยันก่อน แล้วค่อยล้าง key จริง', () => {
    renderPage();
    expect(useSessionStore.getState().hasKey).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: t('workspace.clearKey') }));
    expect(screen.getByText(t('workspace.clearKeyConfirmBody'))).toBeInTheDocument();
    expect(useSessionStore.getState().hasKey).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: t('workspace.clearKeyConfirmAction') }));
    expect(useSessionStore.getState().hasKey).toBe(false);
  });

  it('เปิดหน้าตั้งค่าได้จากปุ่ม settings', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: t('workspace.settings') }));

    expect(screen.getByRole('heading', { name: t('settings.title') })).toBeInTheDocument();
  });
});

describe('WorkspacePage — มือถือ: Tabs สลับ (06 §3)', () => {
  it('แสดง Tabs แทน 2-pane เมื่อจอแคบกว่า breakpoint', () => {
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMediaMock);

    renderPage();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: t('workspace.chatPane') })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: t('workspace.proposalPane') })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
