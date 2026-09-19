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
