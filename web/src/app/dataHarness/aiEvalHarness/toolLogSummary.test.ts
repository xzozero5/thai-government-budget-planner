import { describe, expect, it } from 'vitest';
import { createToolLog } from '@/ai/toolLog';
import { createCountingToolLog } from './toolLogSummary';

describe('createCountingToolLog', () => {
  it('นับจำนวน unique ของแต่ละชนิด และยัง delegate พฤติกรรมเดิมของ ToolLog ครบ', () => {
    const inner = createToolLog();
    const { toolLog, summary } = createCountingToolLog(inner);

    toolLog.recordSourceId('a');
    toolLog.recordSourceId('a');
    toolLog.recordSourceIds(['b', 'c']);
    toolLog.recordDocId('doc1');
    toolLog.recordEconValue('cpi_headline_index', 2567);
    toolLog.recordWebUrl('https://example.com');
    toolLog.recordTrendRef({ kind: 'item', key: 'x' });
    toolLog.recordProposalAttempt();
    toolLog.recordProposalAttempt();

    expect(toolLog.hasSourceId('a')).toBe(true);
    expect(inner.hasSourceId('a')).toBe(true);
    expect(toolLog.hasDocId('doc1')).toBe(true);
    expect(toolLog.hasEconValue('cpi_headline_index', 2567)).toBe(true);
    expect(toolLog.hasWebUrl('https://example.com')).toBe(true);
    expect(toolLog.hasTrendRef({ kind: 'item', key: 'x' })).toBe(true);

    expect(summary()).toEqual({
      sourceIdCount: 3,
      docIdCount: 1,
      econValueCount: 1,
      webUrlCount: 1,
      trendRefCount: 1,
      illustrationCount: 0,
      proposalAttemptCount: 2,
    });
  });

  it('reset() ล้างทั้งตัวนับและ inner', () => {
    const inner = createToolLog();
    const { toolLog, summary } = createCountingToolLog(inner);
    toolLog.recordSourceId('a');
    toolLog.reset();
    expect(summary().sourceIdCount).toBe(0);
    expect(inner.hasSourceId('a')).toBe(false);
  });
});
