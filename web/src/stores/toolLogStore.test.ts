import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryIllustrationSink } from '@/ai/illustrationSink';
import { createToolLog } from '@/ai/toolLog';
import { useToolLogStore } from './toolLogStore';

beforeEach(() => {
  useToolLogStore.getState().reset();
});

describe('toolLogStore', () => {
  it('เริ่มต้นว่าง (ยังไม่มี session ผูกอยู่)', () => {
    const state = useToolLogStore.getState();
    expect(state.toolLog).toBeNull();
    expect(state.illustrationSink).toBeNull();
    expect(state.version).toBe(0);
  });

  it('attach เก็บ reference เดิม (ไม่ clone) และเพิ่ม version', () => {
    const toolLog = createToolLog();
    const sink = createInMemoryIllustrationSink();
    useToolLogStore.getState().attach(toolLog, sink);

    const state = useToolLogStore.getState();
    expect(state.toolLog).toBe(toolLog);
    expect(state.illustrationSink).toBe(sink);
    expect(state.version).toBe(1);
  });

  it('bump เพิ่ม version โดยไม่แตะ reference ของ toolLog/illustrationSink', () => {
    const toolLog = createToolLog();
    const sink = createInMemoryIllustrationSink();
    useToolLogStore.getState().attach(toolLog, sink);
    useToolLogStore.getState().bump();
    useToolLogStore.getState().bump();

    const state = useToolLogStore.getState();
    expect(state.version).toBe(3);
    expect(state.toolLog).toBe(toolLog);
  });

  it('mutate ToolLog เดิมสะท้อนผ่าน reference เดิมได้ (แค่ version บอกว่าให้อ่านใหม่)', () => {
    const toolLog = createToolLog();
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());
    toolLog.recordSourceId('src_1');
    useToolLogStore.getState().bump();

    expect(useToolLogStore.getState().toolLog?.hasSourceId('src_1')).toBe(true);
  });

  it('reset คืนค่าเริ่มต้น', () => {
    useToolLogStore.getState().attach(createToolLog(), createInMemoryIllustrationSink());
    useToolLogStore.getState().reset();
    expect(useToolLogStore.getState().toolLog).toBeNull();
    expect(useToolLogStore.getState().version).toBe(0);
  });
});
