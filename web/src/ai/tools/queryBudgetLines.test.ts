import {
  createDataFacade,
  QueryTooBroadError,
  type BudgetLine,
  type CatalogItemDetail,
  type QueryLinesResult,
  type SearchCatalogResult,
} from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { queryBudgetLinesTool } from './queryBudgetLines';
import type { ToolContext } from './toolKit';

function makeCatalogItemDetail(overrides: Partial<CatalogItemDetail> = {}): CatalogItemDetail {
  return {
    key: 'สถานีรวม (Total Station)',
    name: 'สถานีรวม (Total Station)',
    n_lines: 10,
    years: [2566, 2567, 2568],
    top_agencies: ['กรมทดสอบ'],
    sample_source_ids: ['src-a'],
    shards: [0],
    shardPaths: [],
    ...overrides,
  };
}

function makeLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    source_id: 'src-1',
    dataset: 'act_2570_draft',
    fiscal_year_be: 2570,
    gov_level: 'central',
    ministry: 'กระทรวงทดสอบ',
    ministry_code: '15000',
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

function makeCtx(): { ctx: ToolContext; toolLog: ReturnType<typeof createToolLog> } {
  const toolLog = createToolLog();
  return {
    ctx: { data: createDataFacade(), toolLog, illustrationSink: createInMemoryIllustrationSink() },
    toolLog,
  };
}

describe('queryBudgetLinesTool', () => {
  it('input ผิด schema → is_error', async () => {
    const { ctx } = makeCtx();
    const result = await queryBudgetLinesTool.run({ limit: 'abc' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('เส้นทางปกติ: บันทึก source_id/doc_id/shard ลง ToolLog และคืน coverage_notes/warnings', async () => {
    const line = makeLine();
    const queryResult: QueryLinesResult = {
      rows: [line],
      totalMatched: 1,
      truncated: false,
      shardsScanned: 1,
      shardPaths: ['budget_lines/act_2570_draft/00000.parquet'],
      rowShards: { 'src-1': 'budget_lines/act_2570_draft/00000.parquet' },
      coverageNotes: [
        { dataset: 'act_2570_draft', status: 'pass', note: 'ครบถ้วน', decision_ref: 'V1' },
      ],
      droppedRows: 0,
      warnings: [],
    };
    const toolLog = createToolLog();
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines: vi.fn().mockResolvedValue(queryResult) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run({ keywords: ['เครื่องปรับอากาศ'] }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.rows).toHaveLength(1);
      expect(result.output.rows[0]?.price_basis).toBe('unit_price');
      expect(result.output.total).toBe(1);
      expect(result.output.coverage_notes).toHaveLength(1);
    }
    expect(toolLog.hasSourceId('src-1')).toBe(true);
    expect(toolLog.hasDocId('doc-1')).toBe(true);
    expect(toolLog.getSourceShard('src-1')).toBe('budget_lines/act_2570_draft/00000.parquet');
  });

  it('T-307 H2: บันทึก SourceFingerprint (ค่าจริงของแถว) ลง ToolLog ต่อ source_id', async () => {
    const line = makeLine();
    const queryResult: QueryLinesResult = {
      rows: [line],
      totalMatched: 1,
      truncated: false,
      shardsScanned: 1,
      shardPaths: [],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    };
    const toolLog = createToolLog();
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines: vi.fn().mockResolvedValue(queryResult) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    await queryBudgetLinesTool.run({ keywords: ['เครื่องปรับอากาศ'] }, ctx);
    expect(toolLog.getSourceFingerprint?.('src-1')).toEqual({
      amountThb: 30000,
      unitPriceThb: 30000,
      itemQty: 1,
      itemUnit: 'เครื่อง',
      fiscalYearBe: 2570,
      agency: 'กรมทดสอบ',
      ministry: 'กระทรวงทดสอบ',
      itemNameRaw: 'เครื่องปรับอากาศ ขนาด 18000 บีทียู',
      dataset: 'act_2570_draft',
    });
  });

  it('item_key → ส่ง keys ทุก variant + shardPaths จาก catalog เข้า queryLines (จำกัดการสแกนตาม catalog)', async () => {
    const queryLines = vi.fn().mockResolvedValue({
      rows: [],
      totalMatched: 0,
      truncated: false,
      shardsScanned: 2,
      shardPaths: [],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    } satisfies QueryLinesResult);
    const getCatalogItemByKey = vi.fn().mockResolvedValue({
      key: 'เครื่องปรับอากาศ 18000 บีทียู',
      keys: ['เครื่องปรับอากาศ 18000 บีทียู', 'เครื่องปรับอากาศ18000 บีทียู'],
      shardPaths: ['budget_lines/pbo/2566/20000.parquet', 'budget_lines/pbo/2567/20000.parquet'],
    });
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines, getCatalogItemByKey }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run(
      { item_key: 'เครื่องปรับอากาศ 18000 บีทียู', fiscal_years: [2566] },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(queryLines).toHaveBeenCalledWith(
      expect.objectContaining({
        itemKeys: ['เครื่องปรับอากาศ 18000 บีทียู', 'เครื่องปรับอากาศ18000 บีทียู'],
        shardPaths: ['budget_lines/pbo/2566/20000.parquet', 'budget_lines/pbo/2567/20000.parquet'],
        fiscalYears: [2566],
      }),
    );
  });

  it('item_key ที่ไม่อยู่ใน catalog → ไม่ส่ง shardPaths (ปล่อยให้ queryLines เลือกจาก filter)', async () => {
    const queryLines = vi.fn().mockResolvedValue({
      rows: [],
      totalMatched: 0,
      truncated: false,
      shardsScanned: 1,
      shardPaths: [],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    } satisfies QueryLinesResult);
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines, getCatalogItemByKey: vi.fn().mockResolvedValue(null) }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    await queryBudgetLinesTool.run({ item_key: 'ของหางยาว', fiscal_years: [2566] }, ctx);
    const arg = queryLines.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['itemKeys']).toEqual(['ของหางยาว']);
    expect('shardPaths' in arg).toBe(false);
  });

  it('AC2: unit_price_thb เป็น null → price_basis:"amount_per_line"', async () => {
    const line = makeLine({ unit_price_thb: null });
    const queryResult: QueryLinesResult = {
      rows: [line],
      totalMatched: 1,
      truncated: false,
      shardsScanned: 1,
      shardPaths: [],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    };
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines: vi.fn().mockResolvedValue(queryResult) }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run({ keywords: ['x'] }, ctx);
    if (!result.isError) {
      expect(result.output.rows[0]?.price_basis).toBe('amount_per_line');
      expect(result.output.rows[0]?.price_basis_note).toBe('ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย');
    } else {
      throw new Error('expected success');
    }
  });

  it('T-308: แถวส่วนใหญ่ amount_per_line → เตือนระดับบนสุด + แนบ implied_unit_price_hint และบันทึกลง ToolLog', async () => {
    const rows = [
      makeLine({ source_id: 's1', unit_price_thb: null, amount_thb: 279000 }),
      makeLine({ source_id: 's2', unit_price_thb: null, amount_thb: 223200 }),
      makeLine({ source_id: 's3', unit_price_thb: null, amount_thb: 139500 }),
    ];
    const queryResult: QueryLinesResult = {
      rows,
      totalMatched: 3,
      truncated: false,
      shardsScanned: 1,
      shardPaths: [],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    };
    const toolLog = createToolLog();
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines: vi.fn().mockResolvedValue(queryResult) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run({ keywords: ['x'] }, ctx);
    if (result.isError) throw new Error('expected success');
    expect(result.output.warnings.some((w) => w.includes('amount_per_line'))).toBe(true);
    expect(result.output.implied_unit_price_hint?.value_thb).toBe(27900);
    expect(toolLog.getImpliedUnitPriceHintValues?.()).toContain(27900);
  });

  it('T-308: ส่วนใหญ่เป็น unit_price อยู่แล้ว → ไม่เตือน amount_per_line และ hint เป็น null', async () => {
    const rows = [makeLine({ source_id: 's1', unit_price_thb: 30000, amount_thb: 30000 })];
    const queryResult: QueryLinesResult = {
      rows,
      totalMatched: 1,
      truncated: false,
      shardsScanned: 1,
      shardPaths: [],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    };
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines: vi.fn().mockResolvedValue(queryResult) }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run({ keywords: ['x'] }, ctx);
    if (result.isError) throw new Error('expected success');
    expect(result.output.warnings.some((w) => w.includes('amount_per_line'))).toBe(false);
    expect(result.output.implied_unit_price_hint).toBeNull();
  });

  it('AC4: quality_flags ที่บังคับ (upstream_ocr) → max_confidence:"medium" + หมายเหตุไทย และบันทึก ceiling', async () => {
    const line = makeLine({ quality_flags: ['upstream_ocr'] });
    const queryResult: QueryLinesResult = {
      rows: [line],
      totalMatched: 1,
      truncated: false,
      shardsScanned: 1,
      shardPaths: [],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    };
    const toolLog = createToolLog();
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines: vi.fn().mockResolvedValue(queryResult) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run({ keywords: ['x'] }, ctx);
    if (!result.isError) {
      expect(result.output.rows[0]?.max_confidence).toBe('medium');
      expect(result.output.rows[0]?.confidence_note).toContain('OCR');
    } else {
      throw new Error('expected success');
    }
    expect(toolLog.getConfidenceCeiling('src-1')).toBe('medium');
  });

  it('QueryTooBroadError → is_error พร้อมคำแนะนำให้ใส่ปี/กระทรวง (catalog ไม่มีอะไรตรงเลย)', async () => {
    const ctx: ToolContext = {
      data: createDataFacade({
        queryLines: vi.fn().mockRejectedValue(new QueryTooBroadError(20)),
        searchCatalog: vi.fn().mockResolvedValue({ matches: [], total: 0 } satisfies SearchCatalogResult),
      }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run({ keywords: ['แอร์'] }, ctx);
    expect(result.isError).toBe(true);
    if (result.isError) {
      expect(result.content).toContain('ปีงบประมาณ');
    }
  });

  it('ไม่มี keywords/item_key เลย (กรองตามโครงสร้างล้วน) → กว้างเกินไปยัง error เดิม (ไม่มี catalog ให้จัดอันดับ)', async () => {
    const searchCatalog = vi.fn();
    const queryLines = vi.fn().mockRejectedValue(new QueryTooBroadError(30));
    const ctx: ToolContext = {
      data: createDataFacade({ queryLines, searchCatalog }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await queryBudgetLinesTool.run({ ministry_code: '15000' }, ctx);
    expect(result.isError).toBe(true);
    // ไม่มี keyword/item_key ให้ narrow ด้วย catalog เลย — ไม่ควรเรียก search_catalog แม้แต่ครั้งเดียว
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  describe('T-604: keyword/item_key กว้างเกินเพดานสแกน → จัดอันดับ shard ด้วย search_catalog แทนการปฏิเสธ', () => {
    it('keywords กว้าง + fiscal_years 3 ปี (เคสจริง "unit-price-n1-total-station") → ได้ผลจริง พร้อม warning บอก N/M ไฟล์', async () => {
      const line = makeLine({ source_id: 'ts-1', item_name_raw: 'กล้อง Total Station' });
      const err = new QueryTooBroadError(97, {
        candidateShardCount: 97,
        availableYears: [2566, 2567, 2568],
        availableMinistryCodes: ['15000', '20000'],
      });
      const queryLines = vi
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({
          rows: [line],
          totalMatched: 1,
          truncated: false,
          shardsScanned: 1,
          shardPaths: ['budget_lines/pbo/2568/15000.parquet'],
          rowShards: { 'ts-1': 'budget_lines/pbo/2568/15000.parquet' },
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        } satisfies QueryLinesResult);
      const searchCatalog = vi.fn().mockResolvedValue({
        matches: [
          {
            item: { i: 0, key: 'Total Station', name: 'Total Station', n_lines: 10, years: [2566, 2567, 2568], has_unit_price: true },
            score: 5,
            matchedTerms: ['total', 'station'],
            lowSpecificity: false,
          },
        ],
        total: 1,
      } satisfies SearchCatalogResult);
      const getCatalogItem = vi.fn().mockResolvedValue(
        makeCatalogItemDetail({ key: 'Total Station', shardPaths: ['budget_lines/pbo/2568/15000.parquet'] }),
      );
      const toolLog = createToolLog();
      const ctx: ToolContext = {
        data: createDataFacade({ queryLines, searchCatalog, getCatalogItem }),
        toolLog,
        illustrationSink: createInMemoryIllustrationSink(),
      };

      const result = await queryBudgetLinesTool.run(
        { keywords: ['Total Station'], fiscal_years: [2568, 2567, 2566], limit: 15 },
        ctx,
      );
      expect(result.isError).toBe(false);
      if (result.isError) throw new Error('expected success');
      expect(result.output.rows).toHaveLength(1);
      expect(result.output.total).toBe(1);
      // second (retry) call ต้องคง fiscal_years เดิมครบทั้ง 3 ปี (ไม่ตัดปีทิ้งเหมือนกลยุทธ์เดิม)
      expect(queryLines.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          fiscalYears: [2568, 2567, 2566],
          shardPaths: ['budget_lines/pbo/2568/15000.parquet'],
        }),
      );
      const warning = result.output.warnings.find((w) => w.includes('จากทั้งหมด'));
      expect(warning).toBeDefined();
      expect(warning).toContain('1'); // ค้นเฉพาะ 1 ไฟล์
      expect(warning).toContain('97'); // จากทั้งหมด 97 ไฟล์
      expect(toolLog.getSourceShard('ts-1')).toBe('budget_lines/pbo/2568/15000.parquet');
    });

    it('item ตรงคำค้นมีข้อมูลหลายปี — ต้องเลือกเฉพาะ shard ปีที่ผู้ใช้ขอ (ยืนยันด้วยข้อมูลจริงว่า shard ปีอื่นปนมาแล้วโดน intersect ทิ้งทีหลังจนเหลือน้อยกว่าที่ควร)', async () => {
      const err = new QueryTooBroadError(97, { candidateShardCount: 97, availableYears: [2568, 2567, 2566], availableMinistryCodes: [] });
      const queryLines = vi
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({
          rows: [],
          totalMatched: 0,
          truncated: false,
          shardsScanned: 1,
          shardPaths: ['budget_lines/pbo/2567/08000.parquet'],
          rowShards: {},
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        } satisfies QueryLinesResult);
      const searchCatalog = vi.fn().mockResolvedValue({
        matches: [
          { item: { i: 0, key: 'total station', name: 'total station', n_lines: 25, years: [2560, 2561, 2563, 2564, 2565, 2566, 2567], has_unit_price: false }, score: 9, matchedTerms: [], lowSpecificity: false },
        ],
        total: 1,
      } satisfies SearchCatalogResult);
      // item นี้มีข้อมูลย้อนหลังหลายปี (ปกติของ catalog) — shard ส่วนใหญ่เป็นปีที่ผู้ใช้ไม่ได้ขอ
      const getCatalogItem = vi.fn().mockResolvedValue(
        makeCatalogItemDetail({
          key: 'total station',
          shardPaths: [
            'budget_lines/pbo/2560/09000.parquet',
            'budget_lines/pbo/2561/08000.parquet',
            'budget_lines/pbo/2561/09000.parquet',
            'budget_lines/pbo/2563/15000.parquet',
            'budget_lines/pbo/2564/08000.parquet',
            'budget_lines/pbo/2565/08000.parquet',
            'budget_lines/pbo/2567/08000.parquet', // ← ตรงปีที่ขอ (2568/2567/2566) ตัวเดียวในลิสต์นี้
          ],
        }),
      );
      const ctx: ToolContext = {
        data: createDataFacade({ queryLines, searchCatalog, getCatalogItem }),
        toolLog: createToolLog(),
        illustrationSink: createInMemoryIllustrationSink(),
      };

      await queryBudgetLinesTool.run({ keywords: ['Total Station'], fiscal_years: [2568, 2567, 2566] }, ctx);
      // ต้องเลือกเฉพาะ shard ที่ตรงปีที่ขอ (ไม่ใช่ 7 shard แรกตามลำดับดิบซึ่งส่วนใหญ่เป็นปีอื่น)
      expect(queryLines.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ shardPaths: ['budget_lines/pbo/2567/08000.parquet'] }),
      );
    });

    it('จัดอันดับ shard แบบ deterministic: เรียง shard ตามคะแนน search_catalog แล้วตัดที่เพดาน ไม่ใช่สุ่ม', async () => {
      const err = new QueryTooBroadError(50, { candidateShardCount: 50, availableYears: [2567], availableMinistryCodes: [] });
      const queryLines = vi
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({
          rows: [],
          totalMatched: 0,
          truncated: false,
          shardsScanned: 2,
          shardPaths: ['a.parquet', 'b.parquet'],
          rowShards: {},
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        } satisfies QueryLinesResult);
      // สองรายการ match — คะแนนสูงกว่ามาก่อน shard ของมันต้องถูกเลือกก่อน
      const searchCatalog = vi.fn().mockResolvedValue({
        matches: [
          { item: { i: 0, key: 'top', name: 'top', n_lines: 10, years: [2567], has_unit_price: false }, score: 9, matchedTerms: [], lowSpecificity: false },
          { item: { i: 1, key: 'second', name: 'second', n_lines: 5, years: [2567], has_unit_price: false }, score: 3, matchedTerms: [], lowSpecificity: false },
        ],
        total: 2,
      } satisfies SearchCatalogResult);
      const getCatalogItem = vi.fn((i: number) =>
        Promise.resolve(
          i === 0
            ? makeCatalogItemDetail({ key: 'top', shardPaths: ['a.parquet', 'b.parquet'] })
            : makeCatalogItemDetail({ key: 'second', shardPaths: ['c.parquet'] }),
        ),
      );
      const ctx: ToolContext = {
        data: createDataFacade({ queryLines, searchCatalog, getCatalogItem }),
        toolLog: createToolLog(),
        illustrationSink: createInMemoryIllustrationSink(),
      };

      await queryBudgetLinesTool.run({ keywords: ['x'], fiscal_years: [2567] }, ctx);
      expect(getCatalogItem).toHaveBeenNthCalledWith(1, 0);
      expect(getCatalogItem).toHaveBeenNthCalledWith(2, 1);
      expect(queryLines.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ shardPaths: ['a.parquet', 'b.parquet', 'c.parquet'] }),
      );
    });

    it('catalog ไม่มีอะไรตรงเลย (รายการหางยาว) → fallback ไปกลยุทธ์ตัดปีเดิมได้ตามปกติ', async () => {
      const err = new QueryTooBroadError(30, { candidateShardCount: 30, availableYears: [2568, 2567, 2566], availableMinistryCodes: [] });
      const queryLines = vi
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({
          rows: [],
          totalMatched: 0,
          truncated: false,
          shardsScanned: 1,
          shardPaths: ['only-2568.parquet'],
          rowShards: {},
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        } satisfies QueryLinesResult);
      const searchCatalog = vi.fn().mockResolvedValue({ matches: [], total: 0 } satisfies SearchCatalogResult);
      const ctx: ToolContext = {
        data: createDataFacade({ queryLines, searchCatalog }),
        toolLog: createToolLog(),
        illustrationSink: createInMemoryIllustrationSink(),
      };

      const result = await queryBudgetLinesTool.run(
        { keywords: ['ของหางยาวไม่มีใครรู้จัก'], fiscal_years: [2568, 2567, 2566] },
        ctx,
      );
      expect(result.isError).toBe(false);
      if (result.isError) throw new Error('expected success');
      // AUTO_NARROW_YEAR_COUNTS = [3,2,1]: count=3 ตัดออกเพราะเท่าจำนวนปีที่ขอเดิมพอดี (ไม่ถือว่า narrow
      // ลง) จึงลองค่าถัดไปคือ 2 ปีล่าสุดก่อน (ตัดปีน้อยที่สุดเท่าที่ยังนับว่าแคบลงจริง)
      expect(queryLines.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ fiscalYears: [2568, 2567] }),
      );
      expect(result.output.warnings.some((w) => w.includes('ปีงบประมาณ 2568, 2567'))).toBe(true);
    });
  });

  describe('T-604(A): item_key ไม่ตรง catalog เป๊ะ (แม้ normalize ช่องว่างแล้ว) → เตือนพร้อม key ใกล้เคียง แทนความเงียบ', () => {
    it('เคสจริง "fiscal-year-2562-gap": item_key มีวงเล็บติดมาจาก item_name_raw → total:0 พร้อม warning + key ใกล้เคียง', async () => {
      const rawKey =
        'รถบรรทุก (ดีเซล) ขนาด 1 ตัน ปริมาตรกระบอกสูบไม่ต่ำกว่า 2400 ซีซี ขับเคลื่อน 2 ล้อ แบบดับเบิ้ลแค็บ';
      const realKey =
        'รถบรรทุก ดีเซล ขนาด 1 ตัน ปริมาตรกระบอกสูบไม่ต่ำกว่า 2400 ซีซีขับเคลื่อน 2 ล้อ แบบดับเบิ้ลแค็บ';
      const queryLines = vi.fn().mockResolvedValue({
        rows: [],
        totalMatched: 0,
        truncated: false,
        shardsScanned: 1,
        shardPaths: [],
        rowShards: {},
        coverageNotes: [],
        droppedRows: 0,
        warnings: [],
      } satisfies QueryLinesResult);
      const getCatalogItemByKey = vi.fn().mockResolvedValue(null);
      const searchCatalog = vi.fn().mockResolvedValue({
        matches: [
          { item: { i: 0, key: realKey, name: realKey, n_lines: 8, years: [2566], has_unit_price: false }, score: 4, matchedTerms: [], lowSpecificity: false },
        ],
        total: 1,
      } satisfies SearchCatalogResult);
      const ctx: ToolContext = {
        data: createDataFacade({ queryLines, getCatalogItemByKey, searchCatalog }),
        toolLog: createToolLog(),
        illustrationSink: createInMemoryIllustrationSink(),
      };

      const result = await queryBudgetLinesTool.run({ item_key: rawKey, fiscal_years: [2566] }, ctx);
      expect(result.isError).toBe(false);
      if (result.isError) throw new Error('expected success');
      expect(result.output.total).toBe(0);
      const warning = result.output.warnings.find((w) => w.includes('ไม่ตรงกับ key ใดใน catalog'));
      expect(warning).toBeDefined();
      expect(warning).toContain(realKey);
    });

    it('item_key ตรง catalog เป๊ะ (n>0) → ไม่มี warning เรื่อง key ไม่ตรง', async () => {
      const queryLines = vi.fn().mockResolvedValue({
        rows: [makeLine()],
        totalMatched: 1,
        truncated: false,
        shardsScanned: 1,
        shardPaths: [],
        rowShards: {},
        coverageNotes: [],
        droppedRows: 0,
        warnings: [],
      } satisfies QueryLinesResult);
      const getCatalogItemByKey = vi.fn().mockResolvedValue(
        makeCatalogItemDetail({ key: 'เครื่องปรับอากาศ', shardPaths: [] }),
      );
      const searchCatalog = vi.fn();
      const ctx: ToolContext = {
        data: createDataFacade({ queryLines, getCatalogItemByKey, searchCatalog }),
        toolLog: createToolLog(),
        illustrationSink: createInMemoryIllustrationSink(),
      };
      const result = await queryBudgetLinesTool.run({ item_key: 'เครื่องปรับอากาศ' }, ctx);
      expect(result.isError).toBe(false);
      if (result.isError) throw new Error('expected success');
      expect(result.output.warnings.some((w) => w.includes('ไม่ตรงกับ key ใดใน catalog'))).toBe(false);
      expect(searchCatalog).not.toHaveBeenCalled();
    });
  });
});
