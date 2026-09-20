import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import type { BudgetLine } from '@/data';
import { t } from '@/i18n';
import { formatFiscalYearBe } from '@/lib/format';
import { LoadPage } from './LoadPage';
import { serializeSession, TGBP_FILE_MAX_BYTES, type SerializeSessionInput } from './tgbpFile';

vi.mock('./ExportDialog', () => ({
  ExportDialog: () => null,
}));

// data layer เป็น facade เดียว (`@/data`) ที่ `dataCitationLoaders.ts` เรียกจริงตอนผู้ใช้กด citation chip
// (lazy) — mock เฉพาะเมธอดที่เกี่ยวข้อง คง error class (`InvalidShardPathError`/`DocNotFoundError`) และ
// เมธอดอื่นไว้ของจริง (แบบเดียวกับ `features/workspace/slots.test.tsx`)
const dataMocks = vi.hoisted(() => ({
  getLines: vi.fn(),
  getNeighborLines: vi.fn(),
  getDoc: vi.fn(),
  getEconValue: vi.fn(),
  getEconSeries: vi.fn(),
}));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    data: {
      ...actual.data,
      ...dataMocks,
    },
  };
});

/** ค่าเริ่มต้นของทุกเทส: จำลอง "data layer โหลดไม่ได้/ไม่มีเลย" (reject) — เทสที่ไม่สนใจ data layer จริง
 * (เช่นเทสเดิมก่อนต่อ `@/data`) จะได้พฤติกรรม fallback แบบเดิมเป๊ะโดยไม่ต้อง mock อะไรเพิ่ม */
beforeEach(() => {
  const unavailable = new Error('data layer unavailable in test');
  dataMocks.getLines.mockReset().mockRejectedValue(unavailable);
  dataMocks.getNeighborLines.mockReset().mockRejectedValue(unavailable);
  dataMocks.getDoc.mockReset().mockRejectedValue(unavailable);
  dataMocks.getEconValue.mockReset().mockRejectedValue(unavailable);
  dataMocks.getEconSeries.mockReset().mockRejectedValue(unavailable);
});

function makeDataBudgetLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    source_id: 'src_1',
    dataset: 'pbo_disbursement',
    fiscal_year_be: 2568,
    gov_level: 'central',
    ministry: 'กระทรวงทดสอบ',
    ministry_code: null,
    agency: 'กรมทดสอบ',
    agency_code: null,
    province: null,
    local_gov_name: null,
    strategy: null,
    budget_group: null,
    plan: null,
    output_project: null,
    activity: null,
    budget_type: null,
    expense_category: null,
    is_capital: null,
    item_name_raw: 'เครื่องปรับอากาศแบบแยกส่วน (จากข้อมูลจริง)',
    item_key: 'เครื่องปรับอากาศ',
    item_qty: 1,
    item_unit: 'เครื่อง',
    spec_tokens: [],
    amount_thb: 20000,
    unit_price_thb: 20000,
    revised_thb: null,
    po_thb: null,
    disbursed_thb: null,
    disbursed_incl_po_thb: null,
    reserved_thb: null,
    carryover_thb: null,
    disbursement_rate: null,
    description: null,
    legal_reference: null,
    source_path: 'x.xlsx',
    source_sheet: 'sheet1',
    source_row: 5,
    source_page: null,
    source_doc_id: 'doc-1',
    quality_flags: [],
    ...overrides,
  };
}

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
    title: 'โครงการที่บันทึกไว้',
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

function validTgbpJson(
  overrides: Partial<Proposal> = {},
  sourceShards?: SerializeSessionInput['sourceShards'],
): string {
  return serializeSession({
    proposalVersions: [
      {
        id: 'propver_1',
        proposal: makeProposal(overrides),
        warnings: [],
        createdAt: 1_700_000_000_000,
        source: 'ai',
        userEditedLineIds: [],
      },
    ],
    currentProposalIndex: 0,
    chatMessages: [],
    appDataVersion: '2026-09-01',
    ...(sourceShards !== undefined ? { sourceShards } : {}),
  });
}

function renderLoadPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LoadPage />
    </MemoryRouter>,
  );
}

async function uploadFile(content: BlobPart, name = 'proposal.tgbp.json'): Promise<void> {
  const user = userEvent.setup();
  const file = new File([content], name, { type: 'application/json' });
  const input = screen.getByLabelText(t('export.load.choose'), { selector: 'input' });
  await user.upload(input, file);
}

describe('LoadPage', () => {
  const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

  beforeEach(() => {
    storageSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('สถานะเริ่มต้น: dropzone + ปุ่มเลือกไฟล์', () => {
    renderLoadPage();
    expect(screen.getByRole('heading', { name: t('export.load.title') })).toBeInTheDocument();
    expect(screen.getByText(t('export.load.dropzone'))).toBeInTheDocument();
  });

  it('ไฟล์ดี → แสดงข้อเสนอแบบอ่านอย่างเดียว พร้อมแบนเนอร์', async () => {
    await renderAndUpload(validTgbpJson());
    expect(screen.getByText(t('export.load.readOnlyBadge'))).toBeInTheDocument();
    expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument();
  });

  it('ไฟล์ดี → ไม่มีปุ่มแก้ qty/ราคาที่เปลี่ยนค่าจริง (onEditLine เป็น no-op ไม่ throw)', async () => {
    await renderAndUpload(validTgbpJson());
    // ตารางแสดงค่าปกติได้โดยไม่ error — ปุ่มแก้ยังกดได้ (ข้อจำกัดที่ทราบ ดูหมายเหตุหัวไฟล์ LoadPage.tsx)
    // แต่ค่าต้องไม่เปลี่ยนหลังกด เพราะ onEditLine เป็น no-op
    const user = userEvent.setup();
    const [qtyButton] = screen.getAllByRole('button', { name: /แก้จำนวนของ/ });
    if (!qtyButton) {
      throw new Error('ไม่พบปุ่มแก้จำนวน');
    }
    await user.click(qtyButton);
    const [totalBefore] = screen.getAllByText('20,000');
    expect(totalBefore).toBeInTheDocument();
  });

  it('JSON เสีย → แสดง error ไทยที่เข้าใจได้', async () => {
    await renderAndUpload('{ ไม่ใช่ json แน่นอน');
    expect(screen.getByRole('alert')).toHaveTextContent(t('export.load.invalid'));
  });

  it('schema ผิด (field แปลกปลอม) → แสดง error เดียวกัน', async () => {
    const polluted = JSON.stringify({ ...JSON.parse(validTgbpJson()), apiKey: 'x' });
    await renderAndUpload(polluted);
    expect(screen.getByRole('alert')).toHaveTextContent(t('export.load.invalid'));
  });

  it('ไฟล์ใหญ่เกินเพดาน → แสดง error ก่อนอ่านเนื้อไฟล์', async () => {
    const big = new Uint8Array(TGBP_FILE_MAX_BYTES + 1);
    await renderAndUpload(big, 'big.tgbp.json');
    expect(screen.getByRole('alert')).toHaveTextContent('MB');
  });

  it('ไม่มีการเรียก Storage API เลยตลอด flow (N2)', async () => {
    await renderAndUpload(validTgbpJson());
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('ลิงก์ "เริ่มงานใหม่ด้วย key ของคุณ" ชี้ไปหน้าแรก', async () => {
    await renderAndUpload(validTgbpJson());
    const link = screen.getByRole('link', { name: t('export.load.addKey') });
    expect(link).toHaveAttribute('href', '/');
  });

  async function renderAndUpload(content: BlobPart, name?: string): Promise<void> {
    renderLoadPage();
    await uploadFile(content, name);
    await waitFor(() => {
      expect(
        screen.queryByRole('status') ?? screen.queryByText(t('export.load.loading')),
      ).not.toBeInTheDocument();
    });
  }
});

describe('LoadPage — citation drawer, document/econ (ลองข้อมูลจริงก่อน แล้ว fallback เป็นข้อมูลในไฟล์)', () => {
  it('document: data layer หาไม่ได้ (เก่า/ไม่มี) → fallback ไปแสดง quote ที่ฝังในไฟล์ (ลองจริงก่อนเสมอ)', async () => {
    const proposal = makeProposal({
      boq: [
        makeLine({
          citations: [{ kind: 'document', doc_id: 'doc_1', page: 3, quote: 'ข้อความอ้างอิงในไฟล์' }],
        }),
      ],
    });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    const chip = within(desktopTable).getByRole('button', { name: 'doc_1' });
    await user.click(chip);

    const drawer = await screen.findByRole('dialog', { name: t('citation.types.document') });
    expect(within(drawer).getByText('ข้อความอ้างอิงในไฟล์')).toBeInTheDocument();
    // ลองข้อมูลจริงก่อนเสมอ (lazy — เรียกตอนกด chip เท่านั้น ไม่ใช่ตอนเปิดหน้า) แล้วค่อย fallback
    expect(dataMocks.getDoc).toHaveBeenCalledWith('doc_1', { page: 3 });
  });

  it('document: ไม่มี quote ในไฟล์ + data layer เจอจริง → ใช้เนื้อหาจริงจาก data layer (fallback ไม่มี text ให้ใช้)', async () => {
    dataMocks.getDoc.mockResolvedValueOnce({
      doc: { title_guess: 'รายงานฉบับเต็มจากข้อมูลจริง', has_text_layer: true },
      chunks: [{ page: 3, text: 'เนื้อหาทั้ง chunk จากข้อมูลจริง' }],
    });
    const proposal = makeProposal({
      boq: [makeLine({ citations: [{ kind: 'document', doc_id: 'doc_1', page: 3 }] })],
    });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktopTable).getByRole('button', { name: 'doc_1' }));

    const drawer = await screen.findByRole('dialog', { name: t('citation.types.document') });
    expect(within(drawer).getByText('รายงานฉบับเต็มจากข้อมูลจริง')).toBeInTheDocument();
    expect(within(drawer).getByText('เนื้อหาทั้ง chunk จากข้อมูลจริง')).toBeInTheDocument();
  });

  it('econ: data layer เจอจริง → แสดงค่า/ป้ายจริง (ไม่ใช่ placeholder value:null เดิม)', async () => {
    dataMocks.getEconValue.mockResolvedValueOnce({
      value: 112.4,
      unit: '2562=100',
      source_name: 'สนค.',
      source_url: 'https://x',
      verified: false,
    });
    dataMocks.getEconSeries.mockResolvedValueOnce({
      indicator: 'construction_material_index',
      label_th: 'ดัชนีราคาวัสดุก่อสร้าง',
      series: [],
    });
    const proposal = makeProposal({
      boq: [
        makeLine({
          citations: [{ kind: 'econ', indicator: 'construction_material_index', year_be: 2566 }],
        }),
      ],
    });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    await user.click(
      within(desktopTable).getByRole('button', {
        name: `${t('citation.econIndicators.construction_material_index')} · ${formatFiscalYearBe(2566, { withEra: true })}`,
      }),
    );

    const drawer = await screen.findByRole('dialog', { name: t('citation.types.econ') });
    expect(within(drawer).getByText('112.4')).toBeInTheDocument();
    expect(within(drawer).queryByText(t('citation.econ.verified'))).not.toBeInTheDocument();
  });
});

describe('LoadPage — citation drawer, budget_line (sourceShards ของไฟล์)', () => {
  it('ไฟล์เก่าไม่มี sourceShards เลย → ข้อความ "เปิดดูแถวต้นทางไม่ได้" (ไม่ใช่ "อ้างอิงไม่พบ")', async () => {
    const proposal = makeProposal({ boq: [makeLine()] });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    await user.click(
      within(desktopTable).getByRole('button', { name: `${t('citation.types.budget_line_short')} · src_1` }),
    );

    const drawer = await screen.findByRole('dialog', { name: t('citation.types.budget_line') });
    expect(within(drawer).getByText(t('citation.lookupUnavailableTitle'))).toBeInTheDocument();
    expect(within(drawer).getByText(t('citation.lookupUnavailableBody', { id: 'src_1' }))).toBeInTheDocument();
    expect(screen.queryByText(t('citation.notFoundTitle'))).not.toBeInTheDocument();
    expect(dataMocks.getLines).not.toHaveBeenCalled();
  });

  it('sourceShards มีแต่ไม่มี key ของ source_id นี้ → ข้อความเดียวกัน (ไม่ใช่ "อ้างอิงไม่พบ")', async () => {
    const proposal = makeProposal({ boq: [makeLine()] });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal, { other_source_id: 'budget_lines/pbo/2568/1.parquet' }));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    await user.click(
      within(desktopTable).getByRole('button', { name: `${t('citation.types.budget_line_short')} · src_1` }),
    );

    await screen.findByText(t('citation.lookupUnavailableTitle'));
    expect(dataMocks.getLines).not.toHaveBeenCalled();
  });

  it('sourceShards มี hint ตรง + data layer เจอแถวจริง → แสดงข้อมูลจริง เรียก data.getLines ด้วย shard hint นั้น', async () => {
    const line = makeDataBudgetLine();
    dataMocks.getLines.mockResolvedValueOnce({
      rows: [line],
      shardPaths: ['budget_lines/pbo/2568/1.parquet'],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    });
    const proposal = makeProposal({ boq: [makeLine()] });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal, { src_1: 'budget_lines/pbo/2568/1.parquet' }));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    await user.click(
      within(desktopTable).getByRole('button', { name: `${t('citation.types.budget_line_short')} · src_1` }),
    );

    const drawer = await screen.findByRole('dialog', { name: t('citation.types.budget_line') });
    expect(within(drawer).getByText(line.item_name_raw)).toBeInTheDocument();
    expect(dataMocks.getLines).toHaveBeenCalledWith(['src_1'], ['budget_lines/pbo/2568/1.parquet']);
  });

  it('sourceShards มี hint แต่ data layer หาไม่พบจริง (แถวว่าง) → ข้อความ "อ้างอิงไม่พบ" แบบเดิม (ไม่ใช่ lookupUnavailable)', async () => {
    dataMocks.getLines.mockResolvedValueOnce({
      rows: [],
      shardPaths: ['budget_lines/pbo/2568/1.parquet'],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    });
    const proposal = makeProposal({ boq: [makeLine()] });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal, { src_1: 'budget_lines/pbo/2568/1.parquet' }));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    await user.click(
      within(desktopTable).getByRole('button', { name: `${t('citation.types.budget_line_short')} · src_1` }),
    );

    const drawer = await screen.findByRole('dialog', { name: t('citation.types.budget_line') });
    expect(within(drawer).getByText(t('citation.notFoundTitle'))).toBeInTheDocument();
    expect(within(drawer).getByText(t('citation.notFoundBody', { id: 'src_1' }))).toBeInTheDocument();
    expect(screen.queryByText(t('citation.lookupUnavailableTitle'))).not.toBeInTheDocument();
  });
});
