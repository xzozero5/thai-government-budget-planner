import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';

describe('KeyboardShortcutsDialog (06 §4.6)', () => {
  it('open=false ไม่ render อะไร', () => {
    render(<KeyboardShortcutsDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('open=true แสดงหัวข้อและรายการคีย์ลัดจาก copy.th.json (ไม่ hard-code ข้อความ)', () => {
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: t('a11y.keyboardShortcuts') })).toBeInTheDocument();
    expect(screen.getAllByText(t('a11y.shortcutFocusComposer')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('a11y.shortcutCloseDrawer'))).toBeInTheDocument();
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });
});
