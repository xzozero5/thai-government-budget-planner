/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DUCKDB_EXTENSION_FILENAME,
  DUCKDB_EXTENSION_VERSION_PATH,
  EXPECTED_DUCKDB_WASM_PACKAGE_VERSION,
  MAX_REGISTERED_SHARD_BYTES,
  MAX_REGISTERED_SHARDS,
  __setDuckDbDepsForTests,
  ensureShardRegistered,
  ensureShardsRegistered,
  getDb,
  getRegisteredShardUrlsForTests,
  prefetchDb,
  resetDuckDbForTests,
  type DuckDbProgress,
} from './duckdb';
import { MAX_SHARDS_TO_SCAN } from './repo';
import { createFakeDuckDbDeps, FakeAsyncDuckDb } from './duckdbTestDoubles';

afterEach(() => {
  resetDuckDbForTests();
});

// ---------------------------------------------------------------------------
// version-mapping test (ADR-002 ข้อ 2 — บังคับ): ต้อง fail ถ้าเวอร์ชัน @duckdb/duckdb-wasm ใน
// package.json เปลี่ยนโดยไม่มีใครอัปเดตค่าคงที่/ไฟล์ extension ให้ตรงกัน
// ---------------------------------------------------------------------------
describe('เวอร์ชัน @duckdb/duckdb-wasm ต้องผูกกับ extension ที่ vendor ไว้เสมอ (ADR-002)', () => {
  it('package.json ระบุเวอร์ชันตรงกับ EXPECTED_DUCKDB_WASM_PACKAGE_VERSION', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    const installedVersion = pkg.dependencies?.['@duckdb/duckdb-wasm'];
    expect(
      installedVersion,
      'อัปเดต @duckdb/duckdb-wasm แล้วต้องตรวจ duckdb engine version ใหม่และแก้ ' +
        'EXPECTED_DUCKDB_WASM_PACKAGE_VERSION + DUCKDB_EXTENSION_VERSION_PATH ใน duckdb.ts พร้อมกัน ' +
        '(ดู web/public/duckdb-ext/README.md)',
    ).toBe(EXPECTED_DUCKDB_WASM_PACKAGE_VERSION);
  });

  it('ไฟล์ extension ที่ vendor ไว้มีอยู่จริงตาม DUCKDB_EXTENSION_VERSION_PATH', () => {
    const extPath = path.resolve(
      process.cwd(),
      'public',
      'duckdb-ext',
      DUCKDB_EXTENSION_VERSION_PATH,
      'wasm_eh',
      DUCKDB_EXTENSION_FILENAME,
    );
    const bytes = readFileSync(extPath);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// init flow: config ที่ส่งให้ .open() + ลำดับคำสั่ง setup extension (ADR-002 ข้อ 1, 2)
// ---------------------------------------------------------------------------
describe('getDb() / init flow', () => {
  it('เปิดด้วย filesystem config ตาม ADR-002 ข้อ 1 เป๊ะ (ไม่ใช้ค่า default ของ library)', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));

    await getDb();

    expect(fakeDb.instantiateCalled).toBe(true);
    expect(fakeDb.openConfig?.filesystem).toEqual({
      forceFullHTTPReads: false,
      allowFullHTTPReads: true,
      reliableHeadRequests: true,
    });
    expect(fakeDb.openConfig?.query).toEqual({ castBigIntToDouble: true });
    expect(fakeDb.openConfig?.allowUnsignedExtensions).toBe(false);
  });

  it('สั่ง SET memory_limit + self-host custom_extension_repository + INSTALL/LOAD parquet ตามลำดับ', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));

    await getDb();

    const setupSql = fakeDb.connection.calls.filter((c) => c.kind === 'query').map((c) => c.sql);
    expect(setupSql[0]).toMatch(/^SET memory_limit = '/);
    expect(setupSql[1]).toMatch(/^SET custom_extension_repository = '/);
    expect(setupSql[1]).toContain('duckdb-ext');
    // ต้องเป็น absolute URL (same-origin) ไม่ใช่ path เปล่า — ADR-002: "absolute same-origin URL"
    expect(setupSql[1]).toMatch(/'https?:\/\/[^']+duckdb-ext'/);
    expect(setupSql[2]).toBe('INSTALL parquet');
    expect(setupSql[3]).toBe('LOAD parquet');
  });

  it('เป็น singleton — เรียกซ้ำไม่สร้าง worker/instantiate ใหม่', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    let factoryCalls = 0;
    const deps = createFakeDuckDbDeps(fakeDb);
    __setDuckDbDepsForTests({
      ...deps,
      loadFactory: () => {
        factoryCalls += 1;
        return deps.loadFactory();
      },
    });

    await getDb();
    await getDb();
    await getDb();

    expect(factoryCalls).toBe(1);
  });

  it('prefetchDb ส่ง progress ไปจนถึง ready และ resolve โดยไม่ throw', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
    const phases: DuckDbProgress['phase'][] = [];

    await prefetchDb((p) => phases.push(p.phase));

    expect(phases).toContain('downloading-wasm');
    expect(phases).toContain('opening');
    expect(phases).toContain('installing-extension');
    expect(phases.at(-1)).toBe('ready');
  });

  it('init ล้มเหลว → ไม่ cache promise ที่ fail (เรียกซ้ำแล้ว retry ได้)', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    const deps = createFakeDuckDbDeps(fakeDb);
    let attempt = 0;
    __setDuckDbDepsForTests({
      ...deps,
      loadEhWasmUrl: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error('เน็ตหลุดตอนโหลด wasm'));
        }
        return deps.loadEhWasmUrl();
      },
    });

    await expect(getDb()).rejects.toThrow();
    await expect(getDb()).resolves.toBeDefined();
    expect(attempt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// LRU / evict ของ full-mode shard registration (ADR-002 ข้อ 5, 04 §5)
// ---------------------------------------------------------------------------
describe('ensureShardRegistered — LRU eviction', () => {
  function fakeFetch(byteSize: number): typeof fetch {
    return () => Promise.resolve(new Response(new Uint8Array(byteSize), { status: 200 }));
  }

  it('evict ตัวที่ใช้นานสุดก่อนเมื่อจำนวนไฟล์เกิน MAX_REGISTERED_SHARDS', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
    const fetchImpl = fakeFetch(1024);

    const urls = Array.from(
      { length: MAX_REGISTERED_SHARDS + 3 },
      (_, i) => `https://example.test/data/shard-${String(i)}.parquet`,
    );
    for (const url of urls) {
      // ต้อง register ทีละไฟล์ตามลำดับเวลาจริง (ไม่ใช่ Promise.all) เพื่อทดสอบลำดับ LRU
      await ensureShardRegistered(url, fetchImpl);
    }

    expect(fakeDb.registeredBuffers.size).toBeLessThanOrEqual(MAX_REGISTERED_SHARDS);
    // 3 ไฟล์แรก (เก่าสุด) ต้องถูก evict ก่อน
    expect(fakeDb.droppedFiles.slice(0, 3)).toEqual(urls.slice(0, 3));
    expect(getRegisteredShardUrlsForTests()).toEqual(
      urls.slice(urls.length - MAX_REGISTERED_SHARDS),
    );
  });

  it('evict ตาม MAX_REGISTERED_SHARD_BYTES แม้จำนวนไฟล์ยังไม่ถึงเพดาน', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
    const bigSize = Math.floor(MAX_REGISTERED_SHARD_BYTES / 2) + 1024;

    await ensureShardRegistered('https://example.test/data/a.parquet', fakeFetch(bigSize));
    await ensureShardRegistered('https://example.test/data/b.parquet', fakeFetch(bigSize));
    await ensureShardRegistered('https://example.test/data/c.parquet', fakeFetch(bigSize));

    expect(fakeDb.droppedFiles).toContain('https://example.test/data/a.parquet');
    expect(fakeDb.registeredBuffers.size).toBeLessThan(3);
  });

  it('register ซ้ำ url เดิม = แค่ touch LRU ไม่ fetch ซ้ำ', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
    let fetchCount = 0;
    const fetchImpl = (() => {
      fetchCount += 1;
      return Promise.resolve(new Response(new Uint8Array(10), { status: 200 }));
    }) as unknown as typeof fetch;

    await ensureShardRegistered('https://example.test/data/x.parquet', fetchImpl);
    await ensureShardRegistered('https://example.test/data/x.parquet', fetchImpl);

    expect(fetchCount).toBe(1);
  });

  it('T-206 F7: MAX_REGISTERED_SHARDS ต้อง >= repo.MAX_SHARDS_TO_SCAN เสมอ', () => {
    expect(MAX_REGISTERED_SHARDS).toBeGreaterThanOrEqual(MAX_SHARDS_TO_SCAN);
  });

  it('T-206 F7: ensureShardsRegistered pin ทั้งชุด — register ครบ MAX_SHARDS_TO_SCAN ไฟล์สองรอบติดกัน ไม่มี re-register/evict กลาง query', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
    let fetchCount = 0;
    const fetchImpl = (() => {
      fetchCount += 1;
      return Promise.resolve(new Response(new Uint8Array(1024), { status: 200 }));
    }) as unknown as typeof fetch;
    const urls = Array.from(
      { length: MAX_SHARDS_TO_SCAN },
      (_, i) => `https://example.test/data/pin-${String(i)}.parquet`,
    );

    await ensureShardsRegistered(urls, fetchImpl);
    expect(fakeDb.registeredBuffers.size).toBe(MAX_SHARDS_TO_SCAN);
    expect(fakeDb.droppedFiles).toEqual([]);

    // รอบสอง (เช่น จังหวะที่ 2 ของ two-phase query เดียวกันเรียก register ซ้ำ) — ต้องไม่ evict ตัวเอง
    await ensureShardsRegistered(urls, fetchImpl);
    expect(fakeDb.registeredBuffers.size).toBe(MAX_SHARDS_TO_SCAN);
    expect(fakeDb.droppedFiles).toEqual([]);
    // รอบสองแค่ touch LRU ไม่ fetch ซ้ำ
    expect(fetchCount).toBe(MAX_SHARDS_TO_SCAN);
  });

  it('โยน DuckDbQueryError ที่มีข้อความไทยเมื่อเซิร์ฟเวอร์ตอบไม่ ok', async () => {
    const fakeDb = new FakeAsyncDuckDb();
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
    const fetchImpl = (() =>
      Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch;

    await expect(
      ensureShardRegistered('https://example.test/data/missing.parquet', fetchImpl),
    ).rejects.toThrow(/โหลดไฟล์ shard แบบเต็มไฟล์ไม่สำเร็จ/);
  });
});
