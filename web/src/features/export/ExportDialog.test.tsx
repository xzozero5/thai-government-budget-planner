import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import { t } from '@/i18n';
import { useProposalStore } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { ExportDialog } from './ExportDialog';

// `vi.hoisted` + plain `vi.fn()` (ไม่ผูก type ของ `DataFacade`/module จริง) กัน
// `@typescript-eslint/unbound-method` เวลาอ้างเมธอดแยกจาก object เจ้าของ — ตามรูปแบบเดียวกับ
// `features/workspace/slots.test.tsx` (ดูคอมเมนต์ในไฟล์นั้น)
const dataVersionMock = vi.hoisted(() => vi.fn().mockResolvedValue('2026-09-01'));
const downloadBlobMock = vi.hoisted(() => vi.fn());
const renderProposalPdfMock = vi.hoisted(() => vi.fn());
const buildPdfFileNameMock = vi.hoisted(() =>
  vi.fn().mockReturnValue('ข้อเสนอโครงการ (ปีงบประมาณ 2569).pdf'),
);

vi.mock('@/data', () => ({ data: { dataVersion: dataVersionMock } }));
vi.mock('./downloadBlob', () => ({ downloadBlob: downloadBlobMock }));
vi.mock('./pdf/renderProposalPdf', () => ({
  renderProposalPdf: renderProposalPdfMock,
  buildPdfFileName: buildPdfFileNameMock,
}));

function makeLine(overrides: Partial<BoqLine> = {}): BoqLine {
  return {
    id: 'line1',
    category: 'ครุภัณฑ์',
    item: 'เครื่องปรับอากาศ',
    qty: 1,
    unit: 'เครื่อง',
    unit_price_thb: 20000,
    total_thb: 20000,
    basis: 'historical',
    confidence: 'high',
    rationale: 'อ้างอิงราคาจากงบปี 2567',
    citations: [{ kind: 'budget_line', source_id: 'src_1' }],
    ...overrides,
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    version: 1,
    title: 'โครงการทดสอบส่งออก',
    summary: 'สรุปทดสอบ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2569 },
    objectives: [],
    scope_and_specs: [],
    assumptions: [],
    boq: [makeLine()],
    totals: { subtotal_thb: 20000, vat_included: false, grand_total_thb: 20000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

function pushLiveProposal(overrides: Partial<Proposal> = {}, warnings: string[] = []): void {
  useProposalStore.getState().pushVersion(makeProposal(overrides), warnings, 'ai');
}

describe('ExportDialog', () => {
  beforeEach(() => {
    useProposalStore.getState().reset();
    useToolLogStore.getState().reset();
    dataVersionMock.mockClear();
    downloadBlobMock.mockClear();
    renderProposalPdfMock.mockReset();
    buildPdfFileNameMock.mockClear();
  });

  it('ไม่มี proposal เลย (จาก store หรือ source) → ไม่มีปุ่มดาวน์โหลด', () => {
    render(<ExportDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('export.download') })).not.toBeInTheDocument();
  });

  it('ส่งออกสำเร็จ: เรียก dynamic import ของ renderProposalPdf แล้วดาวน์โหลด + แสดงชื่อไฟล์', async () => {
    pushLiveProposal();
    renderProposalPdfMock.mockResolvedValue(new Blob(['%PDF-fake']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText(t('export.done', { filename: 'ข้อเสนอโครงการ (ปีงบประมาณ 2569).pdf' })),
    ).toBeInTheDocument();

    const input = renderProposalPdfMock.mock.calls[0]?.[0] as { warnings: string[] };
    expect(input.warnings).toEqual([]);
  });

  it('sections.warnings ปิด → ไม่ส่ง warnings ของจริงเข้า renderProposalPdf', async () => {
    pushLiveProposal({}, ['คำเตือนจาก validator']);
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('switch', { name: t('export.includeWarnings') }));
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as { warnings: string[] };
    expect(input.warnings).toEqual([]);
  });

  it('ส่งออกล้มเหลว: แสดง error + ปุ่มลองใหม่ ลองใหม่แล้วเรียกซ้ำ', async () => {
    pushLiveProposal();
    renderProposalPdfMock.mockRejectedValueOnce(new Error('สร้าง PDF พัง'));
    renderProposalPdfMock.mockResolvedValueOnce(new Blob(['x']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(screen.getByText(t('export.failed', { reason: 'สร้าง PDF พัง' }))).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    await waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    });
  });

  it('ยกเลิกกลางทาง: ไม่ดาวน์โหลดผลที่ค้างอยู่', async () => {
    pushLiveProposal();
    let resolvePdf: (blob: Blob) => void = () => undefined;
    renderProposalPdfMock.mockReturnValue(
      new Promise<Blob>((resolve) => {
        resolvePdf = resolve;
      }),
    );
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t('common.cancel') })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: t('common.cancel') }));

    resolvePdf(new Blob(['x']));
    await new Promise((r) => setTimeout(r, 0));

    expect(downloadBlobMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t('export.download') })).toBeInTheDocument();
  });

  it('N3: BOQ ประมาณการหมด → แจ้งเตือน estimate heavy', () => {
    pushLiveProposal({ boq: [makeLine({ basis: 'estimate', citations: [] })] });
    render(<ExportDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(t('proposal.warnings.title'));
  });

  it('ส่วนที่ PDF ไม่รองรับการปิด (BOQ/ภาคผนวก/ตัวชี้วัด) ถูก disable ไว้เสมอ', () => {
    pushLiveProposal();
    render(<ExportDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('switch', { name: t('export.includeBoq') })).toBeDisabled();
    expect(screen.getByRole('switch', { name: t('export.includeCitations') })).toBeDisabled();
    expect(screen.getByRole('switch', { name: t('export.includeStats') })).toBeDisabled();
  });

  it('source prop ถูกส่งมา (โหมด /load) → ใช้ proposal จาก source แทน store และไม่เรียก dataVersion', async () => {
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();
    const source = { proposal: makeProposal({ title: 'จากไฟล์ที่โหลด' }), warnings: [], editedLineIds: [] };

    render(<ExportDialog open onClose={vi.fn()} source={source} />);
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    expect(dataVersionMock).not.toHaveBeenCalled();
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as { proposal: Proposal };
    expect(input.proposal.title).toBe('จากไฟล์ที่โหลด');
  });
});
