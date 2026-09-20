/**
 * T-406 — ข้อควรระวังจาก validator (`validateAndNormalizeProposal`) — 06 §4.3: "warnings จาก
 * validator (Accordion, เด่นพอ)" คนละกลุ่มกับ `proposal.audit_findings` (ซึ่งเป็นเนื้อหาของโมเดลเอง)
 * ข้อความเหล่านี้เป็นข้อความไทยที่ validator ประกอบไว้แล้ว — render เป็น text node ตรง ๆ (ไม่ parse)
 *
 * "ถามผู้ช่วยเรื่องนี้" ใช้ `onRequestReview()` แบบไม่ระบุ `lineId` (ทบทวนภาพรวม); "รับทราบ" เป็น
 * local UI state ล้วน ๆ (ไม่มี prop สำหรับ dismiss แบบ persist ใน scope ของ T-406)
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
// import ไฟล์ตรง (ไม่ผ่าน barrel `@/components/motion`) — เหตุผลเดียวกับ `components/ui/Accordion.tsx`
import { Collapse } from '@/components/motion/Collapse';
import { Button, Card } from '@/components/ui';
import { t } from '@/i18n';

export interface WarningsPanelProps {
  warnings: readonly string[];
  onRequestReview: (lineId?: string) => void;
}

export function WarningsPanel({
  warnings,
  onRequestReview,
}: WarningsPanelProps): ReactElement | null {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const visible = warnings
    .map((text, index) => ({ text, index }))
    .filter((w) => !dismissed.has(w.index));

  if (visible.length === 0) {
    return null;
  }

  return (
    // motion.md #24 (accordion/แผงเตือน): fade+ขยายเข้าตอนโผล่ (entrance เท่านั้น — ปิดทีละรายการด้วย
    // "รับทราบ" ยังคง unmount รายการนั้นทันทีตาม local state ด้านบน ไม่กระทบ)
    <Collapse>
      <Card className="border-warn bg-surface-2">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <span aria-hidden="true">!</span>
          {t('proposal.warnings.title')}
        </h3>
        <ul className="space-y-3">
          {visible.map(({ text, index }) => (
            <li key={index} className="text-sm text-fg">
              <p>{text}</p>
              <div className="mt-1.5 flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onRequestReview();
                  }}
                >
                  {t('proposal.warnings.askAi')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDismissed((prev) => new Set(prev).add(index));
                  }}
                >
                  {t('proposal.warnings.dismiss')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Collapse>
  );
}
