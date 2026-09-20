import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Citation } from '@/ai/tools/proposal';
import type { BudgetLine } from '@/data';
import { t } from '@/i18n';
import { CitationDrawer, type CitationDrawerLoaders } from './CitationDrawer';

function makeLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    source_id: 'src-1',
    dataset: 'pbo_disbursement',
    fiscal_year_be: 2566,
    gov_level: 'central',
    ministry: 'เกษตรและสหกรณ์',
    ministry_code: null,
    agency: 'กรมชลประทาน',
    agency_code: null,
    province: 'น่าน',
    local_gov_name: null,
    strategy: null,
    budget_group: null,
    plan: 'บริหารจัดการน้ำ',
    output_project: null,
    activity: null,
    budget_type: null,
    expense_category: null,
    is_capital: null,
    item_name_raw: 'คอนกรีตผสมเสร็จ 240 ksc งานฝายน้ำล้น บ้านทดสอบ ตำบลทดสอบ',
    item_key: 'คอนกรีตผสมเสร็จ',
    item_qty: 100,
    item_unit: 'ลบ.ม.',
    spec_tokens: [],
    amount_thb: 2100000,
    unit_price_thb: 2100,
    revised_thb: 2100000,
    po_thb: 1980000,
    disbursed_thb: 1975400,
    disbursed_incl_po_thb: null,
    reserved_thb: null,
    carryover_thb: null,
    disbursement_rate: 0.941,
    description: null,
    legal_reference: null,
    source_path: 'เพราะ AI ไม่ใช่แค่ CHATBOT/PBO/x.xlsx',
    source_sheet: 'เบิกจ่าย66',
    source_row: 1284,
    source_page: null,
    source_doc_id: 'doc-1',
    quality_flags: [],
    ...overrides,
  };
}

function makeLoaders(overrides: Partial<CitationDrawerLoaders> = {}): CitationDrawerLoaders {
  return {
    loadBudgetLine: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('CitationDrawer', () => {
  it('citation=null → ไม่ render dialog', () => {
    render(<CitationDrawer open={true} onClose={vi.fn()} citation={null} loaders={makeLoaders()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('open=false → ไม่ render dialog แม้มี citation', () => {
    const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
    render(<CitationDrawer open={false} onClose={vi.fn()} citation={citation} loaders={makeLoaders()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('แสดง loading skeleton ระหว่างรอ loader', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- Promise ที่ตั้งใจไม่ resolve เพื่อค้างสถานะ loading
    const loaders = makeLoaders({ loadBudgetLine: () => new Promise(() => {}) });
    const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
    render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);
    expect(screen.getByText(t('common.loading'))).toBeInTheDocument();
  });

  describe('budget_line', () => {
    it('แสดง item_name_raw เต็ม, ที่มา, และ N3 label เมื่อ unit_price_thb เป็น null', async () => {
      const line = makeLine({ unit_price_thb: null });
      const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(line) });
      const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);

      await screen.findByText(line.item_name_raw);
      expect(screen.getByText(/ยอดต่อรายการงบ — ไม่ใช่ราคาต่อหน่วย/)).toBeInTheDocument();
      expect(screen.getByText(line.source_path)).toBeInTheDocument();
      expect(screen.getByText(line.source_sheet, { exact: false })).toBeInTheDocument();
    });

    it('unit_price_thb มีค่า → ไม่แสดงป้าย N3', async () => {
      const line = makeLine();
      const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(line) });
      const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);

      await screen.findByText(line.item_name_raw);
      expect(screen.queryByText(/ยอดต่อรายการงบ — ไม่ใช่ราคาต่อหน่วย/)).not.toBeInTheDocument();
    });

    it('แสดง quality flag badge (upstream_ocr) พร้อมเลขหน้าใน tooltip', async () => {
      const line = makeLine({ quality_flags: ['upstream_ocr'], source_page: 42 });
      const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(line) });
      const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);

      await screen.findByText(line.item_name_raw);
      expect(screen.getByText(t('citation.flags.upstream_ocrShort'))).toBeInTheDocument();
      expect(screen.getByText(t('citation.flags.upstream_ocr', { page: 42 }))).toBeInTheDocument();
    });

    it('contextLine แสดง basis/confidence badge ที่หัวเนื้อหา', async () => {
      const line = makeLine();
      const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(line) });
      const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
      const contextLine = {
        id: 'l1',
        category: 'งานโครงสร้าง',
        item: 'คอนกรีต',
        qty: 100,
        unit: 'ลบ.ม.',
        unit_price_thb: 2100,
        total_thb: 210000,
        basis: 'historical' as const,
        confidence: 'high' as const,
        rationale: 'อ้างอิงจากงบจริง',
        citations: [citation],
      };
      render(
        <CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} contextLine={contextLine} />,
      );
      await screen.findByText(line.item_name_raw);
      expect(screen.getByText(t('proposal.basis.historical'))).toBeInTheDocument();
    });

    it('ปุ่ม "ดูแถวใกล้เคียง" เรียก loadNeighbors แล้วแสดงตาราง ≤ 10 แถว', async () => {
      const user = userEvent.setup();
      const line = makeLine();
      const neighbor = makeLine({ source_id: 'src-2', item_name_raw: 'รายการใกล้เคียง' });
      const loadNeighbors = vi.fn().mockResolvedValue([neighbor]);
      const loaders = makeLoaders({
        loadBudgetLine: vi.fn().mockResolvedValue(line),
        loadNeighbors,
      });
      const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);

      const button = await screen.findByRole('button', { name: t('citation.nearbyRows') });
      await user.click(button);

      await screen.findByText('รายการใกล้เคียง');
      expect(loadNeighbors).toHaveBeenCalledWith(line);
    });

    it('ไม่มี loadNeighbors → ไม่แสดงปุ่ม "ดูแถวใกล้เคียง"', async () => {
      const line = makeLine();
      const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(line) });
      const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);
      await screen.findByText(line.item_name_raw);
      expect(screen.queryByRole('button', { name: t('citation.nearbyRows') })).not.toBeInTheDocument();
    });
  });

  describe('document', () => {
    it('เอกสารสแกน → แสดงป้าย N4 และไม่แสดง excerpt', async () => {
      const loaders = makeLoaders({
        loadDocumentChunk: vi.fn().mockResolvedValue({
          title: 'รายงาน กมธ. ครั้งที่ 12/2567',
          page: 5,
          text: 'เนื้อหาบางส่วน',
          isScanned: true,
        }),
      });
      const citation: Citation = { kind: 'document', doc_id: 'doc-1', page: 5 };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);

      await screen.findByText(t('citation.document.scannedBadge'));
      expect(screen.queryByText(t('citation.excerpt'))).not.toBeInTheDocument();
    });

    it('เอกสารมีข้อความ → แสดง excerpt เป็น text ล้วน แม้มี <script> ปนอยู่', async () => {
      const malicious = 'ข้อความ <script>alert(1)</script> ที่พบ';
      const loaders = makeLoaders({
        loadDocumentChunk: vi.fn().mockResolvedValue({
          title: 'เอกสารทดสอบ',
          page: 3,
          text: malicious,
          isScanned: false,
        }),
      });
      const citation: Citation = { kind: 'document', doc_id: 'doc-1', page: 3 };
      const { container } = render(
        <CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />,
      );

      await screen.findByText(malicious);
      expect(container.querySelector('script')).not.toBeInTheDocument();
    });

    it('citation.quote มีค่า → ใช้ quote แทน text ของ chunk', async () => {
      const loaders = makeLoaders({
        loadDocumentChunk: vi.fn().mockResolvedValue({
          title: 'เอกสารทดสอบ',
          page: 3,
          text: 'เนื้อหาทั้งชิ้น ยาวมาก',
          isScanned: false,
        }),
      });
      const citation: Citation = { kind: 'document', doc_id: 'doc-1', page: 3, quote: 'ข้อความที่ยกมาเจาะจง' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);
      await screen.findByText('ข้อความที่ยกมาเจาะจง');
    });
  });

  describe('econ', () => {
    it('verified=false → แสดงป้าย "ยังไม่ตรวจสอบ"', async () => {
      const loaders = makeLoaders({
        loadEconPoint: vi.fn().mockResolvedValue({
          label: 'ดัชนีราคาวัสดุก่อสร้าง',
          value: 112.4,
          unit: '2553=100',
          verified: false,
        }),
      });
      const citation: Citation = { kind: 'econ', indicator: 'cpi', year_be: 2567 };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);
      await screen.findByText(t('citation.econ.unverified'));
    });

    it('verified=true → แสดงป้าย "ตรวจสอบแล้ว"', async () => {
      const loaders = makeLoaders({
        loadEconPoint: vi.fn().mockResolvedValue({
          label: 'ดัชนีราคาวัสดุก่อสร้าง',
          value: 112.4,
          unit: '2553=100',
          verified: true,
        }),
      });
      const citation: Citation = { kind: 'econ', indicator: 'cpi', year_be: 2567 };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);
      await screen.findByText(t('citation.econ.verified'));
    });
  });

  describe('web', () => {
    it('https → title เป็นลิงก์เปิดแท็บใหม่, โดเมนแสดงเป็น text', () => {
      const citation: Citation = {
        kind: 'web',
        url: 'https://www.shopee.co.th/product/1',
        title: 'เหล็กเส้น DB12 SD40',
        retrieved_at: '2026-09-01T00:00:00.000Z',
      };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={makeLoaders()} />);

      const link = screen.getByRole('link', { name: /เหล็กเส้น DB12 SD40/ });
      expect(link).toHaveAttribute('href', citation.url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(screen.getByText('shopee.co.th')).toBeInTheDocument();
    });

    it('http:// → ไม่ใช่ลิงก์ (render เป็น text)', () => {
      const citation: Citation = {
        kind: 'web',
        url: 'http://example.com/product/1',
        title: 'สินค้าทดสอบ',
        retrieved_at: '2026-09-01',
      };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={makeLoaders()} />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('สินค้าทดสอบ')).toBeInTheDocument();
    });

    it('onRejectWeb ถูกเรียกเมื่อกดปุ่ม "ไม่เอาราคานี้"', async () => {
      const user = userEvent.setup();
      const onRejectWeb = vi.fn();
      const citation: Citation = {
        kind: 'web',
        url: 'https://www.shopee.co.th/product/1',
        retrieved_at: '2026-09-01',
      };
      render(
        <CitationDrawer open citation={citation} onClose={vi.fn()} loaders={makeLoaders()} onRejectWeb={onRejectWeb} />,
      );
      await user.click(screen.getByRole('button', { name: t('citation.web.reject') }));
      expect(onRejectWeb).toHaveBeenCalledWith(citation);
    });
  });

  describe('loading / not-found / error / retry', () => {
    it('loader คืน null → ข้อความ "อ้างอิงไม่พบ"', async () => {
      const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(null) });
      const citation: Citation = { kind: 'budget_line', source_id: 'bl_missing' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);
      await screen.findByText(t('citation.notFoundTitle'));
      expect(screen.getByText(t('citation.notFoundBody', { id: 'bl_missing' }))).toBeInTheDocument();
    });

    it('hasBudgetLineHint คืน false → ข้อความ "เปิดดูแถวต้นทางไม่ได้" (ไม่ใช่ "อ้างอิงไม่พบ")', async () => {
      const loaders = makeLoaders({
        loadBudgetLine: vi.fn().mockResolvedValue(null),
        hasBudgetLineHint: vi.fn().mockReturnValue(false),
      });
      const citation: Citation = { kind: 'budget_line', source_id: 'bl_old_file' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);
      await screen.findByText(t('citation.lookupUnavailableTitle'));
      expect(
        screen.getByText(t('citation.lookupUnavailableBody', { id: 'bl_old_file' })),
      ).toBeInTheDocument();
      expect(screen.queryByText(t('citation.notFoundTitle'))).not.toBeInTheDocument();
    });

    it('loader throw → error + ปุ่มลองใหม่ ที่เรียก loader ซ้ำได้', async () => {
      const user = userEvent.setup();
      const line = makeLine();
      const loadBudgetLine = vi
        .fn()
        .mockRejectedValueOnce(new Error('โหลดไม่สำเร็จ'))
        .mockResolvedValueOnce(line);
      const loaders = makeLoaders({ loadBudgetLine });
      const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
      render(<CitationDrawer open citation={citation} onClose={vi.fn()} loaders={loaders} />);

      await screen.findByRole('alert');
      const retryButton = screen.getByRole('button', { name: t('common.retry') });
      await user.click(retryButton);

      await screen.findByText(line.item_name_raw);
      expect(loadBudgetLine).toHaveBeenCalledTimes(2);
    });
  });

  it('race condition: เปลี่ยน citation ระหว่างโหลด → ไม่แสดงผลของ citation เก่าทับของใหม่', async () => {
    let resolveFirst!: (line: BudgetLine | null) => void;
    const firstPromise = new Promise<BudgetLine | null>((resolve) => {
      resolveFirst = resolve;
    });
    const lineA = makeLine({ source_id: 'src-1', item_name_raw: 'รายการเอ' });
    const lineB = makeLine({ source_id: 'src-2', item_name_raw: 'รายการบี' });
    const loadBudgetLine = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => Promise.resolve(lineB));
    const loaders = makeLoaders({ loadBudgetLine });

    const citationA: Citation = { kind: 'budget_line', source_id: 'src-1' };
    const citationB: Citation = { kind: 'budget_line', source_id: 'src-2' };

    const { rerender } = render(
      <CitationDrawer open citation={citationA} onClose={vi.fn()} loaders={loaders} />,
    );

    rerender(<CitationDrawer open citation={citationB} onClose={vi.fn()} loaders={loaders} />);

    await screen.findByText('รายการบี');

    resolveFirst(lineA);
    await waitFor(() => {
      expect(screen.queryByText('รายการเอ')).not.toBeInTheDocument();
    });
    expect(screen.getByText('รายการบี')).toBeInTheDocument();
  });

  it('Esc ปิด drawer (พฤติกรรมจาก Drawer)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
    render(<CitationDrawer open citation={citation} onClose={onClose} loaders={makeLoaders()} />);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
