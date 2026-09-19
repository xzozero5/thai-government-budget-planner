// @vitest-environment node
//
// เหตุผลที่บังคับ environment เป็น 'node' เฉพาะไฟล์นี้ (แทน 'jsdom' ที่ตั้ง global ไว้ใน
// vite.config.ts): jsdom แทนที่ global `ArrayBuffer`/`Uint8Array` ด้วย constructor ของ jsdom เอง
// (คนละ realm กับที่ Node core module เช่น `fs`/`buffer` ใช้ภายใน) ทำให้ hyparquet ซึ่งเช็ค
// `instanceof ArrayBuffer` กับ ArrayBuffer ที่ `asyncBufferFromFile` อ่านจากดิสก์ (native Node
// realm) ล้มเหลวเสมอ ("parquet expected ArrayBuffer") — ไฟล์นี้ไม่แตะ DOM จึงไม่ต้องใช้ jsdom
/**
 * (ข) คอลัมน์ของ parquet ใน fixture ครบและชนิดตรงกับ BudgetLine ทุก shard
 *
 * hyparquet เป็น devDependency สำหรับ test เท่านั้น (ไม่ bundle เข้าแอป — ยังไม่ติดตั้ง
 * @duckdb/duckdb-wasm ตาม T-202 ข้อ 1) — ใช้ตรวจว่า schema จริงของ parquet ตรงกับ BudgetLineSchema
 * หลังแปลง bigint (int64) → number ที่ boundary ตามที่ตัดสินใจไว้ใน types.ts
 */
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { describe, expect, it } from 'vitest';
import { BUDGET_LINE_COLUMNS, BudgetLineSchema } from '@/data/types';
import { fixtureFilePath, listFixtureFiles } from '@/data/testFixtures';

const BIGINT_MONEY_COLUMNS = [
  'amount_thb',
  'unit_price_thb',
  'revised_thb',
  'po_thb',
  'disbursed_thb',
  'disbursed_incl_po_thb',
  'reserved_thb',
  'carryover_thb',
] as const;

/** แปลง bigint (parquet int64) → number ที่ boundary ก่อนเข้า BudgetLineSchema (ดูคอมเมนต์ types.ts) */
function toBudgetLineInput(row: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = { ...row };
  for (const col of BIGINT_MONEY_COLUMNS) {
    const value = converted[col];
    if (typeof value === 'bigint') {
      converted[col] = Number(value);
    }
  }
  return converted;
}

const shardPaths = listFixtureFiles('budget_lines', '.parquet');

describe('budget_lines/*.parquet ↔ BudgetLineSchema (T-202 ข)', () => {
  it('มี parquet shard ให้ทดสอบจริง (ไม่ใช่ลิสต์ว่าง)', () => {
    expect(shardPaths.length).toBeGreaterThan(0);
  });

  it.each(shardPaths)('%s: คอลัมน์ครบและชนิดตรงกับ BudgetLine ทุกแถว', async (relPath) => {
    const file = await asyncBufferFromFile(fixtureFilePath(relPath));
    const rows = await parquetReadObjects({ file, compressors });
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      // ชุดคอลัมน์ต้องตรงกับ BudgetLineSchema เป๊ะ (ไม่ขาด ไม่เกิน)
      expect(new Set(Object.keys(row))).toEqual(new Set(BUDGET_LINE_COLUMNS));

      const input = toBudgetLineInput(row as Record<string, unknown>);
      const result = BudgetLineSchema.safeParse(input);
      if (!result.success) {
        throw new Error(
          `${relPath} source_id=${String(row['source_id'])} ไม่ตรง BudgetLineSchema: ${result.error.message}`,
        );
      }
    }
  });
});
