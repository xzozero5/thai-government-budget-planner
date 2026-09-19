import { describe, expect, it } from 'vitest';
import { summarizeShardPaths } from './shardPaths';

describe('summarizeShardPaths', () => {
  it('แยกปี/กระทรวงจาก path ของ pbo (มีปีอยู่ใน path จริง)', () => {
    const summary = summarizeShardPaths([
      'budget_lines/pbo/2566/20000.parquet',
      'budget_lines/pbo/2567/20000.parquet',
      'budget_lines/pbo/2566/15000.parquet',
    ]);
    expect(summary.datasets).toEqual(['pbo_disbursement']);
    expect(summary.years).toEqual([2566, 2567]);
    expect(summary.ministryCodes).toEqual(['15000', '20000']);
    expect(summary.provinces).toEqual([]);
  });

  it('act2570 ไม่มีปีใน path — เติมปี 2570 ให้เองตามชื่อ dataset', () => {
    const summary = summarizeShardPaths(['budget_lines/act2570/15000.parquet']);
    expect(summary.datasets).toEqual(['act_2570_draft']);
    expect(summary.years).toEqual([2570]);
    expect(summary.ministryCodes).toEqual(['15000']);
  });

  it('กระทรวงที่ map ไม่ได้ (_unmapped) ยังถูกเก็บเป็น ministryCodes', () => {
    const summary = summarizeShardPaths(['budget_lines/act2570/_unmapped.parquet']);
    expect(summary.ministryCodes).toEqual(['_unmapped']);
  });

  it('act2570_province / local_subsidy → province เป็น slug ที่ตัด .parquet แล้ว', () => {
    const summary = summarizeShardPaths([
      'budget_lines/act2570_province/echiyngaihm-af4ca2.parquet',
      'budget_lines/local_subsidy/echiyngaihm-af4ca2.parquet',
    ]);
    expect(summary.datasets.sort()).toEqual(['act_2570_province', 'local_subsidy_2570']);
    expect(summary.years).toEqual([2570]);
    expect(summary.provinces).toEqual(['echiyngaihm-af4ca2']);
  });

  it('local มีสอง segment (province/local_gov_slug) — เก็บแค่ province', () => {
    const summary = summarizeShardPaths([
      'budget_lines/local/echiyngaihm-af4ca2/obch-echiyngaihm-ad3da7.parquet',
    ]);
    expect(summary.datasets).toEqual(['local_ordinance_2570']);
    expect(summary.provinces).toEqual(['echiyngaihm-af4ca2']);
    expect(summary.ministryCodes).toEqual([]);
  });

  it('committee ไม่มีปี/กระทรวง/จังหวัดให้สรุป', () => {
    const summary = summarizeShardPaths(['budget_lines/committee/d_7b1b69cd5ad6.parquet']);
    expect(summary.datasets).toEqual(['committee_table']);
    expect(summary.years).toEqual([]);
    expect(summary.ministryCodes).toEqual([]);
    expect(summary.provinces).toEqual([]);
  });

  it('path ที่ไม่ตรงรูปแบบ (ไม่ขึ้นต้นด้วย budget_lines/) ถูกข้ามอย่างเงียบ ๆ', () => {
    const summary = summarizeShardPaths(['catalog/facets.json', 'econ/indicators.json']);
    expect(summary).toEqual({ datasets: [], years: [], ministryCodes: [], provinces: [] });
  });

  it('dedupe + เรียงลำดับผลลัพธ์เสมอ (ไม่ขึ้นกับลำดับ input)', () => {
    const summary = summarizeShardPaths([
      'budget_lines/pbo/2568/75000.parquet',
      'budget_lines/pbo/2566/20000.parquet',
      'budget_lines/pbo/2566/20000.parquet',
      'budget_lines/pbo/2567/15000.parquet',
    ]);
    expect(summary.years).toEqual([2566, 2567, 2568]);
    expect(summary.ministryCodes).toEqual(['15000', '20000', '75000']);
  });

  it('array ว่าง → summary ว่างทั้งหมด', () => {
    expect(summarizeShardPaths([])).toEqual({
      datasets: [],
      years: [],
      ministryCodes: [],
      provinces: [],
    });
  });
});
