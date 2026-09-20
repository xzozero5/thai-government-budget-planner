/**
 * T-206 §4/§9 — Facade เดียวที่ `ai/tools/*` และ `features/*` ต้อง import (`import { data } from
 * '@/data'`) ห้าม import ไฟล์ลึกใน `@/data/*` ตรง ๆ จากนอก `src/data/**` — บังคับด้วย ESLint
 * `no-restricted-imports` (ดู `web/eslint.config.js`, ยกเว้น `src/app/dataHarness/**` และไฟล์ test)
 *
 * ปรับจากข้อเสนอของ architect ใน `docs/decisions/T-206-review.md` §4 (เหตุผลของแต่ละจุดที่ปรับ):
 * - เมธอดอ่านข้อมูลงบ (`queryLines`/`getLines`/`getNeighborLines`) คืน field ของ `DataResultMeta`
 *   ปนอยู่ใน result เดิมตรง ๆ (ไม่ใช่ intersection type ซ้อนอีกชั้น) เพราะ `repo.ts` คืนแบบนั้นอยู่
 *   แล้วหลังแก้ B1-B3/F8 — การซ้อน type เพิ่มจะไม่มีประโยชน์อะไรเพิ่ม
 * - เพิ่ม `warnings: string[]` เข้า `DataResultMeta` (B2 บังคับให้ AI เห็น "ทำไมแถวถึงหาย" ไม่ใช่แค่
 *   ตัวเลข `droppedRows` เฉย ๆ)
 * - `getCatalogDetails` ยังไม่ implement เป็น batch อย่างที่เสนอ — ให้เรียก `getCatalogItem`/
 *   `getCatalogItemByKey` ทีละตัวไปก่อน (F6 เลื่อนเป็น T-210 — ยังไม่มี backend ที่ต้อง batch จริง)
 * - `getPriceTrend` ตั้งชื่อพารามิเตอร์ตรงกับ 05-FEATURES §3 (`{kind, key}`) แทน union แยก type
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import {
  adjustForInflation as adjustForInflationPure,
  type AdjustForInflationBasis,
  type AdjustForInflationInput,
  type AdjustForInflationResult,
  type CmiIndexKey,
  EconDataMissingError,
  type InflationIndexKey,
} from './inflation';
import { getEconSeries, getEconValue, type EconValueResult } from './econ';
import {
  DocNotFoundError,
  findDocuments,
  type FindDocumentsParams,
  type FindDocumentsResult,
  getDoc,
  type GetDocOptions,
  type GetDocResult,
} from './documents';
import { loadManifest } from './manifest';
import {
  facets as getFacets,
  getLines,
  getNeighborLines,
  InvalidShardPathError,
  MAX_SHARDS_TO_SCAN,
  QueryTooBroadError,
  type QueryTooBroadErrorDetail,
  queryLines,
  type GetLinesResult,
  type GetNeighborLinesResult,
  type QueryLinesParams,
  type QueryLinesResult,
  RepoQueryError,
} from './repo';
import {
  type CatalogItemDetail,
  getCatalogItem,
  getCatalogItemByKey,
  searchCatalog,
  type SearchCatalogOptions,
  type SearchCatalogResult,
  type SearchMatch,
} from './search';
import { type ShardPathsSummary, summarizeShardPaths } from './shardPaths';
import {
  getEconTrend as getIndicatorTrend,
  getPriceTrend as getItemPriceTrend,
  type EconTrend,
  type EconTrendPoint,
  type PriceTrend,
  type PriceTrendItemInput,
  type PriceTrendPoint,
  type PriceTrendUnitLabel,
  type TrendChangePct,
} from './trends';
import type {
  BudgetLine,
  CatalogItem,
  CoverageNote,
  Dataset,
  DocChunk,
  EconIndicatorSeries,
  Facets,
  GovLevel,
  QualityFlag,
  SourceDoc,
  SourceDocCollection,
  SourceDocKind,
} from './types';

// ---------------------------------------------------------------------------
// types ที่ `ai/tools/*` และ `features/*` ต้องใช้ (จุดเดียวที่ควร import type พวกนี้จากนอก data/**)
// ---------------------------------------------------------------------------

export type {
  AdjustForInflationBasis,
  AdjustForInflationInput,
  AdjustForInflationResult,
  BudgetLine,
  CatalogItem,
  CatalogItemDetail,
  CmiIndexKey,
  CoverageNote,
  Dataset,
  DocChunk,
  EconIndicatorSeries,
  EconTrend,
  EconTrendPoint,
  EconValueResult,
  Facets,
  FindDocumentsParams,
  FindDocumentsResult,
  GetDocOptions,
  GetDocResult,
  GetLinesResult,
  GetNeighborLinesResult,
  GovLevel,
  InflationIndexKey,
  PriceTrend,
  PriceTrendItemInput,
  PriceTrendPoint,
  PriceTrendUnitLabel,
  QualityFlag,
  QueryLinesParams,
  QueryLinesResult,
  QueryTooBroadErrorDetail,
  SearchCatalogOptions,
  SearchCatalogResult,
  SearchMatch,
  ShardPathsSummary,
  SourceDoc,
  SourceDocCollection,
  SourceDocKind,
  TrendChangePct,
};

export { summarizeShardPaths };

export { DocNotFoundError, EconDataMissingError, InvalidShardPathError, QueryTooBroadError, RepoQueryError };

/** T-604 — เพดานจำนวน shard ต่อ query เดียว (ADR-002/`data/repo.ts`) — `ai/tools/queryBudgetLines.ts`
 * ใช้ค่านี้ตัดสินว่าจะเลือก shard ผ่าน catalog ได้กี่ไฟล์ก่อนเรียก `queryLines` ซ้ำ (ต้องมาจากค่าจริง
 * ของ data layer เสมอ ห้าม hard-code ซ้ำในชั้น tool — ผิด N7/module boundary ถ้าค่าเพี้ยนกันได้) */
export { MAX_SHARDS_TO_SCAN };

// ---------------------------------------------------------------------------
// DataResultMeta — ทุกเมธอดที่อ่าน "แถวข้อมูลงบ" คืน field เหล่านี้ปนอยู่ใน result เสมอ (T-206 B2/B3/F8)
// ---------------------------------------------------------------------------

export interface DataResultMeta {
  /** ADR-004 (2562) / ADR-005 (ราชาเทวะ, upstream_ocr) / V9 (org_unmapped) / no_oracle (2567) ฯลฯ */
  coverageNotes: CoverageNote[];
  /** shard ที่ผลลัพธ์นี้มาจากจริง — ใช้เป็น shardHints ของ `getLines`/citation drawer รอบถัดไป (B3) */
  shardPaths: string[];
  /** แถวที่อ่านได้แต่ validate ไม่ผ่าน (B2 — ต้องรายงานให้ AI ไม่ทิ้งเงียบ) */
  droppedRows: number;
  /** ข้อความไทยอธิบายแถวที่ถูกข้าม (มี source_id ถ้าทราบ) */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// getPriceTrend — รับ ref ตรงตาม 05-FEATURES §3 (`{kind, key}`) แล้วไปหา trend shard ให้เอง
// ---------------------------------------------------------------------------

export type GetPriceTrendRef = { kind: 'item'; key: string } | { kind: 'indicator'; key: string };

async function getPriceTrendByRef(ref: GetPriceTrendRef): Promise<PriceTrend | EconTrend | null> {
  if (ref.kind === 'indicator') {
    return getIndicatorTrend(ref.key);
  }
  const item = await getCatalogItemByKey(ref.key);
  if (!item) {
    return null;
  }
  const input: PriceTrendItemInput =
    item.trend !== undefined ? { key: item.key, trend: item.trend } : { key: item.key };
  return getItemPriceTrend(input);
}

// ---------------------------------------------------------------------------
// adjustForInflation (facade) — โหลด series ให้เองจาก `index` (ต่างจาก `inflation.ts` ที่เป็น
// pure function ต้องการ series เป็น parameter ตรง ๆ — ยังคงอยู่แยกไว้ให้ unit test ง่าย)
// ---------------------------------------------------------------------------

async function adjustForInflationByIndex(
  input: Omit<AdjustForInflationInput, 'series'>,
): Promise<AdjustForInflationResult> {
  const series = await getEconSeries(input.index);
  if (!series) {
    throw new EconDataMissingError(input.index, input.fromYearBe, null);
  }
  return adjustForInflationPure({ ...input, series });
}

// ---------------------------------------------------------------------------
// dataVersion / facets — context เบา ๆ สำหรับ system prompt (cached ผ่าน loadManifest อยู่แล้ว)
// ---------------------------------------------------------------------------

async function dataVersion(): Promise<string> {
  const manifest = await loadManifest();
  return manifest.data_version;
}

// ---------------------------------------------------------------------------
// DataFacade
// ---------------------------------------------------------------------------

export interface DataFacade {
  // --- catalog ---
  searchCatalog(query: string, opts?: SearchCatalogOptions): Promise<SearchCatalogResult>;
  getCatalogItem(i: number): Promise<CatalogItemDetail>;
  getCatalogItemByKey(key: string): Promise<CatalogItemDetail | null>;
  // --- budget lines ---
  queryLines(params: QueryLinesParams): Promise<QueryLinesResult>;
  getLines(sourceIds: string[], shardHints: string[]): Promise<GetLinesResult>;
  getNeighborLines(sourceId: string, n: number, shardHint: string): Promise<GetNeighborLinesResult>;
  // --- documents ---
  findDocuments(params?: FindDocumentsParams): Promise<FindDocumentsResult>;
  getDoc(docId: string, opts?: GetDocOptions): Promise<GetDocResult>;
  // --- econ / trends ---
  getEconValue(indicator: string, yearBe: number): Promise<EconValueResult | null>;
  getEconSeries(indicator: string): Promise<EconIndicatorSeries | null>;
  adjustForInflation(input: Omit<AdjustForInflationInput, 'series'>): Promise<AdjustForInflationResult>;
  getPriceTrend(ref: GetPriceTrendRef): Promise<PriceTrend | EconTrend | null>;
  // --- context สำหรับ system prompt (cached block) ---
  facets(): Promise<Facets>;
  dataVersion(): Promise<string>;
}

const defaultDataFacade: DataFacade = {
  searchCatalog,
  getCatalogItem,
  getCatalogItemByKey,
  queryLines,
  getLines,
  getNeighborLines,
  findDocuments,
  getDoc,
  getEconValue,
  getEconSeries,
  adjustForInflation: adjustForInflationByIndex,
  getPriceTrend: getPriceTrendByRef,
  facets: getFacets,
  dataVersion,
};

/** สำหรับเทสต์ของ `ai/tools/*`/`features/*` — สร้าง facade ที่ override เฉพาะเมธอดที่ต้องการ mock
 * (ที่เหลือยังเป็นของจริง) โดยไม่ต้อง mock `fetch`/DuckDB */
export function createDataFacade(overrides: Partial<DataFacade> = {}): DataFacade {
  return { ...defaultDataFacade, ...overrides };
}

/** singleton จริงที่ `ai/tools/*`/`features/*` ใช้งานตามปกติ */
export const data: DataFacade = createDataFacade();
