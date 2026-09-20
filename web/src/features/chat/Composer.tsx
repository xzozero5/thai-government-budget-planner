import { forwardRef } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import { Button, Textarea } from '@/components/ui';
import { t } from '@/i18n';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  isRunning: boolean;
  placeholder: string;
}

/** T-405 — composer (06 §4.2): autosize, Enter ส่ง / Shift+Enter ขึ้นบรรทัด, ปิดระหว่างรัน, ปุ่มหยุด */
export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { value, onChange, onSend, onCancel, isRunning, placeholder },
  ref,
): ReactElement {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // IME (ภาษาไทย/ญี่ปุ่น ฯลฯ) ต้องไม่ส่งขณะกำลังประกอบตัวอักษร (06 §7 #4)
    if (event.nativeEvent.isComposing) {
      return;
    }
    // เฉพาะ Enter ธรรมดา (ไม่กด Shift/Ctrl/Cmd) — Shift+Enter ปล่อยให้ textarea ขึ้นบรรทัดใหม่ตามปกติ;
    // Ctrl/Cmd+Enter เป็นคีย์ลัด "ส่ง" ระดับ global จัดการที่ `ChatPane` (กันเรียก `onSend` ซ้ำสองครั้ง
    // จากทั้ง handler นี้และ window listener ของ ChatPane)
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    if (!isRunning && value.trim().length > 0) {
      onSend();
    }
  }

  return (
    <div className="flex flex-col gap-1 border-t border-line p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Textarea
            ref={ref}
            aria-label={t('a11y.chatComposer')}
            value={value}
            placeholder={placeholder}
            disabled={isRunning}
            maxHeightPx={240}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              onChange(event.target.value);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        {isRunning ? (
          <Button variant="danger" onClick={onCancel}>
            {t('chat.stop')}
          </Button>
        ) : (
          <Button variant="primary" onClick={onSend} disabled={value.trim().length === 0}>
            {t('chat.send')}
          </Button>
        )}
      </div>
      <p className="text-xs text-fg-muted">{t('chat.sendHint')}</p>
    </div>
  );
});
