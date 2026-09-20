import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import * as keyHolder from '@/ai/session/keyHolder';
import { t } from '@/i18n';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { useSessionStore } from '@/stores/sessionStore';
import { markManualClear } from './manualClearFlag';
import { WorkspaceRoute } from './WorkspaceRoute';

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

function renderWorkspaceRoute(): void {
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <ToastProvider>
        <Routes>
          <Route path="/workspace" element={<WorkspaceRoute />} />
          <Route path="/" element={<div>KEYGATE_STUB</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
  useProposalStore.getState().reset();
});

afterEach(() => {
  keyHolder.clearKey('manual');
});

describe('WorkspaceRoute — guard (06 §3)', () => {
  it('ไม่มี key → redirect ไปหน้า KeyGate ("/") ทันที', () => {
    useSessionStore.setState({ hasKey: false });
    renderWorkspaceRoute();

    expect(screen.getByText('KEYGATE_STUB')).toBeInTheDocument();
  });

  it('มี key → แสดง WorkspacePage', () => {
    useSessionStore.setState({ hasKey: true });
    renderWorkspaceRoute();

    expect(screen.queryByText('KEYGATE_STUB')).not.toBeInTheDocument();
    expect(screen.getByText(t('common.appName'))).toBeInTheDocument();
  });
});

describe('WorkspaceRoute — onClear (idle/pagehide) redirect + toast', () => {
  it('key ถูกล้างระหว่างใช้งาน (ไม่ใช่ปุ่มล้างเอง) → toast แจ้งเตือน + redirect', async () => {
    useSessionStore.setState({ hasKey: true });
    renderWorkspaceRoute();
    expect(screen.getByText(t('common.appName'))).toBeInTheDocument();

    keyHolder.clearKey('idle');

    await waitFor(() => {
      expect(screen.getByText('KEYGATE_STUB')).toBeInTheDocument();
    });
    expect(screen.getByText(t('toast.keyIdleCleared'))).toBeInTheDocument();
  });

  it('markManualClear() ก่อนล้าง → redirect โดยไม่โผล่ toast idle-cleared ซ้ำ', async () => {
    useSessionStore.setState({ hasKey: true });
    renderWorkspaceRoute();

    markManualClear();
    keyHolder.clearKey('manual');

    await waitFor(() => {
      expect(screen.getByText('KEYGATE_STUB')).toBeInTheDocument();
    });
    expect(screen.queryByText(t('toast.keyIdleCleared'))).not.toBeInTheDocument();
  });
});
