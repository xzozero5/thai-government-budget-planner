/**
 * T-204/T-208 — ค้นหา catalog (MiniSearch prebuilt index) + ค้นข้อความ DocChunk ของ PDF (folding)
 *
 * ห้าม import React (module boundary — `docs/04-ARCHITECTURE.md` §3)
 * ห้าม fetch ข้าม origin (N5) — ทุกไฟล์โหลดผ่าน `loadJsonGz`/`loadManifest` ของ `./manifest` เท่านั้น
 * ซึ่งต่อกับ `dataUrl()` (same-origin เสมอ)
 *
 * กลยุทธ์โหลด (ดู `docs/decisions/SPIKES.md` §S2/§S2 ผล 5 และ `docs/BACKLOG.md` T-208):
 * 1. โหลด `catalog/items-slim.json.gz` (metadata ผอมของทุก entry + ดัชนี `i` เข้า catalog เต็ม)
 * 2. โหลด `catalog/search-index.json.gz` (MiniSearch prebuilt แบบ `key_only`) — ถ้า `data_version`/
 *    `tokenizer_version` ไม่ตรงกับ manifest/โค้ดปัจจุบัน (หรือไฟล์หาย) → **build index ใน browser**
 *    จาก slim แทน (ช้ากว่าแต่ถูกต้องเสมอ) พร้อม `console.warn`
 * 3. `catalog/items.json.gz` (เต็ม — มี `keys`/`shards`/สถิติราคา) โหลด **เฉพาะตอนถูกเรียก**
 *    ผ่าน `getCatalogItem` เท่านั้น (cache หลังโหลดครั้งแรก)
 */
import MiniSearch, {
  type AsPlainObject,
  type Options,
  type SearchOptions,
  type SearchResult,
} from 'minisearch';
import { loadJsonGz, loadManifest } from './manifest';
import { type CatalogFile, CatalogFileSchema, type DocChunk } from './types';
import {
  type CatalogItemSlim,
  CatalogSlimFileSchema,
  type SearchIndexFile,
  SearchIndexFileSchema,
} from './searchTypes';
import { foldThai, TOKENIZER_VERSION, tokenizeThai } from './thaiText';

// re-export ให้ `web/scripts/build-search-index.mjs` (bundle ไฟล์นี้ด้วย esbuild) ใช้ schema/ค่าคงที่
// ชุดเดียวกับที่ browser ใช้ตอน validate ไฟล์ที่ตัวเองเพิ่งสร้าง (กันไฟล์ output เพี้ยนจาก schema จริง)
export { TOKENIZER_VERSION, CatalogFileSchema, CatalogSlimFileSchema, SearchIndexFileSchema };

// ---------------------------------------------------------------------------
// MiniSearch options ที่ต้องใช้ "ชุดเดียวกัน" ทั้งตอน build (`web/scripts/build-search-index.mjs`
// import ฟังก์ชันนี้ผ่าน esbuild transform) และตอนโหลด/ค้นหาใน browser — ห้ามมี logic
// tokenize/fold ซ้ำที่อื่น (แหล่งความจริงเดียว = `catalogMiniSearchOptions` + `data/thaiText.ts`)
// ---------------------------------------------------------------------------

export interface CatalogSearchDoc {
  id: number;
  key: string;
}

/** field เดียวที่ index จริง (`key_only` ตาม S2/T-208) — ดูเหตุผลใน `searchTypes.ts` */
export const CATALOG_SEARCH_FIELDS = ['key'] as const;

export function catalogMiniSearchOptions(): Options<CatalogSearchDoc> {
  return {
    fields: [...CATALOG_SEARCH_FIELDS],
    storeFields: [],
    idField: 'id',
    // fold ถูกเรียกภายใน tokenizeThai เอง (ไม่ใช่ processTerm) — ครอบคลุมทั้งตอน index (fieldName
    // ถูกส่งมา) และตอน query (fieldName เป็น undefined) เพราะ MiniSearch เรียก tokenize เดียวกันทั้งคู่
    tokenize: (text: string) => tokenizeThai(text),
    // fold ทำ lower-case ให้แล้ว ไม่ต้องประมวลผลเพิ่ม
    processTerm: (term: string) => term,
  };
}

/** token ที่เป็นตัวเลขล้วน หรือสั้น ≤ 2 ตัวอักษร: prefix/fuzzy ไม่มีความหมายเชิงภาษา ("1" จะ match ทุก term ที่
 * ขึ้นต้นด้วย 1) และเป็นต้นเหตุ query ช้า — main thread วัดใน Node กับ catalog จริง: "รถบรรทุกดีเซล 1 ตัน"
 * 345–360 ms (เกินงบ 200 ms ของ 04 §5) ⇒ ให้ match แบบตรงตัวเท่านั้น */
function isExactOnlyTerm(term: string): boolean {
  return term.length <= 2 || /^[\d.]+$/.test(term);
}

/**
 * ตัด token ตัวเลขสั้น (≤ 2 หลัก เช่น "1" ใน "1 ตัน", "4" ใน "กว้าง 4 เมตร") ออกจาก query ที่ส่งเข้า
 * MiniSearch เมื่อยังมี token อื่นเหลือ — term แบบนี้มี posting list ใหญ่มาก (เกือบทั้ง catalog) ทำให้ OR
 * query ช้า (main thread วัด: ~230 ms) โดยแทบไม่ช่วยคัดผลลัพธ์; เลขเหล่านี้ยังมีผลผ่าน `exactNumberBonus`
 * ตอน re-rank ซึ่งใช้ query เดิมเต็ม ๆ
 */
export function buildIndexQuery(query: string): string {
  const tokens = tokenizeThai(query);
  const strong = tokens.filter((t) => !(/^[\d.]+$/.test(t) && t.length <= 2));
  return (strong.length > 0 ? strong : tokens).join(' ');
}

export const DEFAULT_CATALOG_SEARCH_OPTIONS: SearchOptions = {
  prefix: (term: string) => !isExactOnlyTerm(term),
  fuzzy: (term: string) => (isExactOnlyTerm(term) ? false : 0.2),
  combineWith: 'OR',
};

// ---------------------------------------------------------------------------
// re-rank: คะแนน MiniSearch × boost ตาม log(n_lines) + โบนัสตัวเลขตรงเป๊ะ
// ---------------------------------------------------------------------------

export interface SearchMatch {
  item: CatalogItemSlim;
  score: number;
  matchedTerms: string[];
  lowSpecificity: boolean;
}

/** ดึงชุดตัวเลข (หลัง fold) ที่ปรากฏใน query — ใช้เทียบว่า key ของผลลัพธ์มีเลขเดียวกันเป๊ะไหม */
function extractQueryNumbers(query: string): Set<string> {
  const folded = foldThai(query);
  const numbers = folded.match(/\d+/g) ?? [];
  return new Set(numbers);
}

/** บรรทัดยิ่งเยอะยิ่งน่าเชื่อถือ แต่ใช้ log กันไม่ให้ n_lines มาก ๆ กลบคะแนนความตรงของข้อความไปเลย
 * (`1 + ln(1+n_lines)`: n_lines=0 → 1 (ไม่ boost/ไม่หาร), ยิ่งมากยิ่งเพิ่มแบบหน่วงลง) */
function popularityBoost(nLines: number): number {
  return 1 + Math.log1p(Math.max(nLines, 0));
}

/** โบนัสเมื่อ "ทุก" token ตัวเลขในคำค้น (เช่น "18000") ปรากฏเป๊ะในชุด token ของ `item.key` — กันกรณี
 * "แอร์ 18000 บีทียู" ให้ผลลัพธ์ที่มี 18000 เป๊ะขึ้นก่อนรายการ 12000/24000 ที่ match แค่คำว่า "แอร์" */
function exactNumberBonus(queryNumbers: Set<string>, item: CatalogItemSlim): number {
  if (queryNumbers.size === 0) return 1;
  // ห้ามตัดคำ (`Intl.Segmenter`) ต่อ hit ตรงนี้ — query ที่มีคำทั่วไป ("ตัน", "เมตร") ได้หลายพัน hit
  // ทำให้ re-rank ใช้ ~200 ms (main thread วัดกับ catalog จริง); `item.key` เป็นรูป canonical อยู่แล้ว
  // (ตัวเลขคั่นด้วยช่องว่าง/อักษร) จึงตรวจ "เลขทั้งตัว" ด้วยขอบเขตที่ไม่ใช่ตัวเลข/จุดทศนิยมพอ
  let matched = 0;
  for (const num of queryNumbers) {
    if (containsWholeNumber(item.key, num)) matched += 1;
  }
  return matched > 0 ? 1 + matched : 1;
}

function containsWholeNumber(text: string, num: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(num, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : text.charAt(at - 1);
    const after = text.charAt(at + num.length);
    if (
      !/[\d.,]/.test(before) &&
      !/[\d]/.test(after) &&
      !(after === '.' && /\d/.test(text.charAt(at + num.length + 1)))
    ) {
      return true;
    }
    from = at + 1;
  }
}

/**
 * re-rank ผลลัพธ์ดิบจาก `MiniSearch#search` — แยกเป็นฟังก์ชัน pure ต่างหาก (ไม่พึ่ง state ของโมดูล)
 * เพื่อ unit test ได้ตรง ๆ โดยไม่ต้องผ่าน fetch/gzip loading จริง
 */
export function rerankHits(
  hits: Pick<SearchResult, 'id' | 'score' | 'terms'>[],
  itemsById: Map<number, CatalogItemSlim>,
  query: string,
): SearchMatch[] {
  const queryNumbers = extractQueryNumbers(query);
  const matches: SearchMatch[] = [];
  for (const hit of hits) {
    // boundary: `SearchResult.id` เป็น `any` ในไลบรารี minisearch (รองรับ id ทุกชนิด) — โปรเจกต์นี้
    // กำหนดเองเสมอให้เป็นเลขจำนวนเต็ม (`CatalogItemSlim.i`) ตอน addAll/loadJS (`idField: 'id'`)
    const id = hit.id as number;
    const item = itemsById.get(id);
    if (!item) continue;
    const score = hit.score * popularityBoost(item.n_lines) * exactNumberBonus(queryNumbers, item);
    matches.push({
      item,
      score,
      matchedTerms: hit.terms,
      lowSpecificity: item.low_specificity === true,
    });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

// ---------------------------------------------------------------------------
// โหลด + cache สถานะค้นหา (module-level singleton promise — เหมือน pattern ของ loadManifest)
// ---------------------------------------------------------------------------

export type CatalogSearchSource = 'prebuilt' | 'browser-fallback';

interface CatalogSearchState {
  mini: MiniSearch<CatalogSearchDoc>;
  itemsById: Map<number, CatalogItemSlim>;
  source: CatalogSearchSource;
}

let searchStatePromise: Promise<CatalogSearchState> | null = null;
let fullCatalogPromise: Promise<CatalogFile> | null = null;

/** ล้าง cache ของโมดูลนี้ (ไว้ใช้ใน test เท่านั้น) */
export function resetCatalogSearchCache(): void {
  searchStatePromise = null;
  fullCatalogPromise = null;
}

function buildFallbackIndex(slimItems: CatalogItemSlim[]): MiniSearch<CatalogSearchDoc> {
  const mini = new MiniSearch<CatalogSearchDoc>(catalogMiniSearchOptions());
  mini.addAll(slimItems.map((it) => ({ id: it.i, key: it.key })));
  return mini;
}

async function buildCatalogSearchState(fetchImpl: typeof fetch): Promise<CatalogSearchState> {
  const manifest = await loadManifest(fetchImpl);
  const slimFile = await loadJsonGz('catalog/items-slim.json.gz', CatalogSlimFileSchema, fetchImpl);
  const itemsById = new Map<number, CatalogItemSlim>(slimFile.items.map((it) => [it.i, it]));

  let indexFile: SearchIndexFile | null = null;
  try {
    indexFile = await loadJsonGz('catalog/search-index.json.gz', SearchIndexFileSchema, fetchImpl);
  } catch (cause) {
    console.warn(
      '[data/search] โหลด catalog/search-index.json.gz ไม่สำเร็จ — จะ build ดัชนีค้นหาใน browser จาก catalog/items-slim.json.gz แทน (ช้ากว่า)',
      cause,
    );
  }

  if (indexFile !== null) {
    const versionMatches =
      indexFile.data_version === manifest.data_version &&
      indexFile.tokenizer_version === TOKENIZER_VERSION;
    if (versionMatches) {
      // boundary: `AsPlainObject` ของ minisearch ใช้ `any` ภายใน (ดูคอมเมนต์ใน searchTypes.ts) —
      // เรา validate เฉพาะ envelope ด้วย Zod ไปแล้วใน `loadJsonGz`
      const mini = MiniSearch.loadJS<CatalogSearchDoc>(
        indexFile.minisearch as unknown as AsPlainObject,
        catalogMiniSearchOptions(),
      );
      return { mini, itemsById, source: 'prebuilt' };
    }
    console.warn(
      `[data/search] catalog/search-index.json.gz ไม่ตรงเวอร์ชัน (data_version: ${indexFile.data_version} vs ${manifest.data_version}, tokenizer_version: ${indexFile.tokenizer_version} vs ${TOKENIZER_VERSION}) — จะ build ดัชนีค้นหาใน browser แทน`,
    );
  }

  return { mini: buildFallbackIndex(slimFile.items), itemsById, source: 'browser-fallback' };
}

/** โหลด catalog search state แบบ lazy (โหลดครั้งแรกตอนถูกเรียกเท่านั้น, cache เป็น promise เดียว) */
export function loadCatalogSearch(fetchImpl: typeof fetch = fetch): Promise<CatalogSearchState> {
  searchStatePromise ??= buildCatalogSearchState(fetchImpl).catch((err: unknown) => {
    searchStatePromise = null;
    throw err;
  });
  return searchStatePromise;
}

// ---------------------------------------------------------------------------
// searchCatalog
// ---------------------------------------------------------------------------

export interface SearchCatalogOptions {
  /** จำกัดจำนวนผลลัพธ์ที่คืน — ค่าเริ่มต้น 10, ถูก clamp ไม่ให้เกิน `SEARCH_CATALOG_MAX_LIMIT` */
  limit?: number;
  /** เก็บเฉพาะ item ที่มีบรรทัดงบในปีใดปีหนึ่งของรายการนี้ */
  years?: number[];
  /** เก็บเฉพาะ item ที่มีสถิติ `unit_price` (ราคาต่อหน่วยจริง ไม่ใช่แค่ยอดรวมต่อบรรทัด) */
  requireUnitPrice?: boolean;
}

export const SEARCH_CATALOG_DEFAULT_LIMIT = 10;
export const SEARCH_CATALOG_MAX_LIMIT = 20;

/** clamp `limit` ให้อยู่ในช่วง `[0, SEARCH_CATALOG_MAX_LIMIT]` — แยกเป็นฟังก์ชัน pure export ต่างหาก
 * เพื่อ unit test ตรง ๆ (CLAUDE.md §7: logic pure แยกจาก component) */
export function clampCatalogSearchLimit(limit: number | undefined): number {
  const requested = limit ?? SEARCH_CATALOG_DEFAULT_LIMIT;
  return Math.max(0, Math.min(requested, SEARCH_CATALOG_MAX_LIMIT));
}

/** ค้นหา catalog — โหลด index แบบ lazy ครั้งแรกที่เรียก แล้ว cache ไว้ */
export async function searchCatalog(
  query: string,
  options: SearchCatalogOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SearchMatch[]> {
  const state = await loadCatalogSearch(fetchImpl);
  const hits = state.mini.search(buildIndexQuery(query), DEFAULT_CATALOG_SEARCH_OPTIONS);
  let matches = rerankHits(hits, state.itemsById, query);

  if (options.years !== undefined) {
    const years = options.years;
    matches = matches.filter((m) => m.item.years.some((y) => years.includes(y)));
  }
  if (options.requireUnitPrice === true) {
    matches = matches.filter((m) => m.item.has_unit_price);
  }

  return matches.slice(0, clampCatalogSearchLimit(options.limit));
}

// ---------------------------------------------------------------------------
// getCatalogItem — โหลด catalog/items.json.gz เต็มเฉพาะตอนถูกเรียกครั้งแรก (cache หลังจากนั้น)
// ---------------------------------------------------------------------------

function loadFullCatalog(fetchImpl: typeof fetch): Promise<CatalogFile> {
  fullCatalogPromise ??= loadJsonGz('catalog/items.json.gz', CatalogFileSchema, fetchImpl).catch(
    (err: unknown) => {
      fullCatalogPromise = null;
      throw err;
    },
  );
  return fullCatalogPromise;
}

/** คืน `CatalogItem` เต็ม (มี `keys`/`shards`/สถิติราคา) ของ index `i` — โหลด catalog เต็มแบบ lazy */
export async function getCatalogItem(
  i: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogFile['items'][number]> {
  const catalog = await loadFullCatalog(fetchImpl);
  const item = catalog.items[i];
  if (!item) {
    throw new Error(
      `ไม่พบ catalog item ที่ index ${String(i)} (มีทั้งหมด ${String(catalog.items.length)} รายการ)`,
    );
  }
  return item;
}

// ---------------------------------------------------------------------------
// searchDocChunksText — ค้น DocChunk (text จาก PDF) ด้วย foldThai ทั้งสองฝั่ง (02 §B)
// ---------------------------------------------------------------------------

export interface DocChunkMatch {
  chunk: DocChunk;
  /** ตำแหน่ง (index) ใน array `chunks` ที่ส่งเข้ามา — ใช้ระบุ chunk โดยไม่ต้องพึ่ง `chunk_no` เพียงอย่างเดียว */
  index: number;
}

/**
 * ค้นข้อความ chunk ของ PDF ด้วยการ fold ทั้งสองฝั่ง (query และ `chunk.text`) แล้วเทียบแบบ substring —
 * **ไม่แก้/ไม่คืน text ที่ fold แล้ว** (คืน `chunk` ต้นฉบับเสมอ เพื่อไม่ให้ข้อความที่ใช้เป็นหลักฐานถูก
 * แก้ไข — CLAUDE.md N3/§7) ค้น "สำนักงาน" ต้องเจอ chunk ที่มีข้อความ "ส านักงาน" (สระหลุดตำแหน่งจาก PDF)
 */
export function searchDocChunksText(chunks: DocChunk[], query: string): DocChunkMatch[] {
  const foldedQuery = foldThai(query);
  if (foldedQuery.length === 0) return [];

  const results: DocChunkMatch[] = [];
  chunks.forEach((chunk, index) => {
    if (foldThai(chunk.text).includes(foldedQuery)) {
      results.push({ chunk, index });
    }
  });
  return results;
}
