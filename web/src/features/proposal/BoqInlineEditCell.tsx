/**
 * T-406 — เซลล์แก้ไข qty/ราคาต่อหน่วยแบบ inline ในตาราง BOQ (06 §4.3)
 * คลิกหรือ Enter (ปุ่มเป็น `<button>` จึงได้ Enter/Space ฟรีจาก browser) เข้าโหมดแก้ → Enter ยืนยัน,
 * Esc/blur ยกเลิก (ไม่ commit ค่าที่พิมพ์ค้างไว้) — validate `> 0` และ `≤ max` ก่อน commit เสมอ
 */
import { useProposalReadOnly } from './readOnlyContext';
import { useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { Input } from '@/components/ui';
import { t } from '@/i18n';
import { isValidLineEditValue } from './recompute';

export interface BoqInlineEditCellProps {
  value: number;
  max: number;
  ariaLabel: string;
  formatValue: (value: number) => string;
  onCommit: (value: number) => void;
  disabled?: boolean;
}

function parseThaiNumber(raw: string): number {
  // input ตัวเลขในตารางนี้ไม่ต้องรองรับ comma ของผู้ใช้ (แสดงผลด้วย comma แต่พิมพ์แก้เป็นเลขดิบ)
  return Number(raw.trim());
}

export function BoqInlineEditCell({
  value,
  max,
  ariaLabel,
  formatValue,
  onCommit,
  disabled: disabledProp = false,
}: BoqInlineEditCellProps): ReactElement {
  const readOnly = useProposalReadOnly();
  const disabled = disabledProp || readOnly;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function beginEdit(): void {
    if (disabled) return;
    setDraft(String(value));
    setError(null);
    setEditing(true);
  }

  function cancel(): void {
    setEditing(false);
    setError(null);
  }

  function commit(): void {
    const parsed = parseThaiNumber(draft);
    if (!isValidLineEditValue(parsed, max)) {
      setError(t('proposal.boq.invalidNumber'));
      return;
    }
    setEditing(false);
    setError(null);
    if (parsed !== value) {
      onCommit(parsed);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  if (editing) {
    return (
      <div className="min-w-24">
        <Input
          aria-label={ariaLabel}
          autoFocus
          inputMode="decimal"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onBlur={cancel}
          {...(error !== null ? { error } : {})}
          className="w-24 text-right tabular-nums"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={beginEdit}
      className="w-full rounded-sm px-1 py-0.5 text-right tabular-nums hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {formatValue(value)}
    </button>
  );
}
