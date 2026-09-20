import type { ReactElement } from 'react';
import { t } from '@/i18n';

export interface EmptyStateProps {
  /** ผู้ใช้คลิกตัวอย่าง → เติมข้อความลง composer เท่านั้น (ยังไม่ส่ง — 06 §4.2) */
  onPickExample: (text: string) => void;
}

/** T-405 — empty state ของแชท: 3 ตัวอย่างโจทย์คลิกได้ (06 §4.2) */
export function EmptyState({ onPickExample }: EmptyStateProps): ReactElement {
  const examples = [
    { title: t('chat.example1Title'), text: t('chat.example1Text') },
    { title: t('chat.example2Title'), text: t('chat.example2Text') },
    { title: t('chat.example3Title'), text: t('chat.example3Text') },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <div>
        <h2 className="text-lg font-semibold text-fg">{t('chat.emptyTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('chat.emptySubtitle')}</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {examples.map((example) => (
          <button
            key={example.title}
            type="button"
            onClick={() => {
              onPickExample(example.text);
            }}
            className="min-h-10 rounded-md border border-line bg-surface p-3 text-left transition duration-fast ease-out hover:-translate-y-0.5 hover:shadow-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <p className="text-sm font-medium text-fg">{example.title}</p>
            <p className="text-xs text-fg-muted">{example.text}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
