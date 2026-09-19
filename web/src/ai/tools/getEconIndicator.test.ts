import { createDataFacade, type EconValueResult } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { getEconIndicatorTool } from './getEconIndicator';
import type { ToolContext } from './toolKit';

describe('getEconIndicatorTool', () => {
  it('มีค่า → บันทึกลง ToolLog', async () => {
    const toolLog = createToolLog();
    const value: EconValueResult = {
      value: 105.2,
      unit: 'index',
      source_name: 'สนค.',
      source_url: 'https://example.go.th',
      verified: false,
      note: 'ค่าดัชนี',
    };
    const ctx: ToolContext = {
      data: createDataFacade({ getEconValue: vi.fn().mockResolvedValue(value) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getEconIndicatorTool.run({ indicators: ['cpi_headline_index'], years_be: [2567] }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.values[0]?.value).toBe(105.2);
    }
    expect(toolLog.hasEconValue('cpi_headline_index', 2567)).toBe(true);
  });

  it('AC5: ไม่มีค่า → {value:null, note} ห้ามประมาณ และไม่บันทึกลง ToolLog', async () => {
    const toolLog = createToolLog();
    const ctx: ToolContext = {
      data: createDataFacade({ getEconValue: vi.fn().mockResolvedValue(null) }),
      toolLog,
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getEconIndicatorTool.run({ indicators: ['cpi_headline_index'], years_be: [2540] }, ctx);
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.values[0]?.value).toBeNull();
      expect(result.output.values[0]?.note.length).toBeGreaterThan(0);
    }
    expect(toolLog.hasEconValue('cpi_headline_index', 2540)).toBe(false);
  });

  it('input ผิด schema → is_error', async () => {
    const ctx: ToolContext = {
      data: createDataFacade(),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    const result = await getEconIndicatorTool.run({ indicators: [], years_be: [2567] }, ctx);
    expect(result.isError).toBe(true);
  });

  it('cross product ของ indicators × years_be', async () => {
    const getEconValue = vi.fn().mockResolvedValue(null);
    const ctx: ToolContext = {
      data: createDataFacade({ getEconValue }),
      toolLog: createToolLog(),
      illustrationSink: createInMemoryIllustrationSink(),
    };
    await getEconIndicatorTool.run({ indicators: ['a', 'b'], years_be: [2566, 2567] }, ctx);
    expect(getEconValue).toHaveBeenCalledTimes(4);
  });
});
