/**
 * (ฉ) shardPathsFor / coverageNotesFor / isSampleData
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coverageNotesFor,
  isSampleData,
  loadManifest,
  resetManifestCache,
  shardPathsFor,
} from '@/data/manifest';
import type { Manifest } from '@/data/types';
import { createFixtureFetch } from '@/data/testFixtures';

let manifest: Manifest;

beforeEach(async () => {
  resetManifestCache();
  manifest = await loadManifest(createFixtureFetch());
});

describe('isSampleData (T-202 ฉ)', () => {
  it('คืนค่าตาม manifest.sample', () => {
    expect(isSampleData(manifest)).toBe(true);
  });
});

describe('shardPathsFor (T-202 ฉ)', () => {
  it('กรองตาม dataset', () => {
    const paths = shardPathsFor(manifest, { dataset: 'pbo_disbursement' });
    expect(paths.length).toBe(9); // 3 ปี x 3 กระทรวง ตาม fixture
    expect(paths.every((p) => p.startsWith('budget_lines/pbo/'))).toBe(true);
  });

  it('กรองตาม dataset + fiscalYears', () => {
    const paths = shardPathsFor(manifest, {
      dataset: 'pbo_disbursement',
      fiscalYears: [2566],
    });
    expect(paths).toEqual([
      'budget_lines/pbo/2566/15000.parquet',
      'budget_lines/pbo/2566/20000.parquet',
      'budget_lines/pbo/2566/75000.parquet',
    ]);
  });

  it('กรองตาม ministryCodes', () => {
    const paths = shardPathsFor(manifest, {
      dataset: 'pbo_disbursement',
      ministryCodes: ['15000'],
    });
    expect(paths).toEqual([
      'budget_lines/pbo/2566/15000.parquet',
      'budget_lines/pbo/2567/15000.parquet',
      'budget_lines/pbo/2568/15000.parquet',
    ]);
  });

  it('กรองตาม province', () => {
    const paths = shardPathsFor(manifest, { province: 'เชียงใหม่' });
    expect(paths).toEqual([
      'budget_lines/act2570_province/echiyngaihm-af4ca2.parquet',
      'budget_lines/local/echiyngaihm-af4ca2/obch-echiyngaihm-ad3da7.parquet',
      'budget_lines/local_subsidy/echiyngaihm-af4ca2.parquet',
    ]);
  });

  it('ไม่ระบุเงื่อนไขเลย → คืนทุก path ใน manifest.files', () => {
    const paths = shardPathsFor(manifest, {});
    expect(paths.length).toBe(manifest.files.length);
  });

  it('เงื่อนไขที่ไม่ตรงกับไฟล์ใดเลย → คืน array ว่าง', () => {
    const paths = shardPathsFor(manifest, { province: 'ไม่มีจังหวัดนี้' });
    expect(paths).toEqual([]);
  });
});

describe('coverageNotesFor (T-202 ฉ)', () => {
  it('หา note ตาม dataset + fiscalYear ตรงเป๊ะ', () => {
    const notes = coverageNotesFor(manifest, {
      dataset: 'pbo_disbursement',
      fiscalYear: 2562,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.status).toBe('source_incomplete');
    expect(notes[0]?.decision_ref).toBe('ADR-004');
  });

  it('note ที่ไม่มี fiscal_year_be ถือว่าครอบคลุมทุกปีของ dataset นั้น', () => {
    const notes = coverageNotesFor(manifest, {
      dataset: 'committee_table',
      fiscalYear: 2566,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.status).toBe('org_unmapped');
  });

  it('ไม่ระบุ fiscalYear → คืนทุก note ของ dataset นั้น', () => {
    const notes = coverageNotesFor(manifest, { dataset: 'pbo_disbursement' });
    expect(notes.length).toBe(2); // 2562 source_incomplete + 2567 no_oracle
  });

  it('dataset ที่ไม่มี note เลย → คืน array ว่าง', () => {
    const notes = coverageNotesFor(manifest, { dataset: 'act_2570_draft' });
    expect(notes).toEqual([]);
  });
});
