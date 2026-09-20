/**
 * T-408 (06 §4.6) — แผ่น "คีย์ลัด" เปิดด้วยปุ่ม `?` (นอกช่องพิมพ์) หรือคลิกปุ่มใน `WorkspaceHeader`
 * ใช้ copy ที่ ui-designer เตรียมไว้แล้วใน `copy.th.json` (`a11y.keyboardShortcuts`/`shortcutFocusComposer`/
 * `shortcutCloseDrawer`) — ยังไม่มีใครใช้มาก่อน (T-408 เดิมค้างส่วนนี้)
 */
import type { ReactElement } from 'react';
import { Dialog } from '@/components/ui';
import { t } from '@/i18n';

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_KEYS = [
  { key: 'Ctrl / ⌘ + K', descriptionKey: 'a11y.shortcutFocusComposer' },
  { key: '/', descriptionKey: 'a11y.shortcutFocusComposer' },
  { key: 'Esc', descriptionKey: 'a11y.shortcutCloseDrawer' },
  { key: '?', descriptionKey: 'a11y.keyboardShortcuts' },
] as const;

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps): ReactElement {
  return (
    <Dialog open={open} onClose={onClose} title={t('a11y.keyboardShortcuts')}>
      <dl className="space-y-3 text-sm text-fg">
        {SHORTCUT_KEYS.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-4">
            <dt>
              <kbd className="rounded-sm border border-line bg-surface-2 px-2 py-1 font-mono text-xs">
                {row.key}
              </kbd>
            </dt>
            <dd className="flex-1 text-right text-fg-muted">{t(row.descriptionKey)}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
