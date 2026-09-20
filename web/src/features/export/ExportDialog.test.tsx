import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqLine, Proposal, TrendRef } from '@/ai/tools/proposal';
import { t } from '@/i18n';
import { useProposalStore } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import type { ProposalPdfSections } from './pdf/types';
import type { ExportTrendData } from './pdfInputs';
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
const svgToPngDataUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue('data:image/png;base64,trend'));

vi.mock('@/data', () => ({ data: { dataVersion: dataVersionMock } }));
vi.mock('./downloadBlob', () => ({ downloadBlob: downloadBlobMock }));
vi.mock('./pdf/renderProposalPdf', () => ({
  renderProposalPdf: renderProposalPdfMock,
  buildPdfFileName: buildPdfFileNameMock,
}));
vi.mock('./pdf/svgToPng', () => ({ svgToPngDataUrl: svgToPngDataUrlMock }));

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

function fakeLoadTrend(data: ExportTrendData | null = { title: 'เครื่องปรับอากาศ', basis: 'unit_price', points: [{ yearBe: 2567, median: 100, n: 5 }] }): (ref: TrendRef) => Promise<ExportTrendData | null> {
  return () => Promise.resolve(data);
}

describe('ExportDialog', () => {
  beforeEach(() => {
    useProposalStore.getState().reset();
    useToolLogStore.getState().reset();
    dataVersionMock.mockClear();
    downloadBlobMock.mockClear();
    renderProposalPdfMock.mockReset();
    buildPdfFileNameMock.mockClear();
    svgToPngDataUrlMock.mockClear();
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

  it('N3: คำเตือนจากระบบตรวจสอบปิดไม่ได้ — ส่งเข้า renderProposalPdf เสมอ (ไม่มีสวิตช์ให้ปิด)', async () => {
    pushLiveProposal({}, ['คำเตือนจาก validator']);
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as { warnings: string[] };
    expect(input.warnings).toEqual(['คำเตือนจาก validator']);
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

  it('ส่วนที่ PDF ไม่รองรับการปิดเลย (N3: BOQ/ภาคผนวก/คำเตือน) ถูก disable ไว้เสมอ พร้อมป้าย "รวมเสมอ"', () => {
    pushLiveProposal();
    render(<ExportDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('switch', { name: t('export.includeBoq') })).toBeDisabled();
    expect(screen.getByRole('switch', { name: t('export.includeCitations') })).toBeDisabled();
    expect(screen.getByRole('switch', { name: t('export.includeWarnings') })).toBeDisabled();
    expect(screen.getAllByText(t('export.alwaysIncluded'))).toHaveLength(3);
    expect(screen.getByText(t('export.alwaysIncludedHint'))).toBeInTheDocument();
  });

  it('S13: สถิติ/สมมติฐาน-ความเสี่ยง/เทียบเคียง เป็นสวิตช์ที่ปิดได้จริง (ไม่ disabled)', () => {
    pushLiveProposal();
    render(<ExportDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('switch', { name: t('export.includeStats') })).toBeEnabled();
    expect(screen.getByRole('switch', { name: t('export.includeAssumptionsRisks') })).toBeEnabled();
    expect(screen.getByRole('switch', { name: t('export.includeComparables') })).toBeEnabled();
  });

  it('S13: ปิดสวิตช์สถิติ → ส่ง sections.stats=false เข้า renderProposalPdf', async () => {
    pushLiveProposal();
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('switch', { name: t('export.includeStats') }));
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as { sections: ProposalPdfSections };
    expect(input.sections.stats).toBe(false);
    expect(input.sections.assumptionsRisks).toBe(true);
  });

  it('T-504: ไม่ส่ง prop loadTrend มาเลย → สวิตช์กราฟแนวโน้ม disabled แม้ proposal มี trend_ref', () => {
    pushLiveProposal({ boq: [makeLine({ trend_ref: { kind: 'item', key: 'เครื่องปรับอากาศ' } })] });
    render(<ExportDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('switch', { name: t('export.includeTrends') })).toBeDisabled();
    expect(screen.getByText(t('export.trendsEmpty'))).toBeInTheDocument();
  });

  it('T-504: มี loadTrend แต่ proposal ไม่มี trend_ref เลย → สวิตช์กราฟแนวโน้ม disabled', () => {
    pushLiveProposal();
    render(<ExportDialog open onClose={vi.fn()} loadTrend={fakeLoadTrend()} />);
    expect(screen.getByRole('switch', { name: t('export.includeTrends') })).toBeDisabled();
  });

  it('T-504: มี loadTrend + trend_ref → เปิดสวิตช์ได้ (ค่าเริ่มต้นเปิดอยู่แล้ว) และ renderProposalPdf ได้ images.trends', async () => {
    pushLiveProposal({ boq: [makeLine({ trend_ref: { kind: 'item', key: 'เครื่องปรับอากาศ' } })] });
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} loadTrend={fakeLoadTrend()} />);
    expect(screen.getByRole('switch', { name: t('export.includeTrends') })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as {
      images?: { trends?: { title: string; dataUrl: string }[] };
    };
    expect(input.images?.trends).toHaveLength(1);
    expect(input.images?.trends?.[0]?.dataUrl).toBe('data:image/png;base64,trend');
  });

  it('T-602 (เก็บตก PDF, N3): ตัวชี้วัดเศรษฐกิจที่ verified:false → images.trends[].unverified = true', async () => {
    pushLiveProposal({ stat_cards: [{ trend_ref: { kind: 'indicator', key: 'cpi' }, headline_th: 'CPI' }] });
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();

    render(
      <ExportDialog
        open
        onClose={vi.fn()}
        loadTrend={fakeLoadTrend({
          title: 'ดัชนีราคาผู้บริโภค',
          basis: 'econ',
          points: [{ yearBe: 2567, median: 100 }],
          verified: false,
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as {
      images?: { trends?: { unverified?: boolean }[] };
    };
    expect(input.images?.trends?.[0]?.unverified).toBe(true);
  });

  it('T-504: ปิดสวิตช์กราฟแนวโน้ม → ไม่เรียก loadTrend เลยและไม่ส่ง images.trends', async () => {
    pushLiveProposal({ boq: [makeLine({ trend_ref: { kind: 'item', key: 'เครื่องปรับอากาศ' } })] });
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const loadTrendSpy = vi.fn(fakeLoadTrend());
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} loadTrend={loadTrendSpy} />);
    await user.click(screen.getByRole('switch', { name: t('export.includeTrends') }));
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    expect(loadTrendSpy).not.toHaveBeenCalled();
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as {
      images?: { trends?: unknown[] };
    };
    expect(input.images?.trends).toBeUndefined();
  });

  it('S13: พิมพ์ชื่อผู้จัดทำ → ส่ง author (trim แล้ว) เข้า renderProposalPdf', async () => {
    pushLiveProposal();
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(t('export.authorLabel')), '  กองบรรณาธิการข่าว ก  ');
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as { author?: string };
    expect(input.author).toBe('กองบรรณาธิการข่าว ก');
  });

  it('S13: ไม่พิมพ์ชื่อผู้จัดทำเลย → ไม่ส่ง author เข้า renderProposalPdf', async () => {
    pushLiveProposal();
    renderProposalPdfMock.mockResolvedValue(new Blob(['x']));
    const user = userEvent.setup();

    render(<ExportDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: t('export.download') }));

    await waitFor(() => {
      expect(renderProposalPdfMock).toHaveBeenCalledTimes(1);
    });
    const input = renderProposalPdfMock.mock.calls[0]?.[0] as { author?: string };
    expect(input.author).toBeUndefined();
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
