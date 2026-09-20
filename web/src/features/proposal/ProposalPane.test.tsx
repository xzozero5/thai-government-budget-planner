import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProposalPaneProps } from './types';
import { realAircondProposal, richProposalFixture } from './__fixtures__/proposal.fixture';
import { ProposalPane } from './ProposalPane';

function baseProps(overrides: Partial<ProposalPaneProps> = {}): ProposalPaneProps {
  return {
    proposal: null,
    warnings: [],
    versions: [],
    currentVersionIndex: 0,
    onSelectVersion: vi.fn(),
    editedLineIds: [],
    onEditLine: vi.fn(),
    onRequestReview: vi.fn(),
    onOpenCitation: vi.fn(),
    onExport: vi.fn(),
    onSave: vi.fn(),
    isAiRunning: false,
    ...overrides,
  };
}

describe('ProposalPane — empty/skeleton', () => {
  it('proposal เป็น null และไม่ได้ AI กำลังทำงาน → empty state', () => {
    render(<ProposalPane {...baseProps()} />);
    expect(screen.getByText('คุยกับผู้ช่วยสักครู่ ข้อเสนอจะโผล่ที่นี่')).toBeInTheDocument();
  });

  it('proposal เป็น null และ isAiRunning=true → skeleton (live region ประกาศสถานะ)', () => {
    render(<ProposalPane {...baseProps({ isAiRunning: true })} />);
    expect(screen.queryByText('คุยกับผู้ช่วยสักครู่ ข้อเสนอจะโผล่ที่นี่')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังประกอบข้อเสนอ…');
  });
});

describe('ProposalPane — proposal จริงจากโมเดล (fixture)', () => {
  it('render หัวข้อ/สรุป และทุก section หลัก', () => {
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal })} />);
    expect(screen.getByText(realAircondProposal.title)).toBeInTheDocument();
    expect(screen.getByText(realAircondProposal.summary)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'วัตถุประสงค์' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ขอบเขตและสเปค' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'รายการค่าใช้จ่าย (BOQ)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'สมมติฐาน' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ความเสี่ยง' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'เทียบเคียงงบในอดีต' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'คำถามที่ยังเปิดอยู่' })).toBeInTheDocument();
  });

  it('จำนวนบรรทัด BOQ ตรงกับ fixture', () => {
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal })} />);
    const label = screen.getByText('จำนวนบรรทัด:', { exact: false });
    expect(label.parentElement).toHaveTextContent(
      `จำนวนบรรทัด: ${String(realAircondProposal.boq.length)}`,
    );
  });

  it('ยอดรวมแสดงด้วยตัวคั่นหลักพันแบบไทย', () => {
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal })} />);
    expect(screen.getByText('1,078,500 บาท')).toBeInTheDocument();
  });

  it('โหมด audit แสดง section ข้อสังเกตจากการตรวจสอบ', () => {
    render(<ProposalPane {...baseProps({ proposal: richProposalFixture })} />);
    expect(screen.getByRole('heading', { name: 'ข้อสังเกตจากการตรวจสอบ' })).toBeInTheDocument();
  });

  it('โหมด draft ไม่แสดง section ข้อสังเกตจากการตรวจสอบ', () => {
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal })} />);
    expect(
      screen.queryByRole('heading', { name: 'ข้อสังเกตจากการตรวจสอบ' }),
    ).not.toBeInTheDocument();
  });

  it('มี citations_web → แสดง section แหล่งจากเว็บพร้อม ExternalLink', () => {
    render(<ProposalPane {...baseProps({ proposal: richProposalFixture })} />);
    const region = screen.getByRole('region', { name: 'แหล่งจากเว็บ' });
    const link = within(region).getByRole('link', { name: /เหล็กเส้น DB12 SD40/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('ไม่มี citations_web → ไม่แสดง section แหล่งจากเว็บ', () => {
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal })} />);
    expect(screen.queryByRole('heading', { name: 'แหล่งจากเว็บ' })).not.toBeInTheDocument();
  });
});

describe('ProposalPane — version selector', () => {
  it('เลือกเวอร์ชันเรียก onSelectVersion ด้วย index ที่ถูกต้อง', async () => {
    const user = userEvent.setup();
    const onSelectVersion = vi.fn();
    render(
      <ProposalPane
        {...baseProps({
          proposal: realAircondProposal,
          versions: [
            { index: 0, label: 'เวอร์ชัน 1', createdAt: '2569-09-01T00:00:00Z', source: 'ai' },
            {
              index: 1,
              label: 'เวอร์ชัน 2',
              createdAt: '2569-09-02T00:00:00Z',
              source: 'user_edit',
            },
          ],
          currentVersionIndex: 1,
          onSelectVersion,
        })}
      />,
    );
    const select = screen.getByLabelText('เวอร์ชัน');
    await user.selectOptions(select, 'เวอร์ชัน 1');
    expect(onSelectVersion).toHaveBeenCalledWith(0);
  });
});

describe('ProposalPane — inline edit ผ่าน BoqTable', () => {
  it('แก้ qty ในตารางเรียก onEditLine ที่ ProposalPane ส่งต่อมา', async () => {
    const user = userEvent.setup();
    const onEditLine = vi.fn();
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal, onEditLine })} />);
    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: /แก้จำนวนของ/ }));
    const input = within(desktop).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '10{Enter}');
    expect(onEditLine).toHaveBeenCalledWith('AC-001', { qty: 10 });
  });
});

describe('ProposalPane — citation callback', () => {
  it('onOpenCitation ถูกเรียกพร้อม citation ที่ถูกต้องเมื่อคลิก chip ใน BOQ', async () => {
    const user = userEvent.setup();
    const onOpenCitation = vi.fn();
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal, onOpenCitation })} />);
    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(
      within(desktop).getByRole('button', { name: /โรงเรียนโสตศึกษาจังหวัดสุรินทร์/ }),
    );
    expect(onOpenCitation).toHaveBeenCalledWith(
      {
        kind: 'budget_line',
        source_id: '69457f86e9f75890',
        note: expect.stringContaining('โรงเรียนโสตศึกษา') as string,
      },
      expect.objectContaining({ id: 'AC-001' }),
    );
  });
});

describe('ProposalPane — warnings จาก validator', () => {
  it('แสดงข้อควรระวังจาก prop warnings และ "ถามผู้ช่วยเรื่องนี้" เรียก onRequestReview()', async () => {
    const user = userEvent.setup();
    const onRequestReview = vi.fn();
    render(
      <ProposalPane
        {...baseProps({
          proposal: realAircondProposal,
          warnings: ['ยอดรวม 17% มาจากประมาณการ'],
          onRequestReview,
        })}
      />,
    );
    expect(screen.getByText('ยอดรวม 17% มาจากประมาณการ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ถามผู้ช่วยเรื่องนี้' }));
    expect(onRequestReview).toHaveBeenCalledWith();
  });

  it('ไม่มี warnings → ไม่แสดงกล่องข้อควรระวัง', () => {
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal, warnings: [] })} />);
    expect(screen.queryByText('ข้อควรระวัง')).not.toBeInTheDocument();
  });
});

describe('ProposalPane — ปุ่ม export/save', () => {
  it('คลิกปุ่มส่งออก/บันทึกเรียก callback ที่ถูกต้อง', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const onSave = vi.fn();
    render(<ProposalPane {...baseProps({ proposal: realAircondProposal, onExport, onSave })} />);
    await user.click(screen.getByRole('button', { name: 'ส่งออก PDF' }));
    await user.click(screen.getByRole('button', { name: 'บันทึกไฟล์' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('ProposalPane — sanitization', () => {
  it('ข้อความจากโมเดลที่มี <script>/<img onerror> render เป็น text node เท่านั้น', () => {
    const malicious = {
      ...realAircondProposal,
      summary: '<img src=x onerror=alert(1)>สรุปปลอม<script>alert(2)</script>',
    };
    const { container } = render(<ProposalPane {...baseProps({ proposal: malicious })} />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(screen.getByText(malicious.summary)).toBeInTheDocument();
  });
});
