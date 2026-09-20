/**
 * ทดสอบ `shardPaths` ที่เพิ่มเข้า `getCatalogItem`/`getCatalogItemByKey` (แก้ช่องว่างของ facade ที่
 * `ai/tools/queryBudgetLines.ts` รายงานไว้ — `CatalogItem.shards` เป็น index เข้า
 * `CatalogFile.shard_paths` แต่ facade เดิมไม่เปิดให้ resolve เป็น path จริง)
 *
 * ใช้ manifest/catalog จำลองขนาดเล็ก (ไม่พึ่ง production fixture) เพื่อควบคุม index/manifest ได้ตรง ๆ
 * สำหรับ edge case (index นอกช่วง, path ไม่อยู่ใน manifest)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetManifestCache } from './manifest';
import { getCatalogItem, getCatalogItemByKey, resetCatalogSearchCache } from './search';
import type { CatalogSlimFile } from './searchTypes';
import { fixtureRelPathFromUrl } from './testFixtures';
import type { CatalogFile, Manifest } from './types';

const DATA_VERSION = 'shard-paths-test-v1';

type CatalogItemRaw = CatalogFile['items'][number];

function manifestFile(path: string): Manifest['files'][number] {
  return {
    path,
    bytes: 1,
    sha256: 'a'.repeat(10),
    rows: null,
    dataset: null,
    fiscal_year_be: null,
    ministry_code: null,
    province: null,
  };
}

function makeManifest(paths: string[]): Manifest {
  return {
    schema_version: 1,
    data_version: DATA_VERSION,
    built_at: '1970-01-01T00:00:00+00:00',
    sample: true,
    totals: { files: paths.length, bytes: 0, rows_by_dataset: {} },
    files: paths.map(manifestFile),
    catalog_scope: 'test',
    coverage_notes: [],
    catalog_threshold: {
      min_lines: 0,
      min_years: 0,
      min_unit_price_distinct: 0,
      n_entries: 0,
      n_low_specificity: 0,
      thresholds_tried: [],
    },
  };
}

function baseItem(overrides: Partial<CatalogItemRaw>): CatalogItemRaw {
  return {
    key: 'ทดสอบ',
    name: 'ทดสอบเต็ม',
    n_lines: 10,
    years: [2567],
    top_agencies: [],
    sample_source_ids: [],
    shards: [],
    ...overrides,
  };
}

function makeCatalog(shardPaths: string[], items: CatalogItemRaw[]): CatalogFile {
  return { schema_version: 2, shard_paths: shardPaths, items };
}

function makeSlim(items: CatalogItemRaw[]): CatalogSlimFile {
  return {
    schema_version: 1,
    data_version: DATA_VERSION,
    items: items.map((item, i) => ({
      i,
      key: item.key,
      name: item.name,
      n_lines: item.n_lines,
      years: item.years,
      has_unit_price: item.unit_price !== undefined,
    })),
  };
}

function createMemoryFetch(files: Record<string, string>): typeof fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const relPath = fixtureRelPathFromUrl(url);
    const content = files[relPath];
    if (content === undefined) {
      return Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' }));
    }
    return Promise.resolve(new Response(content, { status: 200 }));
  };
}

function setupFetch(manifest: Manifest, catalog: CatalogFile, slim: CatalogSlimFile): typeof fetch {
  return createMemoryFetch({
    'manifest.json': JSON.stringify(manifest),
    'catalog/items.json.gz': JSON.stringify(catalog),
    'catalog/items-slim.json.gz': JSON.stringify(slim),
  });
}

beforeEach(() => {
  resetManifestCache();
  resetCatalogSearchCache();
});

afterEach(() => {
  resetManifestCache();
  resetCatalogSearchCache();
  vi.restoreAllMocks();
});

describe('getCatalogItem — shardPaths (resolve จาก shard_paths + validate กับ manifest)', () => {
  it('resolve เป็น path จริงถูกต้องเมื่อ index อยู่ในช่วงและ path อยู่ใน manifest.files', async () => {
    const shardPaths = ['budget_lines/pbo/2566/20000.parquet', 'budget_lines/pbo/2567/20000.parquet'];
    const item = baseItem({ shards: [0, 1] });
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));

    const full = await getCatalogItem(0, fetchImpl);
    expect(full.shardPaths).toEqual(shardPaths);
    // field เดิมของ CatalogItem ยังอยู่ครบ (เพิ่ม ไม่ใช่แทนที่)
    expect(full.key).toBe('ทดสอบ');
    expect(full.shards).toEqual([0, 1]);
  });

  it('index เกินช่วง shard_paths → ตัดทิ้ง index นั้น + console.warn (ไม่ throw)', async () => {
    const shardPaths = ['budget_lines/pbo/2566/20000.parquet'];
    const item = baseItem({ shards: [0, 5] }); // index 5 ไม่มีใน shard_paths (มีแค่ 1 ตัว)
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const full = await getCatalogItem(0, fetchImpl);
    expect(full.shardPaths).toEqual(shardPaths);
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('shard index 5'))).toBe(true);
  });

  it('path ที่ resolve ได้ไม่อยู่ใน manifest.files ปัจจุบัน → ตัดทิ้ง + console.warn', async () => {
    const knownPath = 'budget_lines/pbo/2566/20000.parquet';
    const staleShardPaths = [knownPath, 'budget_lines/pbo/2568/99999.parquet'];
    const item = baseItem({ shards: [0, 1] });
    // manifest มีแค่ path แรก — path ที่สองถือว่าเป็นข้อมูลค้างจาก build เก่า
    const fetchImpl = setupFetch(
      makeManifest([knownPath]),
      makeCatalog(staleShardPaths, [item]),
      makeSlim([item]),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const full = await getCatalogItem(0, fetchImpl);
    expect(full.shardPaths).toEqual([knownPath]);
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes('ไม่อยู่ใน manifest.files')),
    ).toBe(true);
  });

  it('ไม่มี shard เลย → shardPaths เป็น array ว่าง ไม่ warn เกี่ยวกับ shard resolution', async () => {
    const shardPaths = ['budget_lines/pbo/2566/20000.parquet'];
    const item = baseItem({ shards: [] });
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));
    // ตั้งใจไม่ mock console.warn: build-search-index สำหรับเทสต์นี้ไม่มี `search-index.json.gz`
    // (404 → fallback build ใน browser) ซึ่งเป็น warning ของโมดูลอื่นที่ไม่เกี่ยวกับ shardPaths — จับ
    // เฉพาะ warning ที่พูดถึง "shard" ของฟังก์ชัน `resolveItemShardPaths` เท่านั้น
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const full = await getCatalogItem(0, fetchImpl);
    expect(full.shardPaths).toEqual([]);
    expect(
      warnSpy.mock.calls.some(
        (call) => String(call[0]).includes('shard index') || String(call[0]).includes('manifest.files'),
      ),
    ).toBe(false);
  });
});

describe('getCatalogItemByKey — shardPaths ทั้งเส้นทาง slim-hit และ variant fallback', () => {
  it('key ตัวแทน (hit จาก slim โดยตรง) ได้ shardPaths', async () => {
    const shardPaths = ['budget_lines/act2570/15000.parquet'];
    const item = baseItem({ key: 'เครื่องปรับอากาศ', shards: [0] });
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));

    const found = await getCatalogItemByKey('เครื่องปรับอากาศ', fetchImpl);
    expect(found?.shardPaths).toEqual(shardPaths);
  });

  it('variant lookup (ต้องโหลด catalog เต็ม) ก็ได้ shardPaths เช่นกัน', async () => {
    const shardPaths = ['budget_lines/act2570/15000.parquet'];
    // slim เก็บ key ตัวแทน "กกก" — ผู้เรียกค้นด้วย variant "ก ก ก" (ต่างแค่ช่องว่าง) ซึ่งอยู่ใน `keys`
    const item = baseItem({ key: 'กกก', keys: ['ก ก ก'], shards: [0] });
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));

    const found = await getCatalogItemByKey('ก ก ก', fetchImpl);
    expect(found?.key).toBe('กกก');
    expect(found?.shardPaths).toEqual(shardPaths);
  });

  it('key ที่ไม่มีอยู่จริง → null (ไม่ error)', async () => {
    const shardPaths = ['budget_lines/act2570/15000.parquet'];
    const item = baseItem({ shards: [0] });
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));

    const found = await getCatalogItemByKey('ไม่มีอยู่จริงแน่ๆ xyz', fetchImpl);
    expect(found).toBeNull();
  });

  // T-604(A): variant ที่ต่างกันแค่ตำแหน่งช่องว่าง (ไม่ใช่แค่ "collapse ช่องว่างซ้ำเป็นตัวเดียว" ที่โค้ด
  // เดิมทำอยู่แล้ว) ที่ pipeline ไม่ได้เก็บไว้ใน `keys[]` (จำกัดจำนวน variant ต่อกลุ่ม) — ต้อง normalize
  // แบบตัด whitespace ทั้งหมด (เดียวกับ `compute_group_key` ของ pipeline) ก่อนถึงจะเจอ
  it('variant ที่ต่างตำแหน่งช่องว่าง (ไม่อยู่ใน keys[]) → เจอผ่าน group-key normalize (ตัด whitespace ทั้งหมด)', async () => {
    const shardPaths = ['budget_lines/act2570/15000.parquet'];
    // key ตัวแทนเว้นวรรคตำแหน่งหนึ่ง — โมเดลพิมพ์เว้นวรรคคนละตำแหน่ง (ไม่ใช่ variant ที่ถูกเก็บใน keys[])
    const item = baseItem({ key: 'โน้ตบุ๊ก สำหรับงานประมวลผล', shards: [0] });
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));

    const found = await getCatalogItemByKey('โน้ตบุ๊กสำหรับ งานประมวลผล', fetchImpl);
    expect(found?.key).toBe('โน้ตบุ๊ก สำหรับงานประมวลผล');
    expect(found?.shardPaths).toEqual(shardPaths);
  });

  it('ต่างกันด้วยอักขระอื่นที่ไม่ใช่ whitespace (เช่นวงเล็บ) → group-key normalize ยังจับไม่ได้ (คืน null ตามเดิม — ต้องพึ่ง search_catalog แทน)', async () => {
    const shardPaths = ['budget_lines/act2570/15000.parquet'];
    const item = baseItem({ key: 'รถบรรทุก ดีเซล ขนาด 1 ตัน', shards: [0] });
    const fetchImpl = setupFetch(makeManifest(shardPaths), makeCatalog(shardPaths, [item]), makeSlim([item]));

    const found = await getCatalogItemByKey('รถบรรทุก (ดีเซล) ขนาด 1 ตัน', fetchImpl);
    expect(found).toBeNull();
  });
});
