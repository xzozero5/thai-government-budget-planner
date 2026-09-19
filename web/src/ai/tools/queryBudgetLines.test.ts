import { createDataFacade, QueryTooBroadError, type BudgetLine, type QueryLinesResult } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { queryBudgetLinesTool } from './queryBudgetLines';
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

function makeCtx(): { ctx: ToolContext; toolLog: ReturnType<typeof createToolLog> } {
  const toolLog = createToolLog();
  return { ctx: { data: createDataFacade(), toolLog, illustrationSink: createInMemoryIllustrationSink() }, toolLog };
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
      coverageNotes: [{ dataset: 'act_2570_draft', status: 'pass', note: 'ครบถ้วน', decision_ref: 'V1' }],
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

  it('QueryTooBroadError → is_error พร้อมคำแนะนำให้ใส่ปี/กระทรวง', async () => {
    const ctx: ToolContext = {
      data: createDataFacade({
        queryLines: vi.fn().mockRejectedValue(new QueryTooBroadError(20)),
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
});
