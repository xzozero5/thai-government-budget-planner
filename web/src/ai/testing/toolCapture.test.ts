import { createDataFacade, type EconValueResult } from '@/data';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { getEconIndicatorTool } from '../tools/getEconIndicator';
import type { ToolContext } from '../tools/toolKit';
import {
  getCapturedToolCalls,
  getLastCapturedOutputByName,
  installToolCapture,
  resetToolCapture,
} from './toolCapture';

function makeCtx(getEconValue: ToolContext['data']['getEconValue']): ToolContext {
  return {
    data: createDataFacade({ getEconValue }),
    toolLog: createToolLog(),
    illustrationSink: createInMemoryIllustrationSink(),
  };
}

describe('installToolCapture', () => {
  it('เก็บ input/output ดิบของ tool ที่รันสำเร็จ โดยไม่แตะ tool_result.content ที่ห่อแล้วเลย', async () => {
    installToolCapture();
    resetToolCapture();

    const econValue: EconValueResult = {
      value: 1.23,
      unit: 'index',
      source_name: 'ทดสอบ',
      source_url: 'https://example.com',
      verified: false,
      note: 'ทดสอบ',
    };
    const ctx = makeCtx(vi.fn().mockResolvedValue(econValue));

    const result = await getEconIndicatorTool.run(
      { indicators: ['cpi_headline_index'], years_be: [2567] },
      ctx,
    );
    expect(result.isError).toBe(false);

    const calls = getCapturedToolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'get_econ_indicator',
      isError: false,
      input: { indicators: ['cpi_headline_index'], years_be: [2567] },
    });

    const output = getLastCapturedOutputByName('get_econ_indicator') as { total: number };
    expect(output.total).toBe(1);
  });

  it('เก็บ input + errorContent ของ tool ที่ input ผิด schema (isError:true)', async () => {
    installToolCapture();
    resetToolCapture();
    const ctx = makeCtx(vi.fn());

    const result = await getEconIndicatorTool.run({}, ctx);
    expect(result.isError).toBe(true);

    const calls = getCapturedToolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.isError).toBe(true);
    expect(calls[0]?.errorContent).toBeDefined();
    expect(getLastCapturedOutputByName('get_econ_indicator')).toBeUndefined();
  });

  it('resetToolCapture() ล้าง log แต่ไม่ถอดการห่อ (installed ยังทำงานต่อ)', async () => {
    installToolCapture();
    resetToolCapture();
    const ctx = makeCtx(vi.fn().mockResolvedValue(null));
    await getEconIndicatorTool.run({ indicators: ['x'], years_be: [2567] }, ctx);
    expect(getCapturedToolCalls()).toHaveLength(1);

    resetToolCapture();
    expect(getCapturedToolCalls()).toHaveLength(0);

    await getEconIndicatorTool.run({ indicators: ['x'], years_be: [2567] }, ctx);
    expect(getCapturedToolCalls()).toHaveLength(1);
  });
});
