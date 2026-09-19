/**
 * T-204 — เทสต์คุณภาพการ match/rank ของ MiniSearch + `catalogMiniSearchOptions` โดยตรง (สร้าง index
 * เล็ก ๆ ในหน่วยความจำ ไม่ต้องผ่าน fetch/gzip/build script) — ครอบคลุมเคสจาก
 * `docs/07-TESTING.md` §3.2 ("MiniSearch th") และ re-rank ของ T-204/`docs/decisions/SPIKES.md` §S2
 */
import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';
import {
  catalogMiniSearchOptions,
  clampCatalogSearchLimit,
  rerankHits,
  SEARCH_CATALOG_MAX_LIMIT,
} from './search';
import type { CatalogItemSlim } from './searchTypes';

function makeItem(
  overrides: Partial<CatalogItemSlim> & Pick<CatalogItemSlim, 'i' | 'key'>,
): CatalogItemSlim {
  return {
    name: overrides.key,
    n_lines: 10,
    years: [2567],
    has_unit_price: false,
    ...overrides,
  };
}

/** เข้าถึง element ที่ index `i` แบบยืนยันว่าไม่ใช่ undefined (แทนการใช้ `!`) */
function at<T>(arr: T[], i: number): T {
  const value = arr[i];
  if (value === undefined) {
    throw new Error(`unexpected undefined at index ${String(i)}`);
  }
  return value;
}

function buildIndex(items: CatalogItemSlim[]): {
  mini: MiniSearch;
  itemsById: Map<number, CatalogItemSlim>;
} {
  const mini = new MiniSearch(catalogMiniSearchOptions());
  mini.addAll(items.map((it) => ({ id: it.i, key: it.key })));
  return { mini, itemsById: new Map(items.map((it) => [it.i, it])) };
}

const DEFAULT_OPTS = { prefix: true, fuzzy: 0.2, combineWith: 'OR' as const };

describe('docs/07-TESTING.md §3.2 — MiniSearch th', () => {
  it('"แอร์ 18000" เจอ "เครื่องปรับอากาศ แบบแยกส่วน ขนาด 18,000 บีทียู" (OR ต่อ token: ตัวเลขตรงพอ)', () => {
    const items: CatalogItemSlim[] = [
      makeItem({ i: 0, key: 'เครื่องปรับอากาศ แบบแยกส่วน ขนาด 18,000 บีทียู' }),
      makeItem({ i: 1, key: 'โต๊ะทำงาน' }),
    ];
    const { mini, itemsById } = buildIndex(items);
    const hits = mini.search('แอร์ 18000', DEFAULT_OPTS);
    const ranked = rerankHits(hits, itemsById, 'แอร์ 18000');
    expect(ranked.map((m) => m.item.i)).toContain(0);
    expect(ranked.map((m) => m.item.i)).not.toContain(1);
  });

  it('typo OCR "เบี้ยยังขีพ" เจอ "เบี้ยยังชีพ" ด้วย fuzzy 0.2', () => {
    const items: CatalogItemSlim[] = [makeItem({ i: 0, key: 'เบี้ยยังชีพผู้สูงอายุ' })];
    const { mini, itemsById } = buildIndex(items);
    const hits = mini.search('เบี้ยยังขีพ', DEFAULT_OPTS);
    const ranked = rerankHits(hits, itemsById, 'เบี้ยยังขีพ');
    expect(ranked.map((m) => m.item.i)).toContain(0);
  });
});

describe('re-rank: ตัวเลขตรงเป๊ะชนะ (กันแอร์ 12000 ขึ้นก่อน 18000)', () => {
  it('ค้น "แอร์ 18000 บีทียู" — รายการที่มี 18000 เป๊ะต้องมาก่อน แม้ n_lines น้อยกว่ารายการ 12000 มาก', () => {
    const items: CatalogItemSlim[] = [
      makeItem({ i: 0, key: 'เครื่องปรับอากาศ แบบแยกส่วน ขนาด 12000 บีทียู', n_lines: 5000 }),
      makeItem({ i: 1, key: 'เครื่องปรับอากาศ แบบแยกส่วน ขนาด 18000 บีทียู', n_lines: 6 }),
      makeItem({ i: 2, key: 'เครื่องปรับอากาศ แบบแยกส่วน ขนาด 24000 บีทียู', n_lines: 4000 }),
    ];
    const { mini, itemsById } = buildIndex(items);
    const hits = mini.search('แอร์ 18000 บีทียู', DEFAULT_OPTS);
    const ranked = rerankHits(hits, itemsById, 'แอร์ 18000 บีทียู');
    expect(ranked[0]?.item.i).toBe(1);
  });

  it('ไม่มีตัวเลขใน query — ยัง rank ได้ตามคะแนน × popularity โดยไม่ throw', () => {
    const items: CatalogItemSlim[] = [
      makeItem({ i: 0, key: 'ฝาย', n_lines: 5 }),
      makeItem({ i: 1, key: 'ฝายน้ำล้น', n_lines: 200 }),
    ];
    const { mini, itemsById } = buildIndex(items);
    const hits = mini.search('ฝาย', DEFAULT_OPTS);
    const ranked = rerankHits(hits, itemsById, 'ฝาย');
    expect(ranked).toHaveLength(2);
    expect(ranked.every((m) => Number.isFinite(m.score))).toBe(true);
  });

  it('ส่งต่อ `low_specificity` จาก CatalogItemSlim เข้า SearchMatch.lowSpecificity', () => {
    const items: CatalogItemSlim[] = [
      makeItem({ i: 0, key: 'ฝาย', low_specificity: true }),
      makeItem({ i: 1, key: 'ฝายยาง' }),
    ];
    const { mini, itemsById } = buildIndex(items);
    const hits = mini.search('ฝาย', DEFAULT_OPTS);
    const ranked = rerankHits(hits, itemsById, 'ฝาย');
    const withFlag = ranked.find((m) => m.item.i === 0);
    const withoutFlag = ranked.find((m) => m.item.i === 1);
    expect(withFlag?.lowSpecificity).toBe(true);
    expect(withoutFlag?.lowSpecificity).toBe(false);
  });

  it('ตัด hit ที่ id ไม่อยู่ใน itemsById ทิ้งอย่างเงียบ ๆ (กัน crash ถ้า index ไม่ sync กับ slim)', () => {
    const ranked = rerankHits([{ id: 99, score: 1, terms: ['x'] }], new Map(), 'x');
    expect(ranked).toEqual([]);
  });

  it('เรียงจากคะแนนมากไปน้อยเสมอ', () => {
    const items: CatalogItemSlim[] = [
      makeItem({ i: 0, key: 'กล้องวงจรปิด', n_lines: 1 }),
      makeItem({ i: 1, key: 'กล้องวงจรปิด cctv', n_lines: 300 }),
    ];
    const { mini, itemsById } = buildIndex(items);
    const hits = mini.search('กล้องวงจรปิด', DEFAULT_OPTS);
    const ranked = rerankHits(hits, itemsById, 'กล้องวงจรปิด');
    for (let i = 1; i < ranked.length; i += 1) {
      expect(at(ranked, i - 1).score).toBeGreaterThanOrEqual(at(ranked, i).score);
    }
  });
});

describe('clampCatalogSearchLimit', () => {
  it('ค่าเริ่มต้น (undefined) = 10', () => {
    expect(clampCatalogSearchLimit(undefined)).toBe(10);
  });

  it(`clamp ค่าที่เกิน ${String(SEARCH_CATALOG_MAX_LIMIT)} ลงมาที่ ${String(SEARCH_CATALOG_MAX_LIMIT)}`, () => {
    expect(clampCatalogSearchLimit(999)).toBe(SEARCH_CATALOG_MAX_LIMIT);
  });

  it('ค่าติดลบ → 0 (ไม่ติดลบ)', () => {
    expect(clampCatalogSearchLimit(-5)).toBe(0);
  });

  it('ค่าปกติที่ไม่เกินเพดาน คงค่าเดิม', () => {
    expect(clampCatalogSearchLimit(3)).toBe(3);
  });
});

describe('buildIndexQuery (main thread: กัน query ช้าจากเลขสั้น)', () => {
  it('ตัดเลข ≤ 2 หลักออกเมื่อมี token อื่น แต่คงเลขยาว', async () => {
    const { buildIndexQuery } = await import('@/data/search');
    expect(buildIndexQuery('รถบรรทุกดีเซล 1 ตัน').split(' ')).not.toContain('1');
    expect(buildIndexQuery('แอร์ 18000 บีทียู').split(' ')).toContain('18000');
  });
  it('ถ้าทั้ง query เป็นเลขสั้น ให้คงไว้ (ไม่คืน query ว่าง)', async () => {
    const { buildIndexQuery } = await import('@/data/search');
    expect(buildIndexQuery('4')).toBe('4');
  });
});

describe('rerankHits — เลขทั้งตัว (ไม่ตัดคำต่อ hit)', () => {
  it('"1" ไม่ match "12000"/"1.5"/"21" แต่ match "ขนาด 1 ตัน"', () => {
    const mk = (i: number, key: string) => ({
      i,
      key,
      name: key,
      n_lines: 10,
      years: [2566],
      has_unit_price: false,
    });
    const items = new Map([
      [0, mk(0, 'รถบรรทุก ขนาด 1 ตัน')],
      [1, mk(1, 'เครื่องปรับอากาศ 12000 บีทียู')],
      [2, mk(2, 'ท่อ ขนาด 1.5 นิ้ว')],
      [3, mk(3, 'อาคาร 21 ห้อง')],
    ]);
    const hits = [0, 1, 2, 3].map((id) => ({ id, score: 1, terms: ['x'] }));
    const ranked = rerankHits(hits, items, 'รถ 1 ตัน');
    expect(ranked[0]?.item.i).toBe(0);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(new Set(ranked.slice(1).map((m) => m.score)).size).toBe(1);
  });
});
