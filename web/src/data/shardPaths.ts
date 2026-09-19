/**
 * T-2xx (facade gap ที่ `ai/tools/queryBudgetLines.ts` รายงาน — ดูคอมเมนต์หัวไฟล์นั้น) — สรุปข้อมูล
 * dataset/ปีงบประมาณ/กระทรวง/จังหวัด จาก **รูปแบบชื่อ path** ของ shard parquet
 * (`docs/03-DATA-PIPELINE.md` §7) โดยไม่ต้องพึ่ง manifest หรือ fetch ใด ๆ — ใช้:
 * 1. `repo.ts` (`QueryTooBroadError`) — บอก AI ว่า shard ที่เกินเพดานมีปี/กระทรวงอะไรบ้าง เพื่อแนะนำ
 *    filter ให้แคบลง แทนที่จะรู้แค่ "จำนวน shard เกิน"
 * 2. `search.ts` (`getCatalogItem`/`getCatalogItemByKey`) ทางอ้อม ผ่าน field `shardPaths` ที่ resolve
 *    แล้ว — caller (เช่น tool) เรียก `summarizeShardPaths(item.shardPaths)` เองได้ต่อ
 *
 * เป็น pure function ล้วน (ไม่ import React, ไม่ fetch — module boundary เดียวกับไฟล์อื่นใน `data/**`)
 *
 * ข้อจำกัดที่ทราบ: path ของ `act2570_province/`, `local/`, `local_subsidy/` ใช้ **ascii slug** ของ
 * จังหวัด (ยืนยันใน `docs/03-DATA-PIPELINE.md` §3.1 "หมายเหตุ publish") ไม่ใช่ชื่อจังหวัดภาษาไทยที่
 * อ่านได้ตรง ๆ — ตาราง slug↔ชื่อจริงเป็นของ pipeline (`pipeline/**`) ไม่ได้ publish มาที่ฝั่งเว็บ จึงคืน
 * slug ดิบตามที่อยู่ใน path (ไม่ decode)
 */
import type { Dataset } from './types';

export interface ShardPathsSummary {
  datasets: Dataset[];
  years: number[];
  ministryCodes: string[];
  provinces: string[];
}

/** ชื่อโฟลเดอร์ระดับสองของ `budget_lines/<dir>/...` (docs/03 §7) → ค่า `Dataset` enum จริง */
const SHARD_DIR_TO_DATASET: Record<string, Dataset> = {
  pbo: 'pbo_disbursement',
  act2570: 'act_2570_draft',
  act2570_province: 'act_2570_province',
  local: 'local_ordinance_2570',
  local_subsidy: 'local_subsidy_2570',
  committee: 'committee_table',
};

/** ปีงบประมาณที่ตายตัวตามชื่อ dataset เอง ("...2570") — มีแค่ `pbo/{year}/...` เท่านั้นที่ปีอยู่ใน path
 * จริง ๆ ส่วน dataset อื่นเป็นข้อมูลของปีงบประมาณ 2570 เสมอ (ชื่อ dataset สะกดปีไว้ในตัวมันเอง) */
const FIXED_YEAR_BY_DIR: Partial<Record<string, number>> = {
  act2570: 2570,
  act2570_province: 2570,
  local: 2570,
  local_subsidy: 2570,
};

/** รหัสกระทรวงจริง (ตัวเลข) หรือ `_unmapped` (03 §3.1: "กระทรวงที่ map ไม่ได้อยู่ใต้ _unmapped") */
const MINISTRY_CODE_PATTERN = /^(?:\d+|_unmapped)$/;

function stripParquetExt(segment: string): string {
  return segment.endsWith('.parquet') ? segment.slice(0, -'.parquet'.length) : segment;
}

/** สรุปจาก path ของ shard (ไม่ใช้ manifest) → `{datasets, years, ministryCodes, provinces}` เรียงแล้ว
 * ทุก field (dedupe ด้วย Set) — path ที่ไม่ตรงรูปแบบที่รู้จัก (เช่นไม่ขึ้นต้นด้วย `budget_lines/`) ถูก
 * ข้ามอย่างเงียบ ๆ (ไม่ throw — ฟังก์ชันนี้แค่ "สรุปเท่าที่รู้" ไม่ใช่ validator) */
export function summarizeShardPaths(paths: readonly string[]): ShardPathsSummary {
  const datasets = new Set<Dataset>();
  const years = new Set<number>();
  const ministryCodes = new Set<string>();
  const provinces = new Set<string>();

  for (const path of paths) {
    const segments = path.split('/');
    const dir = segments[1];
    if (segments[0] !== 'budget_lines' || dir === undefined) {
      continue;
    }

    const dataset = SHARD_DIR_TO_DATASET[dir];
    if (dataset !== undefined) {
      datasets.add(dataset);
    }
    const fixedYear = FIXED_YEAR_BY_DIR[dir];
    if (fixedYear !== undefined) {
      years.add(fixedYear);
    }

    switch (dir) {
      case 'pbo': {
        const yearSeg = segments[2];
        const ministrySeg = segments[3];
        if (yearSeg !== undefined && /^\d{4}$/.test(yearSeg)) {
          years.add(Number(yearSeg));
        }
        if (ministrySeg !== undefined) {
          const code = stripParquetExt(ministrySeg);
          if (MINISTRY_CODE_PATTERN.test(code)) {
            ministryCodes.add(code);
          }
        }
        break;
      }
      case 'act2570': {
        const ministrySeg = segments[2];
        if (ministrySeg !== undefined) {
          const code = stripParquetExt(ministrySeg);
          if (MINISTRY_CODE_PATTERN.test(code)) {
            ministryCodes.add(code);
          }
        }
        break;
      }
      case 'act2570_province':
      case 'local_subsidy': {
        const provinceSeg = segments[2];
        if (provinceSeg !== undefined) {
          provinces.add(stripParquetExt(provinceSeg));
        }
        break;
      }
      case 'local': {
        const provinceSeg = segments[2];
        if (provinceSeg !== undefined) {
          provinces.add(provinceSeg);
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    datasets: [...datasets].sort(),
    years: [...years].sort((a, b) => a - b),
    ministryCodes: [...ministryCodes].sort(),
    provinces: [...provinces].sort(),
  };
}
