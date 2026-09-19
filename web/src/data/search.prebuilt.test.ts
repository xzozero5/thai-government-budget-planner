// @vitest-environment node
//
// ใช้ 'node' environment: รัน `web/scripts/build-search-index.mjs` เป็น child process ที่แท้จริง
// (ยืนยันว่าไฟล์ที่ script สร้างจริงโหลดกลับได้ใน `data/search.ts`) — เขียนลง **tmp dir เท่านั้น**
// ห้ามเขียนลง `web/tests/fixtures/data/` หรือ `web/public/data/` จาก test (ตามขอบเขตงาน)
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetManifestCache } from '@/data/manifest';
import {
  getCatalogItem,
  loadCatalogSearch,
  resetCatalogSearchCache,
  searchCatalog,
  SEARCH_CATALOG_MAX_LIMIT,
  TOKENIZER_VERSION,
} from '@/data/search';
import { fixtureRelPathFromUrl, FIXTURES_DATA_DIR } from '@/data/testFixtures';

const BUILD_SCRIPT = path.resolve(process.cwd(), 'scripts/build-search-index.mjs');

function createDirFetch(baseDir: string): typeof fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const relPath = fixtureRelPathFromUrl(url);
    const filePath = path.join(baseDir, relPath);
    if (!existsSync(filePath)) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return Promise.resolve(new Response(readFileSync(filePath), { status: 200 }));
  };
}

let tmpDataDir: string;
let searchIndexPath: string;

beforeAll(() => {
  tmpDataDir = path.join(tmpdir(), `tgbp-search-prebuilt-test-${randomUUID()}`);
  mkdirSync(path.join(tmpDataDir, 'catalog'), { recursive: true });
  writeFileSync(
    path.join(tmpDataDir, 'manifest.json'),
    readFileSync(path.join(FIXTURES_DATA_DIR, 'manifest.json')),
  );
  writeFileSync(
    path.join(tmpDataDir, 'catalog', 'items.json.gz'),
    readFileSync(path.join(FIXTURES_DATA_DIR, 'catalog', 'items.json.gz')),
  );
  execFileSync(process.execPath, [BUILD_SCRIPT, '--data-dir', tmpDataDir], { stdio: 'pipe' });
  searchIndexPath = path.join(tmpDataDir, 'catalog', 'search-index.json.gz');
});

afterAll(() => {
  rmSync(tmpDataDir, { recursive: true, force: true });
});

afterEach(() => {
  resetCatalogSearchCache();
  resetManifestCache();
  vi.restoreAllMocks();
});

describe('loadCatalogSearch — โหลด prebuilt index จริง (build ด้วย build-search-index.mjs)', () => {
  it('โหลดสำเร็จโดยไม่ warn (version ตรงกันทุกอย่าง)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = createDirFetch(tmpDataDir);
    await loadCatalogSearch(fetchImpl);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ค้นหาได้ผลลัพธ์ที่ถูกต้อง (key ที่มีจริงใน fixture)', async () => {
    const fetchImpl = createDirFetch(tmpDataDir);
    const results = await searchCatalog('กล้องวงจรปิด', {}, fetchImpl);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.item.key).toContain('กล้องโทรทัศน์วงจรปิด');
  });

  it('filter ปี (`years`) ตัดรายการที่ไม่มีปีนั้นออก', async () => {
    const fetchImpl = createDirFetch(tmpDataDir);
    // "ค่าจัดการเรียนการสอน" มีปี [2566,2567,2568,2570] — ปี 2569 ไม่มี
    const withYear = await searchCatalog('ค่าจัดการเรียนการสอน', { years: [2567] }, fetchImpl);
    const withoutYear = await searchCatalog('ค่าจัดการเรียนการสอน', { years: [2569] }, fetchImpl);
    expect(withYear.some((m) => m.item.key === 'ค่าจัดการเรียนการสอน')).toBe(true);
    expect(withoutYear.some((m) => m.item.key === 'ค่าจัดการเรียนการสอน')).toBe(false);
  });

  it('filter `requireUnitPrice` เก็บเฉพาะ item ที่มีสถิติ unit_price', async () => {
    const fetchImpl = createDirFetch(tmpDataDir);
    const results = await searchCatalog('กล้องวงจรปิด', { requireUnitPrice: true }, fetchImpl);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.item.has_unit_price).toBe(true);
    }
  });

  it('`low_specificity` ถูกส่งต่อมาใน SearchMatch ตาม slim item', async () => {
    const fetchImpl = createDirFetch(tmpDataDir);
    const results = await searchCatalog('ค่าจัดการเรียนการสอน', {}, fetchImpl);
    const match = results.find((m) => m.item.key === 'ค่าจัดการเรียนการสอน');
    expect(match?.lowSpecificity).toBe(true);
  });

  it('limit ถูก clamp ไม่ให้เกิน SEARCH_CATALOG_MAX_LIMIT แม้ขอเยอะกว่านั้น', async () => {
    const fetchImpl = createDirFetch(tmpDataDir);
    // query กว้าง ๆ ที่น่าจะ match หลายรายการ (คำว่า "เงินอุดหนุน" ปรากฏใน key จำนวนมากใน fixture)
    const results = await searchCatalog('เงินอุดหนุน', { limit: 999 }, fetchImpl);
    expect(results.length).toBeLessThanOrEqual(SEARCH_CATALOG_MAX_LIMIT);
  });

  it('getCatalogItem คืน CatalogItem เต็ม (มี sample_source_ids/shards) — โหลด items.json.gz เต็มแบบ lazy', async () => {
    const fetchImpl = createDirFetch(tmpDataDir);
    const results = await searchCatalog('กล้องวงจรปิด', {}, fetchImpl);
    const first = results[0];
    if (first === undefined) {
      throw new Error('คาดว่า searchCatalog ต้องเจอผลลัพธ์อย่างน้อย 1 รายการ');
    }
    const full = await getCatalogItem(first.item.i, fetchImpl);
    expect(full.key).toBe(first.item.key);
    expect(full.sample_source_ids.length).toBeGreaterThan(0);
    expect(Array.isArray(full.shards)).toBe(true);
  });

  it('getCatalogItem โยน error ชัดเจนเมื่อ index เกินขอบเขต', async () => {
    const fetchImpl = createDirFetch(tmpDataDir);
    await expect(getCatalogItem(999999, fetchImpl)).rejects.toThrow(/ไม่พบ catalog item/);
  });
});

describe('version mismatch → fallback build ใน browser', () => {
  function readIndexWrapper(): Record<string, unknown> {
    return JSON.parse(gunzipSync(readFileSync(searchIndexPath)).toString('utf8')) as Record<string, unknown>;
  }

  function writeIndexWrapper(wrapper: Record<string, unknown>): void {
    writeFileSync(searchIndexPath, gzipSync(Buffer.from(JSON.stringify(wrapper))));
  }

  it('tokenizer_version ไม่ตรง → warn แล้ว fallback build เอง แต่ยังค้นหาได้ถูกต้อง', async () => {
    const original = readIndexWrapper();
    expect(original['tokenizer_version']).toBe(TOKENIZER_VERSION);
    writeIndexWrapper({ ...original, tokenizer_version: 'some-old-version' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = createDirFetch(tmpDataDir);
    const results = await searchCatalog('กล้องวงจรปิด', {}, fetchImpl);

    expect(warnSpy).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.item.key).toContain('กล้องโทรทัศน์วงจรปิด');

    writeIndexWrapper(original); // คืนค่าเดิมกันกระทบเทสต์อื่นที่ใช้ tmpDataDir เดียวกัน
  });

  it('data_version ไม่ตรงกับ manifest → warn แล้ว fallback build เอง', async () => {
    const original = readIndexWrapper();
    writeIndexWrapper({ ...original, data_version: 'not-the-real-data-version' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = createDirFetch(tmpDataDir);
    await loadCatalogSearch(fetchImpl);

    expect(warnSpy).toHaveBeenCalled();

    writeIndexWrapper(original);
  });

  it('ไฟล์ search-index.json.gz หายไปทั้งไฟล์ → warn แล้วยัง build+ค้นหาได้จากไฟล์ slim', async () => {
    const original = readFileSync(searchIndexPath);
    rmSync(searchIndexPath);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = createDirFetch(tmpDataDir);
    const results = await searchCatalog('กล้องวงจรปิด', {}, fetchImpl);

    expect(warnSpy).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);

    writeFileSync(searchIndexPath, original);
  });
});
