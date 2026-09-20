import { createDataFacade, type BudgetLine, type GetLinesResult } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog, type ToolLog } from '../toolLog';
import { getBudgetLineTool } from './getBudgetLine';
import type { ToolContext } from './toolKit';

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

function makeCtx(toolLog: ToolLog = createToolLog()): { ctx: ToolContext; toolLog: ToolLog } {
  return { ctx: { data: createDataFacade(), toolLog, illustrationSink: createInMemoryIllustrationSink() }, toolLog };
}

describe('getBudgetLineTool', () => {
  it('input ผิด schema → is_error', async () => {
    const { ctx } = makeCtx();
    const result = await getBudgetLineTool.run({ source_ids: [] }, ctx);
    expect(result.isError).toBe(true);
  });

  it('source_id ที่ไม่เคยผ่าน ToolLog มาก่อน → ได้ not_found ต่อรายการ (ไม่ error ทั้ง call)', async () => {
    const { ctx } = makeCtx();
    const result = await getBudgetLineTool.run({ source_ids: ['src-unknown'] }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.lines).toHaveLength(0);
      expect(result.output.not_found).toHaveLength(1);
      expect(result.output.not_found[0]?.source_id).toBe('src-unknown');
    }
  });

  it('เส้นทางปกติ: ใช้ shard hint จาก ToolLog เรียก data.getLines', async () => {
    const toolLog = createToolLog();
    toolLog.recordSourceShard('src-1', 'budget_lines/act_2570_draft/00000.parquet');
    const getLines = vi.fn<(sourceIds: string[], shardHints: string[]) => Promise<GetLinesResult>>().mockResolvedValue({
      rows: [makeLine()],
      shardPaths: ['budget_lines/act_2570_draft/00000.parquet'],
      rowShards: { 'src-1': 'budget_lines/act_2570_draft/00000.parquet' },
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    });
    const ctx: ToolContext = {
      data: createDataFacade({ getLines }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getBudgetLineTool.run({ source_ids: ['src-1'] }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.lines).toHaveLength(1);
      expect(result.output.lines[0]?.item_name_raw).toBe('เครื่องปรับอากาศ ขนาด 18000 บีทียู');
    }
    expect(getLines).toHaveBeenCalledWith(['src-1'], ['budget_lines/act_2570_draft/00000.parquet']);
    // T-307 H2: บันทึก SourceFingerprint ของแถวจริงไว้ให้ emit_proposal ตรวจ comparables/BOQ ภายหลัง
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

  describe('T-604(B): resolve shard จาก candidate ของ search_catalog เมื่อยังไม่รู้ shard จริง', () => {
    it('id ที่มีแค่ candidate (ไม่มี shard ที่รู้แน่นอน) → ไล่ค้นแล้วเจอ ไม่ตอบ not_found + บันทึก shard จริงไว้', async () => {
      const toolLog = createToolLog();
      // เหมือน search_catalog: รู้แค่ candidate shard (ไม่รู้ไฟล์จริง) — ไม่เคยเรียก recordSourceShard
      toolLog.recordSourceShardCandidates?.('src-1', ['shard-a.parquet', 'shard-b.parquet']);
      const getLines = vi.fn().mockResolvedValue({
        rows: [makeLine()],
        shardPaths: ['shard-a.parquet', 'shard-b.parquet'],
        rowShards: { 'src-1': 'shard-b.parquet' },
        coverageNotes: [],
        droppedRows: 0,
        warnings: [],
      } satisfies GetLinesResult);
      const ctx: ToolContext = {
        data: createDataFacade({ getLines }),
        toolLog,
        illustrationSink: createInMemoryIllustrationSink(),
      };

      const result = await getBudgetLineTool.run({ source_ids: ['src-1'] }, ctx);
      expect(result.isError).toBe(false);
      if (result.isError) throw new Error('expected success');
      expect(result.output.not_found).toHaveLength(0);
      expect(result.output.lines).toHaveLength(1);
      // getLines ถูกเรียก 2 ครั้ง: (1) ไล่ค้น candidate เพื่อ resolve shard จริง (2) ดึงแถวเต็มตามปกติ
      expect(getLines).toHaveBeenNthCalledWith(1, ['src-1'], ['shard-a.parquet', 'shard-b.parquet']);
      expect(getLines).toHaveBeenNthCalledWith(2, ['src-1'], ['shard-b.parquet']);
      expect(toolLog.getSourceShard('src-1')).toBe('shard-b.parquet');
    });

    it('candidate เกิน MAX_SHARDS_TO_SCAN → ไล่ค้นเป็นชุด ๆ ละ ≤12 จนเจอ (ชุดที่สองถึงเจอ)', async () => {
      const toolLog = createToolLog();
      const firstBatch = Array.from({ length: 12 }, (_, i) => `shard-${String(i)}.parquet`);
      const secondBatch = ['shard-final.parquet'];
      toolLog.recordSourceShardCandidates?.('src-1', [...firstBatch, ...secondBatch]);
      const getLines = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [],
          shardPaths: firstBatch,
          rowShards: {},
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        } satisfies GetLinesResult)
        .mockResolvedValueOnce({
          rows: [makeLine()],
          shardPaths: secondBatch,
          rowShards: { 'src-1': 'shard-final.parquet' },
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        } satisfies GetLinesResult)
        .mockResolvedValueOnce({
          rows: [makeLine()],
          shardPaths: secondBatch,
          rowShards: {},
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        } satisfies GetLinesResult);
      const ctx: ToolContext = {
        data: createDataFacade({ getLines }),
        toolLog,
        illustrationSink: createInMemoryIllustrationSink(),
      };

      const result = await getBudgetLineTool.run({ source_ids: ['src-1'] }, ctx);
      expect(result.isError).toBe(false);
      if (result.isError) throw new Error('expected success');
      expect(result.output.not_found).toHaveLength(0);
      expect(getLines).toHaveBeenNthCalledWith(1, ['src-1'], firstBatch);
      expect(getLines).toHaveBeenNthCalledWith(2, ['src-1'], secondBatch);
      expect(toolLog.getSourceShard('src-1')).toBe('shard-final.parquet');
    });

    it('มี candidate แต่ไล่ค้นแล้วไม่เจอเลย → ยัง not_found ตามพฤติกรรมเดิม (ไม่เดา)', async () => {
      const toolLog = createToolLog();
      toolLog.recordSourceShardCandidates?.('src-1', ['shard-a.parquet']);
      const getLines = vi.fn().mockResolvedValue({
        rows: [],
        shardPaths: ['shard-a.parquet'],
        rowShards: {},
        coverageNotes: [],
        droppedRows: 0,
        warnings: [],
      } satisfies GetLinesResult);
      const ctx: ToolContext = {
        data: createDataFacade({ getLines }),
        toolLog,
        illustrationSink: createInMemoryIllustrationSink(),
      };

      const result = await getBudgetLineTool.run({ source_ids: ['src-1'] }, ctx);
      expect(result.isError).toBe(false);
      if (result.isError) throw new Error('expected success');
      expect(result.output.not_found).toHaveLength(1);
      expect(result.output.not_found[0]?.source_id).toBe('src-1');
      expect(toolLog.getSourceShard('src-1')).toBeUndefined();
    });

    it('shard จริงรู้อยู่แล้ว (recordSourceShard) → ไม่ไล่ค้น candidate ซ้ำ (ไม่เรียก getLines เพิ่ม)', async () => {
      const toolLog = createToolLog();
      toolLog.recordSourceShard('src-1', 'shard-known.parquet');
      toolLog.recordSourceShardCandidates?.('src-1', ['shard-a.parquet', 'shard-b.parquet']);
      const getLines = vi.fn().mockResolvedValue({
        rows: [makeLine()],
        shardPaths: ['shard-known.parquet'],
        rowShards: {},
        coverageNotes: [],
        droppedRows: 0,
        warnings: [],
      } satisfies GetLinesResult);
      const ctx: ToolContext = {
        data: createDataFacade({ getLines }),
        toolLog,
        illustrationSink: createInMemoryIllustrationSink(),
      };

      const result = await getBudgetLineTool.run({ source_ids: ['src-1'] }, ctx);
      expect(result.isError).toBe(false);
      // เรียก getLines แค่ครั้งเดียว (ดึงแถวเต็มตามปกติ) — ไม่มีการไล่ค้น candidate เพราะรู้ shard แน่นอนแล้ว
      expect(getLines).toHaveBeenCalledTimes(1);
      expect(getLines).toHaveBeenCalledWith(['src-1'], ['shard-known.parquet']);
    });
  });

  it('AC4: group_total_mismatch → max_confidence:"medium" พร้อมหมายเหตุ OCR (ADR-005)', async () => {
    const toolLog = createToolLog();
    toolLog.recordSourceShard('src-1', 'shard.parquet');
    const ctx: ToolContext = {
      data: createDataFacade({
        getLines: vi.fn().mockResolvedValue({
          rows: [makeLine({ quality_flags: ['group_total_mismatch'] })],
          shardPaths: ['shard.parquet'],
          rowShards: {},
          coverageNotes: [],
          droppedRows: 0,
          warnings: [],
        }),
      }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getBudgetLineTool.run({ source_ids: ['src-1'] }, ctx);
    if (!result.isError) {
      expect(result.output.lines[0]?.max_confidence).toBe('medium');
      expect(result.output.lines[0]?.confidence_note).toContain('OCR');
    } else {
      throw new Error('expected success');
    }
    expect(toolLog.getConfidenceCeiling('src-1')).toBe('medium');
  });
});
