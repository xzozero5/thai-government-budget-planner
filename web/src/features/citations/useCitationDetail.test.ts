import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Citation } from '@/ai/tools/proposal';
import type { BudgetLine } from '@/data';
import { useCitationDetail, type CitationDrawerLoaders } from './useCitationDetail';

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

function makeLoaders(overrides: Partial<CitationDrawerLoaders> = {}): CitationDrawerLoaders {
  return {
    loadBudgetLine: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('useCitationDetail', () => {
  it('citation=null → status loading เสมอ (drawer ปิดอยู่)', () => {
    const { result } = renderHook(() => useCitationDetail(null, makeLoaders()));
    expect(result.current.state.status).toBe('loading');
  });

  it('web: ไม่เรียก loader ใด ๆ, loaded ทันที', () => {
    const loadBudgetLine = vi.fn().mockResolvedValue(null);
    const loaders = makeLoaders({ loadBudgetLine });
    const citation: Citation = { kind: 'web', url: 'https://example.com', retrieved_at: '2026-09-01' };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));
    expect(result.current.state).toEqual({ status: 'loaded', data: { kind: 'web' } });
    expect(loadBudgetLine).not.toHaveBeenCalled();
  });

  it('budget_line: loader คืนแถว → loaded', async () => {
    const line = makeLine();
    const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(line) });
    const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));

    await waitFor(() => {
      expect(result.current.state.status).toBe('loaded');
    });
    expect(result.current.state).toEqual({ status: 'loaded', data: { kind: 'budget_line', line } });
  });

  it('budget_line: loader คืน null → not-found (ไม่มี reason)', async () => {
    const loaders = makeLoaders({ loadBudgetLine: vi.fn().mockResolvedValue(null) });
    const citation: Citation = { kind: 'budget_line', source_id: 'missing' };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'not-found' });
    });
  });

  it('budget_line: hasBudgetLineHint คืน false → not-found reason "noHint" โดยไม่เรียก loadBudgetLine เลย', async () => {
    const loadBudgetLine = vi.fn().mockResolvedValue(makeLine());
    const hasBudgetLineHint = vi.fn().mockReturnValue(false);
    const loaders = makeLoaders({ loadBudgetLine, hasBudgetLineHint });
    const citation: Citation = { kind: 'budget_line', source_id: 'no-hint' };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'not-found', reason: 'noHint' });
    });
    expect(hasBudgetLineHint).toHaveBeenCalledWith('no-hint');
    expect(loadBudgetLine).not.toHaveBeenCalled();
  });

  it('budget_line: hasBudgetLineHint คืน true → ทำงานตามปกติ (ไม่มี reason)', async () => {
    const line = makeLine();
    const loadBudgetLine = vi.fn().mockResolvedValue(line);
    const hasBudgetLineHint = vi.fn().mockReturnValue(true);
    const loaders = makeLoaders({ loadBudgetLine, hasBudgetLineHint });
    const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'loaded', data: { kind: 'budget_line', line } });
    });
  });

  it('loader throw → error พร้อมข้อความ, retry เรียก loader ใหม่', async () => {
    const loadBudgetLine = vi
      .fn()
      .mockRejectedValueOnce(new Error('เน็ตหลุด'))
      .mockResolvedValueOnce(makeLine());
    const loaders = makeLoaders({ loadBudgetLine });
    const citation: Citation = { kind: 'budget_line', source_id: 'src-1' };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error', message: 'เน็ตหลุด' });
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('loaded');
    });
    expect(loadBudgetLine).toHaveBeenCalledTimes(2);
  });

  it('document loader ไม่ได้ส่งมา (undefined) → ถือเป็น not-found', async () => {
    const loaders = makeLoaders();
    const citation: Citation = { kind: 'document', doc_id: 'doc-1', page: 3 };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));

    await waitFor(() => {
      expect(result.current.state.status).toBe('not-found');
    });
  });

  it('econ: loader คืนค่า → loaded พร้อมข้อมูล', async () => {
    const point = { label: 'ดัชนีราคาผู้บริโภค', value: 112.4, unit: '2553=100', verified: false };
    const loaders = makeLoaders({ loadEconPoint: vi.fn().mockResolvedValue(point) });
    const citation: Citation = { kind: 'econ', indicator: 'cpi', year_be: 2567 };
    const { result } = renderHook(() => useCitationDetail(citation, loaders));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'loaded', data: { kind: 'econ', point } });
    });
  });

  it('race condition: เปลี่ยน citation ระหว่างโหลด → ผลของ citation เก่าต้องไม่ทับผลของ citation ใหม่', async () => {
    let resolveFirst!: (line: BudgetLine | null) => void;
    const firstPromise = new Promise<BudgetLine | null>((resolve) => {
      resolveFirst = resolve;
    });
    const secondLine = makeLine({ source_id: 'src-2', item_name_raw: 'รายการที่สอง' });
    const loadBudgetLine = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => Promise.resolve(secondLine));
    const loaders = makeLoaders({ loadBudgetLine });

    const citationA: Citation = { kind: 'budget_line', source_id: 'src-1' };
    const citationB: Citation = { kind: 'budget_line', source_id: 'src-2' };

    const { result, rerender } = renderHook(({ citation }) => useCitationDetail(citation, loaders), {
      initialProps: { citation: citationA as Citation },
    });

    expect(result.current.state.status).toBe('loading');

    rerender({ citation: citationB });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'loaded', data: { kind: 'budget_line', line: secondLine } });
    });

    // ผลของ request แรก (citation A) มาถึงทีหลัง — ต้องไม่ทับ state ปัจจุบันที่เป็นของ citation B แล้ว
    act(() => {
      resolveFirst(makeLine({ source_id: 'src-1' }));
    });

    await Promise.resolve();
    expect(result.current.state).toEqual({ status: 'loaded', data: { kind: 'budget_line', line: secondLine } });
  });
});
