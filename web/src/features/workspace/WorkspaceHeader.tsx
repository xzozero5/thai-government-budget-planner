import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, IconButton, Meter } from '@/components/ui';
import { getModelCapability } from '@/ai/models';
import { sessionChatController } from '@/ai/session/chatController';
import { t } from '@/i18n';
import { formatUsd } from '@/lib/format';
import { useSessionStore } from '@/stores/sessionStore';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { markManualClear } from './manualClearFlag';
import { SettingsDialog } from '@/features/settings';

/** T-405 — header ส่วนกลางของ workspace (06 §4.2): app name, model chip, cost meter, settings, theme,
 * ลิงก์ about, ปุ่มล้าง key & ออก */
export function WorkspaceHeader(): ReactElement {
  const model = useSessionStore((s) => s.model);
  const spentUsd = useSessionStore((s) => s.spentUsd);
  const maxCostUsdPerSession = useSessionStore((s) => s.maxCostUsdPerSession);
  const theme = useSessionStore((s) => s.theme);
  const setTheme = useSessionStore((s) => s.setTheme);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // 06 §4.6: `?` เปิดแผ่นคีย์ลัด (นอกช่องพิมพ์เท่านั้น — เช็คแบบเดียวกับ `ChatPane` ที่กัน `/`)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      const isEditable =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '?' && !isEditable) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  function handleConfirmClear(): void {
    markManualClear();
    sessionChatController.reset();
    useSessionStore.getState().clearKey('manual');
    setConfirmOpen(false);
  }

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
      <span className="font-semibold text-fg">{t('common.appName')}</span>
      <span className="rounded-sm bg-surface-2 px-2 py-1 text-xs text-fg-muted">
        {t('workspace.modelChip', { model: getModelCapability(model).labelTh })}
      </span>

      <div className="min-w-[160px] flex-1">
        <Meter
          value={spentUsd}
          max={maxCostUsdPerSession}
          label={t('workspace.costMeterLabel')}
          valueText={t('workspace.costMeterValue', {
            used: formatUsd(spentUsd, { fractionDigits: 2 }),
            limit: formatUsd(maxCostUsdPerSession, { fractionDigits: 2 }),
          })}
        />
      </div>

      <IconButton
        label={t('workspace.settings')}
        variant="ghost"
        onClick={() => {
          setSettingsOpen(true);
        }}
        icon={<span aria-hidden="true">⚙</span>}
      />
      <IconButton
        label={t('a11y.toggleTheme')}
        variant="ghost"
        onClick={() => {
          setTheme(theme === 'dark' ? 'light' : 'dark');
        }}
        icon={<span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>}
      />
      <IconButton
        label={t('a11y.keyboardShortcuts')}
        variant="ghost"
        onClick={() => {
          setShortcutsOpen(true);
        }}
        icon={<span aria-hidden="true">?</span>}
      />
      <Link
        to="/about"
        className="rounded-sm px-2 py-1 text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t('workspace.about')}
      </Link>
      <Button
        variant="danger"
        size="sm"
        onClick={() => {
          setConfirmOpen(true);
        }}
      >
        {t('workspace.clearKey')}
      </Button>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
        }}
      />

      <Dialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
        }}
        title={t('workspace.clearKeyConfirmTitle')}
      >
        <p className="text-sm text-fg">{t('workspace.clearKeyConfirmBody')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmOpen(false);
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={handleConfirmClear}>
            {t('workspace.clearKeyConfirmAction')}
          </Button>
        </div>
      </Dialog>
    </header>
  );
}
