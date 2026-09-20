/**
 * T-406/T-410 (po-review ชุด B) — แหล่งจากเว็บระดับข้อเสนอ (05 §5 `citations_web[]`) — ใช้
 * `ExternalLink` เสมอ (N5/T-307: https-only, เปิดแท็บใหม่ noopener noreferrer, ไม่ prefetch)
 *
 * หมายเหตุ: หัวข้อ accordion ของ section นี้ใน `ProposalPane.tsx` ยังใช้ `citation.web.title`
 * ("แหล่งจากเว็บ") ไม่ใช่ `proposal.sections.webCitations` ("แหล่งอ้างอิงจากเว็บ") ที่เพิ่มมาใน copy.th.json
 * ชุด A ทั้งที่ความหมายตรงกัน — ตั้งใจไม่สลับ เพราะเป็น**ข้อความที่มองเห็นได้จริง** (accessible name ของ
 * `role="region"`) ซึ่งงานนี้ (ชุด B) ถูกห้ามเปลี่ยนข้อความที่มีอยู่แล้วโดยเด็ดขาด (มี e2e ของ qa-engineer
 * รันขนานอยู่ + `ProposalPane.test.tsx` เดิมอ้างชื่อนี้ตรง ๆ) รายงานเป็น key ที่ยังไม่ถูกใช้จริงท้ายงาน
 */
import type { ReactElement } from 'react';
import { ExternalLink } from '@/components/ui';
import { t } from '@/i18n';
import type { WebCitation } from '../types';

export interface WebCitationsSectionProps {
  citations: readonly WebCitation[];
}

export function WebCitationsSection({ citations }: WebCitationsSectionProps): ReactElement {
  if (citations.length === 0) {
    return <p className="text-sm text-fg-muted">{t('proposal.sections.empty')}</p>;
  }
  return (
    <ul className="space-y-2">
      {citations.map((citation, index) => (
        <li key={`${String(index)}-${citation.url}`} className="text-sm text-fg">
          <ExternalLink href={citation.url}>{citation.title ?? citation.url}</ExternalLink>
          {citation.price_note !== undefined && (
            <p className="mt-0.5 text-xs text-fg-muted">
              {t('citation.web.priceNote')}: {citation.price_note}
            </p>
          )}
          <p className="text-xs text-fg-muted">
            {t('citation.retrievedAt', { date: citation.retrieved_at })}
          </p>
        </li>
      ))}
    </ul>
  );
}
