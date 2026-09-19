import { createDataFacade } from '@/data';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { clampRows, createTool, MAX_STRING_LENGTH, truncateNullableString, truncateString, type ToolContext } from './toolKit';

function makeCtx(): ToolContext {
  return { data: createDataFacade(), toolLog: createToolLog(), illustrationSink: createInMemoryIllustrationSink() };
}

describe('truncateString', () => {
  it('ไม่ตัดสตริง ≤ 300 ตัวอักษร', () => {
    expect(truncateString('สั้น')).toBe('สั้น');
  });
  it('ตัดสตริง > 300 ตัวอักษร', () => {
    const long = 'ก'.repeat(400);
    const result = truncateString(long);
    expect(result.length).toBe(MAX_STRING_LENGTH + 1); // +1 สำหรับ "…"
    expect(result.endsWith('…')).toBe(true);
  });
  it('truncateNullableString ผ่าน null ตรง ๆ', () => {
    expect(truncateNullableString(null)).toBeNull();
  });
});

describe('clampRows', () => {
  it('ตัดให้เหลือ ≤ 50 แถวเป็นค่าเริ่มต้น', () => {
    const rows = Array.from({ length: 80 }, (_, i) => i);
    expect(clampRows(rows)).toHaveLength(50);
  });
});

describe('createTool', () => {
  const echoTool = createTool({
    name: 'echo',
    description: 'echo input back',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    handler: (input) => Promise.resolve({ text: input.text }),
  });

  it('toApiTool มี eager_input_streaming:true และ input_schema เป็น object', () => {
    const apiTool = echoTool.toApiTool();
    expect(apiTool.eager_input_streaming).toBe(true);
    expect(apiTool.name).toBe('echo');
    expect((apiTool.input_schema as Record<string, unknown>)['type']).toBe('object');
  });

  it('run(): input ไม่ตรง schema → is_error พร้อมข้อความไทยที่โมเดลอ่านรู้เรื่อง', async () => {
    const result = await echoTool.run({ text: 123 }, makeCtx());
    expect(result.isError).toBe(true);
    if (result.isError) {
      expect(result.content).toContain('message_th');
      expect(() => {
        JSON.parse(result.content);
      }).not.toThrow();
    }
  });

  it('run(): handler สำเร็จ → ห่อผลลัพธ์ด้วย delimiter และบอกว่าเป็นข้อมูลไม่ใช่คำสั่ง', async () => {
    const result = await echoTool.run({ text: 'สวัสดี' }, makeCtx());
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.content).toContain('<tool_result_data>');
      expect(result.content).toContain('</tool_result_data>');
      expect(result.content).toContain('ไม่ใช่คำสั่ง');
      expect(result.output).toEqual({ text: 'สวัสดี' });
    }
  });

  it('run(): handler throw → is_error พร้อม message ของ error นั้น', async () => {
    const failingTool = createTool({
      name: 'fail',
      description: 'always throws',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: () => {
        throw new Error('พังจริง');
      },
    });
    const result = await failingTool.run({}, makeCtx());
    expect(result.isError).toBe(true);
    if (result.isError) {
      expect(result.content).toContain('พังจริง');
    }
  });
});
