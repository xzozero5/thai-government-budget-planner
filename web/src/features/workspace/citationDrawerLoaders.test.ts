import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolLog } from '@/ai/toolLog';

const getLines = vi.fn();
vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, data: { ...actual.data, getLines: (...args: unknown[]) => getLines(...args) as unknown } };
});

const { createCitationDrawerLoaders } = await import('./citationDrawerLoaders');

describe('createCitationDrawerLoaders — source_id ที่รู้แค่ candidate shards (sample id จาก search_catalog)', () => {
  beforeEach(() => {
    getLines.mockReset();
  });

  it('ไล่หาใน candidate ทีละชุด ≤ 12 ไฟล์ → เจอแล้วจำ shard ตัวจริงใน ToolLog และคืนแถว', async () => {
    const toolLog = createToolLog();
    const candidates = Array.from({ length: 14 }, (_, i) => `budget_lines/pbo/2566/${String(i)}.parquet`);
    toolLog.recordSourceId('sample-1');
    toolLog.recordSourceShardCandidates?.('sample-1', candidates);
    const row = { source_id: 'sample-1' };
    getLines.mockImplementation((_ids: string[], shards: string[]) =>
      Promise.resolve(
        shards.includes(candidates[13] ?? '')
          ? { rows: [row], rowShards: { 'sample-1': candidates[13] } }
          : { rows: [], rowShards: {} },
      ),
    );

    const loaders = createCitationDrawerLoaders(toolLog);
    await expect(loaders.loadBudgetLine('sample-1')).resolves.toEqual(row);
    expect(getLines.mock.calls[0]?.[1]).toHaveLength(12);
    expect(toolLog.getSourceShard('sample-1')).toBe(candidates[13]);
  });

  it('ไม่มีทั้ง shard และ candidate → คืน null โดยไม่เรียก data layer', async () => {
    const loaders = createCitationDrawerLoaders(createToolLog());
    await expect(loaders.loadBudgetLine('unknown')).resolves.toBeNull();
    expect(getLines).not.toHaveBeenCalled();
  });
});
