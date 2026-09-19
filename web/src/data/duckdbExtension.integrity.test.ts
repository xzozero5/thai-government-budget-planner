// @vitest-environment node
/**
 * T-307 M7: ไฟล์ parquet extension ที่ self-host (ADR-002) ต้องเป็นไฟล์เดียวกับที่บันทึกไว้ —
 * main thread ยืนยัน sha256 นี้กับ `extensions.duckdb.org` โดยตรงเมื่อ 20 ก.ย. 2569
 * ถ้าอัปเกรด `@duckdb/duckdb-wasm` ต้องอัปเดตทั้งไฟล์, README และค่าด้านล่างพร้อมกัน
 */
/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUCKDB_EXTENSION_VERSION_PATH } from '@/data/duckdb';

const EXPECTED_SHA256 = '22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55';
const EXPECTED_BYTES = 3_045_039;

describe('duckdb parquet extension (self-hosted)', () => {
  const file = path.resolve(
    process.cwd(),
    'public/duckdb-ext',
    DUCKDB_EXTENSION_VERSION_PATH,
    'wasm_eh/parquet.duckdb_extension.wasm',
  );

  it('sha256 และขนาดตรงกับค่าที่ยืนยันกับแหล่งทางการ', () => {
    const buf = readFileSync(file);
    expect(buf.length).toBe(EXPECTED_BYTES);
    expect(createHash('sha256').update(buf).digest('hex')).toBe(EXPECTED_SHA256);
  });

  it('README บันทึก sha256 เดียวกัน', () => {
    const readme = readFileSync(path.resolve(process.cwd(), 'public/duckdb-ext/README.md'), 'utf8');
    expect(readme).toContain(EXPECTED_SHA256);
  });
});
