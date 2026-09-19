// @vitest-environment node
/**
 * T-204/T-208/T-206 F9 — เทสต์คุณภาพ + เวลาโหลด/query กับ catalog **production จริง**
 * (`web/public/data`) ตาม 5 คำค้นใน `docs/decisions/SPIKES.md` §S2 — skip ทั้งชุดถ้าไม่มีไฟล์
 * (เครื่อง CI ไม่มี data จริง)
 */
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCatalogItem, loadCatalogSearch, resetCatalogSearchCache, searchCatalog } from '@/data/search';
import { resetManifestCache } from '@/data/manifest';
import { fixtureRelPathFromUrl } from '@/data/testFixtures';

const PROD_DATA_DIR = path.resolve(process.cwd(), 'public/data');
const hasProdData =
  existsSync(path.join(PROD_DATA_DIR, 'manifest.json')) &&
  existsSync(path.join(PROD_DATA_DIR, 'catalog', 'items.json.gz')) &&
  existsSync(path.join(PROD_DATA_DIR, 'catalog', 'items-slim.json.gz')) &&
  existsSync(path.join(PROD_DATA_DIR, 'catalog', 'search-index.json.gz'));

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

/** งบเวลาต่อ query ใน Node (04 §5) — main thread ต้องรายงานตัวเลขจริงในรายงานปิดงาน T-206 */
// runner ของ GitHub Actions (shared, 2 vCPU) วัดได้ ~75 ms กับ query เดียวกันที่เครื่อง dev ได้ < 20 ms →
// บน CI ใช้เพดานหลวมขึ้นเพื่อจับ regression ระดับเท่าตัว (เช่น Intl.Segmenter ต่อ hit = 230–360 ms)
// โดยไม่ flaky; งบจริง 50 ms ยังบังคับบนเครื่อง dev
const MAX_QUERY_MS = process.env['CI'] ? 150 : 50;

// 5 คำค้นจาก docs/decisions/SPIKES.md §S2 + substring ที่ยอมรับว่า "เกี่ยวข้อง" (assert แบบ contains)
const QUALITY_CASES: { query: string; expectContainsAny: string[] }[] = [
  { query: 'แอร์ 18000 บีทียู', expectContainsAny: ['แอร์', 'เครื่องปรับอากาศ'] },
  { query: 'รถบรรทุกดีเซล 1 ตัน', expectContainsAny: ['รถบรรทุก'] },
  { query: 'ฝาย', expectContainsAny: ['ฝาย'] },
  { query: 'วิทยุสื่อสาร', expectContainsAny: ['วิทยุสื่อสาร'] },
  { query: 'กล้องวงจรปิด', expectContainsAny: ['กล้องวงจรปิด', 'กล้องโทรทัศน์วงจรปิด'] },
];

describe.skipIf(!hasProdData)('search คุณภาพกับ catalog production จริง (web/public/data)', () => {
  it('load ครั้งแรก (fetch+gunzip+loadJS) และ query ทั้ง 5 คำ — รายงานเวลาที่วัดได้จริงใน Node (ต้อง < 50 ms ต่อคำ)', async () => {
    resetCatalogSearchCache();
    resetManifestCache();
    const fetchImpl = createDirFetch(PROD_DATA_DIR);

    const tLoadStart = performance.now();
    await loadCatalogSearch(fetchImpl);
    const loadMs = performance.now() - tLoadStart;
    console.log(`[search.production] load ms = ${loadMs.toFixed(1)}`);

    for (const { query, expectContainsAny } of QUALITY_CASES) {
      const tQueryStart = performance.now();
      const { matches: results } = await searchCatalog(query, { limit: 5 }, fetchImpl);
      const queryMs = performance.now() - tQueryStart;
      console.log(
        `[search.production] query="${query}" ms=${queryMs.toFixed(2)} top5=${results
          .map((r) => r.item.key)
          .join(' | ')}`,
      );

      expect(results.length).toBeGreaterThan(0);
      expect(queryMs, `query="${query}" ใช้เวลา ${queryMs.toFixed(2)} ms เกินงบ ${String(MAX_QUERY_MS)} ms`).toBeLessThan(
        MAX_QUERY_MS,
      );
      const top5Keys = results.slice(0, 5).map((r) => r.item.key);
      const matchedAny = top5Keys.some((key) => expectContainsAny.some((needle) => key.includes(needle)));
      expect(
        matchedAny,
        `query="${query}" top5=${JSON.stringify(top5Keys)} ไม่มี key ที่มี substring ใด ๆ ใน ${JSON.stringify(expectContainsAny)}`,
      ).toBe(true);
    }
  });

  // T-206 F9: เคสที่ main thread สั่งเพิ่ม — top-1 ต้อง "ครอบคลุมคำค้น" จริง (มีทั้งสองคำ ไม่ใช่แค่
  // ตรวจว่า top-5 มีคำใดคำหนึ่ง ซึ่งเป็นการทดสอบที่อ่อนเกินไปตามที่ T-206-review ชี้ไว้)
  it('"ก่อสร้างอาคาร" → top-1 ต้องมีทั้ง "ก่อสร้าง" และ "อาคาร" ใน key (ไม่ใช่แค่คำใดคำหนึ่ง)', async () => {
    resetCatalogSearchCache();
    resetManifestCache();
    const fetchImpl = createDirFetch(PROD_DATA_DIR);
    await loadCatalogSearch(fetchImpl); // warm up (โหลด index ครั้งแรก) ก่อนจับเวลา query จริง

    const tQueryStart = performance.now();
    const { matches: results } = await searchCatalog('ก่อสร้างอาคาร', { limit: 5 }, fetchImpl);
    const queryMs = performance.now() - tQueryStart;
    console.log(
      `[search.production] query="ก่อสร้างอาคาร" ms=${queryMs.toFixed(2)} top5=${results
        .map((r) => `${r.item.key} (n_lines=${String(r.item.n_lines)}, score=${r.score.toFixed(3)})`)
        .join(' | ')}`,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(queryMs).toBeLessThan(MAX_QUERY_MS);
    const top1 = results[0];
    if (top1 === undefined) {
      throw new Error('คาดว่าต้องมีผลลัพธ์อย่างน้อย 1 รายการ');
    }
    expect(top1.item.key).toContain('ก่อสร้าง');
    expect(top1.item.key).toContain('อาคาร');
  });

  it('getCatalogItem ใช้ index จริงจากผลค้นหาได้ (โหลด catalog เต็มแบบ lazy)', async () => {
    resetCatalogSearchCache();
    resetManifestCache();
    const fetchImpl = createDirFetch(PROD_DATA_DIR);
    const { matches: results } = await searchCatalog('กล้องวงจรปิด', { limit: 1 }, fetchImpl);
    const first = results[0];
    if (first === undefined) {
      throw new Error('คาดว่า searchCatalog ต้องเจอผลลัพธ์อย่างน้อย 1 รายการ');
    }
    const full = await getCatalogItem(first.item.i, fetchImpl);
    expect(full.key).toBe(first.item.key);
  });
});
