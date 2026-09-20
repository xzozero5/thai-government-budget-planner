import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { richProposalFixture } from './__fixtures__/proposal.fixture';
import { buildSummaryMarkdown } from './summaryMarkdown';

describe('buildSummaryMarkdown (S14, po-review ชุด B)', () => {
  it('มีชื่อโครงการเป็นหัวข้อ H1', () => {
    const md = buildSummaryMarkdown(richProposalFixture);
    expect(md).toContain(`# ${richProposalFixture.title}`);
  });

  it('มีสรุปโครงการ', () => {
    const md = buildSummaryMarkdown(richProposalFixture);
    expect(md).toContain(richProposalFixture.summary);
  });

  it('มียอดรวมแบบ th-TH', () => {
    const md = buildSummaryMarkdown(richProposalFixture);
    expect(md).toContain('408,796.5 บาท');
  });

  it('มีตาราง BOQ ย่อ พร้อมป้ายที่มาทุกบรรทัด (N3: บรรทัด estimate ต้องเห็นคำว่าประมาณการ)', () => {
    const md = buildSummaryMarkdown(richProposalFixture);
    expect(md).toContain('| คอนกรีตผสมเสร็จ 240 ksc |');
    expect(md).toContain(t('proposal.basis.historical'));
    expect(md).toContain(t('proposal.basis.market'));
    expect(md).toContain(t('proposal.basis.estimate'));
  });

  it('ไม่มี BOQ เลย → ไม่มี section ตาราง BOQ', () => {
    const md = buildSummaryMarkdown({ ...richProposalFixture, boq: [] });
    expect(md).not.toContain(t('proposal.sections.boq'));
  });
});
