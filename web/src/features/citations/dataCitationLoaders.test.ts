import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocNotFoundError, InvalidShardPathError, type BudgetLine, type DocChunk, type SourceDoc } from '@/data';
import { createBudgetLineLoaders, loadDocumentChunkFromData, loadEconPointFromData } from './dataCitationLoaders';

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

function makeLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    source_id: 'src-1',
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
    item_name_raw: 'เครื่องปรับอากาศ ขนาด 18000 บีทียู',
    item_key: 'เครื่องปรับอากาศ',
    item_qty: 1,
    item_unit: 'เครื่อง',
    spec_tokens: [],
    amount_thb: 30000,
    unit_price_thb: 30000,
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

function makeSourceDoc(overrides: Partial<SourceDoc> = {}): SourceDoc {
  return {
    doc_id: 'doc-1',
    rel_path: 'x.pdf',
    kind: 'pdf',
    bytes: 100,
    sha1: 'abc',
    pages: 5,
    has_text_layer: true,
    extracted: true,
    title_guess: 'เอกสารทดสอบ',
    collection: 'committee',
    meeting_no: null,
    meeting_date: null,
    topic: null,
    agency_guess: null,
    province: null,
    gov_level: null,
    level: null,
    fiscal_years: [],
    text_chunks_file: null,
    n_chunks: null,
    note: null,
    duplicates: null,
    ...overrides,
  };
}

function makeChunk(overrides: Partial<DocChunk> = {}): DocChunk {
  return { doc_id: 'doc-1', page: 3, chunk_no: 0, text: 'เนื้อหา', tables: [], ...overrides };
}

beforeEach(() => {
  dataMocks.getLines.mockReset();
  dataMocks.getNeighborLines.mockReset();
  dataMocks.getDoc.mockReset();
  dataMocks.getEconValue.mockReset();
  dataMocks.getEconSeries.mockReset();
});

describe('createBudgetLineLoaders', () => {
  it('hasBudgetLineHint: true เฉพาะเมื่อ getShardHint คืนค่า', () => {
    const loaders = createBudgetLineLoaders((id) => (id === 'has-hint' ? 'shard.parquet' : undefined));
    expect(loaders.hasBudgetLineHint('has-hint')).toBe(true);
    expect(loaders.hasBudgetLineHint('no-hint')).toBe(false);
  });

  it('loadBudgetLine: ไม่มี hint → null ทันที ไม่เรียก data.getLines', async () => {
    const loaders = createBudgetLineLoaders(() => undefined);
    const result = await loaders.loadBudgetLine('src-1');
    expect(result).toBeNull();
    expect(dataMocks.getLines).not.toHaveBeenCalled();
  });

  it('loadBudgetLine: มี hint → เรียก data.getLines([id],[shard]) แล้วคืนแถวแรก', async () => {
    const line = makeLine();
    dataMocks.getLines.mockResolvedValue({
      rows: [line],
      shardPaths: ['shard.parquet'],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    });
    const loaders = createBudgetLineLoaders(() => 'shard.parquet');
    const result = await loaders.loadBudgetLine('src-1');
    expect(result).toEqual(line);
    expect(dataMocks.getLines).toHaveBeenCalledWith(['src-1'], ['shard.parquet']);
  });

  it('loadBudgetLine: data.getLines คืนแถวว่าง → null (มี hint แต่หาไม่พบจริง)', async () => {
    dataMocks.getLines.mockResolvedValue({
      rows: [],
      shardPaths: ['shard.parquet'],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    });
    const loaders = createBudgetLineLoaders(() => 'shard.parquet');
    expect(await loaders.loadBudgetLine('src-1')).toBeNull();
  });

  it('loadBudgetLine: InvalidShardPathError (shard ไม่รู้จักในข้อมูลรุ่นปัจจุบัน) → null ไม่ throw', async () => {
    dataMocks.getLines.mockRejectedValue(new InvalidShardPathError(['old/shard.parquet']));
    const loaders = createBudgetLineLoaders(() => 'old/shard.parquet');
    expect(await loaders.loadBudgetLine('src-1')).toBeNull();
  });

  it('loadBudgetLine: error อื่น (เช่นเครือข่าย) → throw ต่อ', async () => {
    dataMocks.getLines.mockRejectedValue(new Error('เน็ตหลุด'));
    const loaders = createBudgetLineLoaders(() => 'shard.parquet');
    await expect(loaders.loadBudgetLine('src-1')).rejects.toThrow('เน็ตหลุด');
  });

  it('loadNeighbors: ไม่มี hint → [] ไม่เรียก data.getNeighborLines', async () => {
    const loaders = createBudgetLineLoaders(() => undefined);
    expect(await loaders.loadNeighbors(makeLine())).toEqual([]);
    expect(dataMocks.getNeighborLines).not.toHaveBeenCalled();
  });

  it('loadNeighbors: มี hint → คืนแถวจาก data.getNeighborLines', async () => {
    const neighbor = makeLine({ source_id: 'src-2' });
    dataMocks.getNeighborLines.mockResolvedValue({
      rows: [neighbor],
      shardPaths: ['shard.parquet'],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    });
    const loaders = createBudgetLineLoaders(() => 'shard.parquet');
    expect(await loaders.loadNeighbors(makeLine())).toEqual([neighbor]);
  });

  it('loadNeighbors: InvalidShardPathError → [] ไม่ throw', async () => {
    dataMocks.getNeighborLines.mockRejectedValue(new InvalidShardPathError(['old/shard.parquet']));
    const loaders = createBudgetLineLoaders(() => 'old/shard.parquet');
    expect(await loaders.loadNeighbors(makeLine())).toEqual([]);
  });
});

describe('loadDocumentChunkFromData', () => {
  it('สำเร็จ → ประกอบ title/page/text/isScanned จาก getDoc', async () => {
    dataMocks.getDoc.mockResolvedValue({
      doc: makeSourceDoc(),
      chunks: [makeChunk({ page: 3, text: 'ส่วนที่ 1' }), makeChunk({ page: 3, text: 'ส่วนที่ 2' })],
    });
    const result = await loadDocumentChunkFromData('doc-1', 3);
    expect(result).toEqual({
      title: 'เอกสารทดสอบ',
      page: 3,
      text: 'ส่วนที่ 1\n\nส่วนที่ 2',
      isScanned: false,
    });
  });

  it('DocNotFoundError → null', async () => {
    dataMocks.getDoc.mockRejectedValue(new DocNotFoundError('doc-missing'));
    expect(await loadDocumentChunkFromData('doc-missing')).toBeNull();
  });

  it('error อื่น → throw ต่อ', async () => {
    dataMocks.getDoc.mockRejectedValue(new Error('เน็ตหลุด'));
    await expect(loadDocumentChunkFromData('doc-1')).rejects.toThrow('เน็ตหลุด');
  });
});

describe('loadEconPointFromData', () => {
  it('ไม่มี record ของ (indicator, year) → null', async () => {
    dataMocks.getEconValue.mockResolvedValue(null);
    dataMocks.getEconSeries.mockResolvedValue(null);
    expect(await loadEconPointFromData('cpi_headline_index', 2599)).toBeNull();
  });

  it('มี record → label ใช้ label_th ของ series ถ้ามี', async () => {
    dataMocks.getEconValue.mockResolvedValue({
      value: 101.2,
      unit: '2562=100',
      source_name: 'สนค.',
      source_url: 'https://x',
      verified: false,
    });
    dataMocks.getEconSeries.mockResolvedValue({
      indicator: 'cpi_headline_index',
      label_th: 'ดัชนีราคาผู้บริโภคทั่วไป',
      series: [],
    });
    const result = await loadEconPointFromData('cpi_headline_index', 2567);
    expect(result).toEqual({
      label: 'ดัชนีราคาผู้บริโภคทั่วไป',
      value: 101.2,
      unit: '2562=100',
      verified: false,
      sourceName: 'สนค.',
      sourceUrl: 'https://x',
    });
  });

  it('ไม่มี series → label fallback เป็นรหัส indicator ตัวพิมพ์ใหญ่', async () => {
    dataMocks.getEconValue.mockResolvedValue({
      value: 1,
      unit: 'x',
      source_name: 'x',
      source_url: 'https://x',
      verified: false,
    });
    dataMocks.getEconSeries.mockResolvedValue(null);
    const result = await loadEconPointFromData('unknown_indicator', 2567);
    expect(result?.label).toBe('UNKNOWN_INDICATOR');
  });
});
