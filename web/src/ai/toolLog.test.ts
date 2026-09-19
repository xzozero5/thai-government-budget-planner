import { describe, expect, it } from 'vitest';
import { createToolLog } from './toolLog';

describe('ToolLog', () => {
  it('source_id/doc_id: hasX เป็น false ก่อน record และ true หลัง record', () => {
    const log = createToolLog();
    expect(log.hasSourceId('src-1')).toBe(false);
    log.recordSourceId('src-1');
    expect(log.hasSourceId('src-1')).toBe(true);

    expect(log.hasDocId('doc-1')).toBe(false);
    log.recordDocId('doc-1');
    expect(log.hasDocId('doc-1')).toBe(true);
  });

  it('recordSourceIds รับหลายค่าพร้อมกัน', () => {
    const log = createToolLog();
    log.recordSourceIds(['a', 'b', 'c']);
    expect(log.hasSourceId('a')).toBe(true);
    expect(log.hasSourceId('b')).toBe(true);
    expect(log.hasSourceId('z')).toBe(false);
  });

  it('shard hint ต่อ source_id', () => {
    const log = createToolLog();
    expect(log.getSourceShard('src-1')).toBeUndefined();
    log.recordSourceShard('src-1', 'budget_lines/pbo/2567/00000.parquet');
    expect(log.getSourceShard('src-1')).toBe('budget_lines/pbo/2567/00000.parquet');
  });

  it('econ value ต้องตรงทั้ง indicator และปี', () => {
    const log = createToolLog();
    log.recordEconValue('cpi_headline_index', 2567);
    expect(log.hasEconValue('cpi_headline_index', 2567)).toBe(true);
    expect(log.hasEconValue('cpi_headline_index', 2566)).toBe(false);
    expect(log.hasEconValue('construction_material_index', 2567)).toBe(false);
  });

  it('inflation adjustment: findInflationAdjustment คืน entry ที่ตรง key (ไม่รวม factor)', () => {
    const log = createToolLog();
    log.recordInflationAdjustment({
      fromAmountThb: 100_000,
      fromYearBe: 2565,
      toYearBe: 2570,
      indicator: 'cpi_headline_index',
      factor: 1.1,
      adjustedThb: 110_000,
    });
    const found = log.findInflationAdjustment({
      fromAmountThb: 100_000,
      fromYearBe: 2565,
      toYearBe: 2570,
      indicator: 'cpi_headline_index',
    });
    expect(found?.factor).toBe(1.1);
    expect(
      log.findInflationAdjustment({
        fromAmountThb: 999,
        fromYearBe: 2565,
        toYearBe: 2570,
        indicator: 'cpi_headline_index',
      }),
    ).toBeUndefined();
  });

  it('trend ref แยก kind item/indicator ไม่ปนกัน', () => {
    const log = createToolLog();
    log.recordTrendRef({ kind: 'item', key: 'เครื่องปรับอากาศ' });
    expect(log.hasTrendRef({ kind: 'item', key: 'เครื่องปรับอากาศ' })).toBe(true);
    expect(log.hasTrendRef({ kind: 'indicator', key: 'เครื่องปรับอากาศ' })).toBe(false);
  });

  it('illustration id + illustrationCount', () => {
    const log = createToolLog();
    expect(log.illustrationCount()).toBe(0);
    log.recordIllustrationId('illus-1');
    expect(log.hasIllustrationId('illus-1')).toBe(true);
    expect(log.illustrationCount()).toBe(1);
  });

  it('web url', () => {
    const log = createToolLog();
    log.recordWebUrl('https://shopee.co.th/x');
    expect(log.hasWebUrl('https://shopee.co.th/x')).toBe(true);
    expect(log.hasWebUrl('https://lazada.co.th/x')).toBe(false);
  });

  it('confidence ceiling', () => {
    const log = createToolLog();
    expect(log.getConfidenceCeiling('src-1')).toBeUndefined();
    log.recordConfidenceCeiling('src-1', 'medium');
    expect(log.getConfidenceCeiling('src-1')).toBe('medium');
  });

  it('proposal attempt counter นับขึ้นทุกครั้งที่เรียก', () => {
    const log = createToolLog();
    expect(log.proposalAttemptCount()).toBe(0);
    expect(log.recordProposalAttempt()).toBe(1);
    expect(log.recordProposalAttempt()).toBe(2);
    expect(log.proposalAttemptCount()).toBe(2);
  });

  it('reset ล้างทุกดัชนี', () => {
    const log = createToolLog();
    log.recordSourceId('a');
    log.recordDocId('b');
    log.recordEconValue('cpi_headline_index', 2567);
    log.recordIllustrationId('i');
    log.recordProposalAttempt();
    log.reset();
    expect(log.hasSourceId('a')).toBe(false);
    expect(log.hasDocId('b')).toBe(false);
    expect(log.hasEconValue('cpi_headline_index', 2567)).toBe(false);
    expect(log.illustrationCount()).toBe(0);
    expect(log.proposalAttemptCount()).toBe(0);
  });
});
