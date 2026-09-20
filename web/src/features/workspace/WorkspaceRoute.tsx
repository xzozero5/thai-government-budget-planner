import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useToast } from '@/components/ui';
import { t } from '@/i18n';
import { prefetchWhenIdle } from '@/lib/chunkLoad';
import { useSessionStore } from '@/stores/sessionStore';
import { consumeManualClear } from './manualClearFlag';
import { WorkspacePage } from './WorkspacePage';

/**
 * T-405 — guard ของ `/workspace` (06 §3): ไม่มี key → redirect `/`; เมื่อ key ถูกล้างระหว่างใช้งาน
 * (idle/pagehide ผ่าน `keyHolder.onClear` ที่ `sessionStore` sync ให้อัตโนมัติอยู่แล้ว) → toast + redirect
 * เช่นกัน แต่ไม่ซ้ำ toast ถ้าเป็นการล้างที่ผู้ใช้กดเอง (ปุ่มนั้นมีข้อความยืนยันของตัวเองแล้ว — ดู
 * `manualClearFlag.ts`)
 */
export function WorkspaceRoute(): ReactElement {
  const hasKey = useSessionStore((s) => s.hasKey);
  const { push } = useToast();
  const wasKeyRef = useRef(hasKey);

  useEffect(() => {
    if (wasKeyRef.current && !hasKey && !consumeManualClear()) {
      push({ title: t('toast.keyIdleCleared'), variant: 'warn', durationMs: 0 });
    }
    wasKeyRef.current = hasKey;
  }, [hasKey, push]);

  // กันแท็บที่เปิดค้างข้าม deploy (ดู `lib/chunkLoad.ts`): กราฟแนวโน้ม + ตัวแปลงภาพของ PDF เป็น lazy chunk ที่จะถูกเรียก
  // ทีหลังในบทสนทนา (ตัวสร้าง PDF ก้อนใหญ่ถูก prefetch แยกใน `ExportDialog` เมื่อมีข้อเสนอแล้ว)
  useEffect(() => {
    if (!hasKey) return undefined;
    return prefetchWhenIdle([
      () => import('@/components/viz/TrendChart'),
      () => import('@/features/export/pdf/svgToPng'),
    ]);
  }, [hasKey]);

  if (!hasKey) {
    return <Navigate to="/" replace />;
  }
  return <WorkspacePage />;
}
