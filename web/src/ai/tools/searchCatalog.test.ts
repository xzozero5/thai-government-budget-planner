import { createDataFacade, type CatalogItem, type Facets, type SearchCatalogResult } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { searchCatalogTool } from './searchCatalog';
import type { ToolContext } from './toolKit';

function emptyFacets(): Facets {
  return { budget_types: [], coverage_notes: [], datasets: [], fiscal_years: [], ministries: [], provinces: [] };
}

function makeCtx(): ToolContext {
  return { data: createDataFacade(), toolLog: createToolLog(), illustrationSink: createInMemoryIllustrationSink() };
}

const baseCatalogItem: CatalogItem = {
  key: 'เครื่องปรับอากาศ 18000 บีทียู',
  name: 'เครื่องปรับอากาศ 18000 บีทียู',
  n_lines: 42,
  years: [2566, 2567],
  top_agencies: ['กรมทดสอบ'],
  sample_source_ids: ['src-1', 'src-2'],
  shards: [0],
};

describe('searchCatalogTool', () => {
  it('input ผิด schema → is_error', async () => {
    const result = await searchCatalogTool.run({}, makeCtx());
    expect(result.isError).toBe(true);
  });

  it('เส้นทางปกติ: คืน items พร้อม price_stats เต็ม, บันทึก sample_source_ids ลง ToolLog', async () => {
    const searchResult: SearchCatalogResult = {
      matches: [
        {
          item: { i: 0, key: baseCatalogItem.key, name: baseCatalogItem.name, n_lines: 42, years: [2566, 2567], has_unit_price: true },
          score: 5,
          matchedTerms: ['เครื่องปรับอากาศ'],
          lowSpecificity: false,
        },
      ],
      total: 1,
    };
    const item: CatalogItem = {
      ...baseCatalogItem,
      unit_price: { min: 10000, p25: 12000, median: 15000, p75: 18000, max: 20000, n: 10 },
    };
    const toolLog = createToolLog();
    const ctx: ToolContext = {
      data: createDataFacade({
        searchCatalog: vi.fn().mockResolvedValue(searchResult),
        getCatalogItem: vi.fn().mockResolvedValue(item),
        facets: vi.fn().mockResolvedValue(emptyFacets()),
      }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };

    const result = await searchCatalogTool.run({ query: 'เครื่องปรับอากาศ' }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      const out = result.output;
      expect(out.items).toHaveLength(1);
      expect(out.items[0]?.price_basis).toBe('unit_price');
      expect(out.items[0]?.price_stats).toEqual(item.unit_price);
      expect(out.items[0]?.reliability).toBeUndefined();
    }
    expect(toolLog.hasSourceId('src-1')).toBe(true);
    expect(toolLog.hasSourceId('src-2')).toBe(true);
  });

  it('AC2: unit_price.n < 3 → reliability:"low" + คำเตือน และ cap confidence ของ sample_source_ids', async () => {
    const searchResult: SearchCatalogResult = {
      matches: [
        {
          item: { i: 0, key: baseCatalogItem.key, name: baseCatalogItem.name, n_lines: 2, years: [2567], has_unit_price: true },
          score: 1,
          matchedTerms: [],
          lowSpecificity: false,
        },
      ],
      total: 1,
    };
    const item: CatalogItem = {
      ...baseCatalogItem,
      unit_price: { min: 10000, p25: 10000, median: 10000, p75: 10000, max: 10000, n: 2 },
    };
    const toolLog = createToolLog();
    const ctx: ToolContext = {
      data: createDataFacade({
        searchCatalog: vi.fn().mockResolvedValue(searchResult),
        getCatalogItem: vi.fn().mockResolvedValue(item),
        facets: vi.fn().mockResolvedValue(emptyFacets()),
      }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await searchCatalogTool.run({ query: 'x' }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.items[0]?.reliability).toBe('low');
      expect(result.output.items[0]?.reliability_note).toBeDefined();
    }
    expect(toolLog.getConfidenceCeiling('src-1')).toBe('medium');
  });

  it('AC2: ไม่มี unit_price → price_basis:"amount_per_line" พร้อม note', async () => {
    const searchResult: SearchCatalogResult = {
      matches: [
        {
          item: { i: 0, key: baseCatalogItem.key, name: baseCatalogItem.name, n_lines: 5, years: [2567], has_unit_price: false },
          score: 1,
          matchedTerms: [],
          lowSpecificity: false,
        },
      ],
      total: 1,
    };
    const item: CatalogItem = {
      ...baseCatalogItem,
      amount: { min: 1000, p25: 1000, median: 1000, p75: 1000, max: 1000, n: 5 },
    };
    const ctx = makeCtxWith(searchResult, item);
    const result = await searchCatalogTool.run({ query: 'x' }, ctx);
    if (!result.isError) {
      expect(result.output.items[0]?.price_basis).toBe('amount_per_line');
      expect(result.output.items[0]?.price_basis_note).toBe('ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย');
    } else {
      throw new Error('expected success');
    }
  });

  it('AC3: low_specificity → คำเตือนให้ถามขนาด/สเปคก่อน', async () => {
    const searchResult: SearchCatalogResult = {
      matches: [
        {
          item: { i: 0, key: baseCatalogItem.key, name: baseCatalogItem.name, n_lines: 500, years: [2567], has_unit_price: true, low_specificity: true },
          score: 1,
          matchedTerms: [],
          lowSpecificity: true,
        },
      ],
      total: 1,
    };
    const item: CatalogItem = {
      ...baseCatalogItem,
      low_specificity: true,
      unit_price: { min: 1, p25: 2, median: 3, p75: 4, max: 5, n: 100 },
    };
    const ctx = makeCtxWith(searchResult, item);
    const result = await searchCatalogTool.run({ query: 'x' }, ctx);
    if (!result.isError) {
      expect(result.output.items[0]?.low_specificity).toBe(true);
      expect(result.output.items[0]?.low_specificity_warning).toBeDefined();
      // ต้องส่ง p25–p75 + n เสมอ ไม่ใช่ median เดี่ยว
      expect(result.output.items[0]?.price_stats?.p25).toBeDefined();
      expect(result.output.items[0]?.price_stats?.p75).toBeDefined();
      expect(result.output.items[0]?.price_stats?.n).toBeDefined();
    } else {
      throw new Error('expected success');
    }
  });
});

function makeCtxWith(searchResult: SearchCatalogResult, item: CatalogItem): ToolContext {
  return {
    data: createDataFacade({
      searchCatalog: vi.fn().mockResolvedValue(searchResult),
      getCatalogItem: vi.fn().mockResolvedValue(item),
      facets: vi.fn().mockResolvedValue(emptyFacets()),
    }),
    toolLog: createToolLog(),
    illustrationSink: createInMemoryIllustrationSink(),
  };
}
