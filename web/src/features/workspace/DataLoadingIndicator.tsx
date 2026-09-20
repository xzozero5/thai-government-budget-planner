import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { IconButton } from '@/components/ui';
import { t } from '@/i18n';
import { useDataStore, type DataLoadStatus } from '@/stores/dataStore';

const READY_HIDE_DELAY_MS = 4000;

function overallStatus(statuses: DataLoadStatus[]): DataLoadStatus {
  if (statuses.some((s) => s === 'error')) {
    return 'error';
  }
  if (statuses.some((s) => s === 'loading')) {
    return 'loading';
  }
  if (statuses.length > 0 && statuses.every((s) => s === 'ready')) {
    return 'ready';
  }
  return 'idle';
}

/**
 * T-408 (บางส่วน) — แถบสถานะโหลดข้อมูล (06 §4.6 มุมล่างซ้าย) อ่านจาก `dataStore` เท่านั้น
 *
 * หมายเหตุขอบเขต: ยังไม่มีจุดใดใน repo เรียก `useDataStore.getState().setStatus(...)` จริง (T-408 เต็ม/
 * data layer เป็นคนต่อสาย manifest/duckdb/searchIndex เข้ากับ store นี้) — component นี้จึงแสดงผลถูกต้อง
 * ทันทีที่มีการต่อสายจริง แต่ตอนนี้จะไม่ปรากฏบนจอเพราะสถานะเริ่มต้นเป็น `idle` ทั้งหมด (ตั้งใจ — ไม่บังหน้าจอ
 * เปล่า ๆ ไม่มีความคืบหน้าจริงให้แสดง)
 */
export function DataLoadingIndicator(): ReactElement | null {
  const status = useDataStore((s) => s.status);
  const errors = useDataStore((s) => s.errors);
  const [dismissed, setDismissed] = useState(false);
  const overall = overallStatus(Object.values(status));

  useEffect(() => {
    if (overall !== 'idle') {
      setDismissed(false);
    }
  }, [overall]);

  useEffect(() => {
    if (overall !== 'ready') {
      return;
    }
    const timer = setTimeout(() => {
      setDismissed(true);
    }, READY_HIDE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [overall]);

  if (overall === 'idle' || dismissed) {
    return null;
  }

  const message =
    overall === 'error'
      ? t('data.failed', { reason: Object.values(errors)[0] ?? t('common.unknown') })
      : overall === 'ready'
        ? t('data.ready')
        : t('data.loadingEngine');

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-40 flex max-w-sm items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-2"
    >
      <span className="text-fg">{message}</span>
      <IconButton
        label={t('data.dismiss')}
        variant="ghost"
        onClick={() => {
          setDismissed(true);
        }}
        icon={
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
          </svg>
        }
      />
    </div>
  );
}
