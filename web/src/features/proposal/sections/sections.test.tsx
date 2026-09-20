import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssumptionsSection } from './AssumptionsSection';
import { AuditFindingsSection } from './AuditFindingsSection';
import { ComparablesSection } from './ComparablesSection';
import { ListSection } from './ListSection';
import { RisksSection } from './RisksSection';
import { ScopeSection } from './ScopeSection';
import { WarningsPanel } from './WarningsPanel';
import { WebCitationsSection } from './WebCitationsSection';

describe('ListSection', () => {
  it('render รายการทั้งหมดเป็นข้อความ', () => {
    render(<ListSection items={['ข้อ A', 'ข้อ B']} />);
    expect(screen.getByText('ข้อ A')).toBeInTheDocument();
    expect(screen.getByText('ข้อ B')).toBeInTheDocument();
  });

  it('ไม่มีรายการ → แสดงข้อความ empty', () => {
    render(<ListSection items={[]} />);
    expect(screen.getByText('ส่วนนี้ยังไม่มีเนื้อหา')).toBeInTheDocument();
  });
});

describe('ScopeSection', () => {
  it('render หัวข้อย่อยและ items', () => {
    render(
      <ScopeSection
        sections={[{ section: 'งานโครงสร้าง', items: ['คอนกรีต 240 ksc', 'เหล็ก DB12'] }]}
      />,
    );
    expect(screen.getByText('งานโครงสร้าง')).toBeInTheDocument();
    expect(screen.getByText('คอนกรีต 240 ksc')).toBeInTheDocument();
  });
});

describe('AssumptionsSection', () => {
  it('แสดง impact badge ทุกระดับ', () => {
    render(
      <AssumptionsSection
        assumptions={[
          { text: 'สมมติฐาน 1', impact: 'high' },
          { text: 'สมมติฐาน 2', impact: 'medium' },
          { text: 'สมมติฐาน 3', impact: 'low' },
        ]}
      />,
    );
    expect(screen.getByText('ผลกระทบสูง')).toBeInTheDocument();
    expect(screen.getByText('ผลกระทบปานกลาง')).toBeInTheDocument();
    expect(screen.getByText('ผลกระทบต่ำ')).toBeInTheDocument();
  });
});

describe('RisksSection', () => {
  it('แสดง mitigation เมื่อมี และไม่แสดงเมื่อไม่มี', () => {
    render(
      <RisksSection
        risks={[{ text: 'ความเสี่ยง A', mitigation: 'แนวทาง A' }, { text: 'ความเสี่ยง B' }]}
      />,
    );
    expect(screen.getByText('แนวทาง A', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('ความเสี่ยง B')).toBeInTheDocument();
  });
});

describe('ComparablesSection', () => {
  it('render ตารางเทียบเคียงพร้อมปีงบประมาณ พ.ศ. และยอดเงินแบบไทย', () => {
    render(
      <ComparablesSection
        comparables={[
          {
            source_id: 'src-1',
            fiscal_year_be: 2568,
            agency: 'กรมชลประทาน',
            item_name: 'คอนกรีต 240 ksc',
            amount_thb: 199750,
            unit_price_thb: 2350,
            similarity_note: 'สเปคตรงกัน',
          },
        ]}
      />,
    );
    expect(screen.getByText('พ.ศ. 2568')).toBeInTheDocument();
    expect(screen.getByText('กรมชลประทาน')).toBeInTheDocument();
    expect(screen.getByText('฿199,750')).toBeInTheDocument();
  });

  it('ไม่มีข้อมูล → empty text', () => {
    render(<ComparablesSection comparables={[]} />);
    expect(screen.getByText('ส่วนนี้ยังไม่มีเนื้อหา')).toBeInTheDocument();
  });
});

describe('AuditFindingsSection', () => {
  it('render severity ทุกระดับและเรียก onOpenCitation เมื่อคลิก chip', async () => {
    const user = userEvent.setup();
    const onOpenCitation = vi.fn();
    render(
      <AuditFindingsSection
        onOpenCitation={onOpenCitation}
        findings={[
          { text: 'ข้อสังเกต 1', severity: 'info', citations: [] },
          {
            text: 'ข้อสังเกต 2',
            severity: 'high',
            citations: [{ kind: 'budget_line', source_id: 'bl-1' }],
          },
        ]}
      />,
    );
    expect(screen.getByText('ข้อสังเกต')).toBeInTheDocument();
    expect(screen.getByText('ความเสี่ยงสูง')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /bl-1/ }));
    expect(onOpenCitation).toHaveBeenCalledWith({ kind: 'budget_line', source_id: 'bl-1' });
  });
});

describe('WebCitationsSection', () => {
  it('render ExternalLink https-only เปิดแท็บใหม่', () => {
    render(
      <WebCitationsSection
        citations={[
          {
            url: 'https://example.com/a',
            title: 'ตัวอย่างสินค้า',
            retrieved_at: '2569-09-01',
            price_note: 'ราคาส่ง',
          },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: /ตัวอย่างสินค้า/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('URL ที่ไม่ใช่ https ไม่ render เป็นลิงก์', () => {
    render(
      <WebCitationsSection
        citations={[{ url: 'http://insecure.example/a', retrieved_at: '2569-09-01' }]}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('WarningsPanel', () => {
  it('ไม่มี warnings → ไม่ render อะไร', () => {
    const { container } = render(<WarningsPanel warnings={[]} onRequestReview={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('"ถามผู้ช่วยเรื่องนี้" เรียก onRequestReview() แบบไม่มี lineId', async () => {
    const user = userEvent.setup();
    const onRequestReview = vi.fn();
    render(<WarningsPanel warnings={['คำเตือน A']} onRequestReview={onRequestReview} />);
    await user.click(screen.getByRole('button', { name: 'ถามผู้ช่วยเรื่องนี้' }));
    expect(onRequestReview).toHaveBeenCalledWith();
  });

  it('"รับทราบ" ซ่อนคำเตือนนั้นออกจากหน้าจอ (local UI state)', async () => {
    const user = userEvent.setup();
    render(<WarningsPanel warnings={['คำเตือน A', 'คำเตือน B']} onRequestReview={vi.fn()} />);
    const [dismissA] = screen.getAllByRole('button', { name: 'รับทราบ' });
    if (!dismissA) throw new Error('ไม่พบปุ่มรับทราบ');
    await user.click(dismissA);
    expect(screen.queryByText('คำเตือน A')).not.toBeInTheDocument();
    expect(screen.getByText('คำเตือน B')).toBeInTheDocument();
  });
});
