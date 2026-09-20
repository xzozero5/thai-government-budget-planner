/**
 * T-406 — แหล่งจากเว็บระดับข้อเสนอ (05 §5 `citations_web[]`) — ใช้ `ExternalLink` เสมอ (N5/T-307:
 * https-only, เปิดแท็บใหม่ noopener noreferrer, ไม่ prefetch)
 *
 * [MISSING COPY KEY] ไม่มี key หัวข้อ section นี้ใน `proposal.sections.*` (`webCitations`) — ใช้
 * `citation.web.title` ("แหล่งจากเว็บ") แทนเพราะความหมายตรงกัน
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
