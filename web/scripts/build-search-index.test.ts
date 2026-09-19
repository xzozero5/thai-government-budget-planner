// @vitest-environment node
/**
 * T-208 — เทสต์ `build-search-index.mjs`: รันเป็น child process จริง ลง tmp dir เท่านั้น
 * (ห้ามเขียนลง `web/tests/fixtures/data/` หรือ `web/public/data/` จาก test)
 */
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BUILD_SCRIPT = path.resolve(process.cwd(), 'scripts/build-search-index.mjs');
const BUILD_SCRIPT_URL = pathToFileURL(BUILD_SCRIPT).href;
const FIXTURES_DATA_DIR = path.resolve(process.cwd(), 'tests/fixtures/data');

function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function seedDataDir(dir: string): void {
  mkdirSync(path.join(dir, 'catalog'), { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), readFileSync(path.join(FIXTURES_DATA_DIR, 'manifest.json')));
  writeFileSync(
    path.join(dir, 'catalog', 'items.json.gz'),
    readFileSync(path.join(FIXTURES_DATA_DIR, 'catalog', 'items.json.gz')),
  );
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(tmpdir(), `tgbp-build-search-index-test-${randomUUID()}`);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('build-search-index.mjs — --data-dir', () => {
  it('สร้าง items-slim.json.gz + search-index.json.gz ที่ผ่าน schema ของตัวเอง', () => {
    seedDataDir(tmpDir);
    const output = execFileSync(process.execPath, [BUILD_SCRIPT, '--data-dir', tmpDir], {
      encoding: 'utf8',
    });

    const slimPath = path.join(tmpDir, 'catalog', 'items-slim.json.gz');
    const indexPath = path.join(tmpDir, 'catalog', 'search-index.json.gz');

    const slim = JSON.parse(gunzipSync(readFileSync(slimPath)).toString('utf8')) as {
      schema_version: number;
      data_version: string;
      items: { i: number; key: string }[];
    };
    const index = JSON.parse(gunzipSync(readFileSync(indexPath)).toString('utf8')) as {
      schema_version: number;
      data_version: string;
      tokenizer_version: string;
      variant: string;
    };

    const manifest = JSON.parse(readFileSync(path.join(tmpDir, 'manifest.json'), 'utf8')) as {
      data_version: string;
    };

    expect(slim.schema_version).toBe(1);
    expect(slim.data_version).toBe(manifest.data_version);
    expect(slim.items.length).toBeGreaterThan(0);
    // `i` เป็นดัชนีเข้า catalog เต็ม — เรียงตามลำดับเดียวกับ items.json.gz (0..N-1 ต่อเนื่อง)
    expect(slim.items.map((it) => it.i)).toEqual(slim.items.map((_it, idx) => idx));

    expect(index.schema_version).toBe(1);
    expect(index.data_version).toBe(manifest.data_version);
    expect(index.variant).toBe('key_only');
    expect(index.tokenizer_version.length).toBeGreaterThan(0);

    // สคริปต์ต้อง print path/bytes/sha256 ของไฟล์ที่เขียนทั้งสอง
    expect(output).toContain('items-slim.json.gz');
    expect(output).toContain('search-index.json.gz');
    expect(output).toMatch(/sha256=[0-9a-f]{64}/);
  });

  it('deterministic: รันสองรอบด้วย input เดิม ได้ sha256 ของทั้งสองไฟล์เท่ากันทุกรอบ', () => {
    seedDataDir(tmpDir);
    execFileSync(process.execPath, [BUILD_SCRIPT, '--data-dir', tmpDir], { stdio: 'pipe' });
    const slimPath = path.join(tmpDir, 'catalog', 'items-slim.json.gz');
    const indexPath = path.join(tmpDir, 'catalog', 'search-index.json.gz');
    const slimSha1 = sha256Of(readFileSync(slimPath));
    const indexSha1 = sha256Of(readFileSync(indexPath));

    execFileSync(process.execPath, [BUILD_SCRIPT, '--data-dir', tmpDir], { stdio: 'pipe' });
    const slimSha2 = sha256Of(readFileSync(slimPath));
    const indexSha2 = sha256Of(readFileSync(indexPath));

    expect(slimSha2).toBe(slimSha1);
    expect(indexSha2).toBe(indexSha1);
  });

  it('รายงาน error ชัดเจนเมื่อ manifest.json ไม่มี data_version', () => {
    mkdirSync(path.join(tmpDir, 'catalog'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify({ schema_version: 1 }));
    writeFileSync(
      path.join(tmpDir, 'catalog', 'items.json.gz'),
      readFileSync(path.join(FIXTURES_DATA_DIR, 'catalog', 'items.json.gz')),
    );

    expect(() =>
      execFileSync(process.execPath, [BUILD_SCRIPT, '--data-dir', tmpDir], { stdio: 'pipe' }),
    ).toThrow();
  });
});

describe('build-search-index.mjs — parseArgs/resolveDataDir (import ตรง ๆ ไม่รัน main — ไม่มี side effect)', () => {
  it('--fixtures resolve เป็น web/tests/fixtures/data โดยไม่ต้องรันจริง (กันเขียนทับ fixtures จาก test)', async () => {
    const mod = (await import(BUILD_SCRIPT_URL)) as {
      parseArgs: (argv: string[]) => { dataDir?: string; fixtures: boolean; help: boolean };
      resolveDataDir: (args: { dataDir?: string; fixtures: boolean }) => string;
      WEB_DIR: string;
    };
    const args = mod.parseArgs(['--fixtures']);
    expect(args.fixtures).toBe(true);
    expect(mod.resolveDataDir(args)).toBe(path.join(mod.WEB_DIR, 'tests', 'fixtures', 'data'));
  });

  it('ไม่ระบุ flag ใด ๆ → default เป็น web/public/data', async () => {
    const mod = (await import(BUILD_SCRIPT_URL)) as {
      parseArgs: (argv: string[]) => { dataDir?: string; fixtures: boolean; help: boolean };
      resolveDataDir: (args: { dataDir?: string; fixtures: boolean }) => string;
      WEB_DIR: string;
    };
    const args = mod.parseArgs([]);
    expect(mod.resolveDataDir(args)).toBe(path.join(mod.WEB_DIR, 'public', 'data'));
  });

  it('--data-dir <path> ใช้ path ที่ระบุ (resolve จาก cwd)', async () => {
    const mod = (await import(BUILD_SCRIPT_URL)) as {
      parseArgs: (argv: string[]) => { dataDir?: string; fixtures: boolean; help: boolean };
      resolveDataDir: (args: { dataDir?: string; fixtures: boolean }) => string;
    };
    const args = mod.parseArgs(['--data-dir', 'some/custom/dir']);
    expect(args.dataDir).toBe('some/custom/dir');
    expect(mod.resolveDataDir(args)).toBe(path.resolve(process.cwd(), 'some/custom/dir'));
  });
});
