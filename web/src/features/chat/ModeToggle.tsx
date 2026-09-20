import type { ReactElement } from 'react';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';

const MODES = ['draft', 'audit'] as const;

/** T-405 — สลับโหมด ร่างโครงการ/ตรวจสอบ (06 §4.2 composer) */
export function ModeToggle(): ReactElement {
  const mode = useSessionStore((s) => s.mode);
  const setMode = useSessionStore((s) => s.setMode);

  return (
    <div role="group" aria-label={t('chat.modeLabel')} className="flex gap-1 border-t border-line px-4 pt-2">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          title={m === 'draft' ? t('chat.modeDraftHint') : t('chat.modeAuditHint')}
          onClick={() => {
            setMode(m);
          }}
          className={`min-h-8 rounded-sm px-3 text-sm font-medium transition duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
            mode === m ? 'bg-primary text-primary-contrast' : 'bg-surface-2 text-fg-muted hover:text-fg'
          }`}
        >
          {m === 'draft' ? t('chat.modeDraft') : t('chat.modeAudit')}
        </button>
      ))}
    </div>
  );
}
