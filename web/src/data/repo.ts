/**
 * T-203 — Repository ของข้อมูลงบประมาณ (`BudgetRepo`)
 *
 * `ai/` เรียกข้อมูลผ่าน facade `@/data` (`data/index.ts`) เท่านั้น — ไฟล์นี้เป็น implementation
 * ภายใน (docs/04-ARCHITECTURE.md §3: `ai/` ห้ามแตะ DuckDB โดยตรง) ทุก query ที่มีค่าจาก AI/ผู้ใช้
 * (item_keys, keyword, agencyContains, min/maxAmount, excludeFlags) ต้องผ่าน prepared statement +
 * parameters เท่านั้น (`duckdb.queryRows`) — ห้ามต่อค่าพวกนี้เป็น string ลง SQL text เด็ดขาด ส่วน
 * path ของ shard parquet มาจาก `manifest.files` ผ่าน `dataUrl()` เท่านั้น (ผ่านการ sanitize ใน
 * manifest.ts แล้ว) จึง embed ตรง ๆ ใน SQL ได้ (ADR-002)
 *
 * T-206 (review): เอกสารเอกสาร/`sources.json`/`getDoc`/`findDocuments` ย้ายไปอยู่ `data/documents.ts`
 * แยกต่างหาก (คนละความรับผิดชอบจาก budget lines) — ไฟล์นี้เหลือเฉพาะ budget lines + facets
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import {
  coverageNotesFor,
  dataUrl,
  loadJson,
  loadManifest,
  type ShardPathsQuery,
  shardPathsFor,
} from './manifest';
import {
  ensureShardsRegistered,
  queryRows,
  type SqlParam,
} from './duckdb';
import { summarizeShardPaths } from './shardPaths';
import {
  type BudgetLine,
  BudgetLineSchema,
  type CoverageNote,
  type Dataset,
  type Facets,
  FacetsSchema,
  type Manifest,
  type QualityFlag,
} from './types';

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------

/** ADR-002/BACKLOG T-203: บังคับจำกัดจำนวน shard ที่สแกนต่อ query เดียว เพื่อคุมขนาดที่โหลด
 * (T-206 F7: `duckdb.MAX_REGISTERED_SHARDS` ต้อง >= ค่านี้เสมอ — มี unit test ข้ามไฟล์ตรวจไว้) */
export const MAX_SHARDS_TO_SCAN = 12;

export const DEFAULT_QUERY_LIMIT = 20;
/** CLAUDE.md §7: "ห้ามใส่ข้อมูลดิบทั้งก้อนใน context ของ AI ... จำกัด ≤ 50 แถว/ครั้ง" */
export const MAX_QUERY_LIMIT = 50;

/** flag ที่ตัดออกโดยปริยาย เว้นแต่ caller ระบุ `excludeFlags` เอง (แม้เป็น `[]`) */
export const DEFAULT_EXCLUDE_FLAGS: readonly QualityFlag[] = ['corrupt_row', 'lump_sum_category'];

export type OrderBy =
  | 'amount_desc'
  | 'amount_asc'
  | 'unit_price_desc'
  | 'unit_price_asc'
  | 'source_id';

/**
 * T-206 B1 (blocker): ทุก entry ต้องลงท้ายด้วย `source_id ASC` เป็น tiebreaker — ไม่ทำเช่นนี้แล้ว
 * แถวที่ค่าเรียงเท่ากัน (เยอะมากในข้อมูลงบ เช่น amount_thb ซ้ำ/เป็น 0) จะสลับลำดับได้ระหว่าง
 * range/full mode, ระหว่าง shard order, และหลัง republish ⇒ citation ที่ AI อ้างในบทสนทนาเดียวกัน
 * อาจ reproduce ไม่ได้ (N3) — มี unit test ยืนยันว่า SQL มี tiebreaker ทุก key (`repo.test.ts`)
 */
const ORDER_BY_SQL: Record<OrderBy, string> = {
  amount_desc: 'amount_thb DESC NULLS LAST, source_id ASC',
  amount_asc: 'amount_thb ASC NULLS LAST, source_id ASC',
  unit_price_desc: 'unit_price_thb DESC NULLS LAST, source_id ASC',
  unit_price_asc: 'unit_price_thb ASC NULLS LAST, source_id ASC',
  source_id: 'source_id ASC',
};

/** โหมด `full` = fetch ทั้ง shard แล้ว registerFileBuffer เสมอ (ADR-002 ข้อ 5) ใช้ตอน caller ขอเอง
 * หรือระบบ fallback อัตโนมัติเมื่อโหมด `range` (ค่าเริ่มต้น) query ไม่สำเร็จ */
export type QueryMode = 'range' | 'full';

// ---------------------------------------------------------------------------
// Error types — ข้อความไทยสำหรับ UI/AI เสมอ
// ---------------------------------------------------------------------------

/**
 * field โครงสร้างที่แนบมากับ `QueryTooBroadError` (นอกเหนือจาก `shardCount`/message ไทยเดิม) — สรุปจาก
 * `summarizeShardPaths` ของชุด shard ที่เกินเพดาน เพื่อให้ caller (เช่น AI tool) แนะนำ filter ที่แคบลง
 * ได้ตรงจุดแทนการเดา (เช่น "มีข้อมูลปี 2566-2568 กระทรวง 15000/20000/75000 — เลือกปีหรือกระทรวงก่อน")
 */
export interface QueryTooBroadErrorDetail {
  candidateShardCount: number;
  availableYears: number[];
  availableMinistryCodes: string[];
}

export class QueryTooBroadError extends Error {
  readonly shardCount: number;
  readonly candidateShardCount: number;
  readonly availableYears: number[];
  readonly availableMinistryCodes: string[];
  constructor(shardCount: number, detail?: Partial<QueryTooBroadErrorDetail>) {
    const availableYears = detail?.availableYears ?? [];
    const availableMinistryCodes = detail?.availableMinistryCodes ?? [];
    const hint =
      availableYears.length > 0 || availableMinistryCodes.length > 0
        ? ` (ปีที่มีข้อมูลในกลุ่มนี้: ${availableYears.length > 0 ? availableYears.join(', ') : 'ไม่ทราบ'}` +
          `, กระทรวง: ${availableMinistryCodes.length > 0 ? availableMinistryCodes.join(', ') : 'ไม่ทราบ'})`
        : '';
    super(
      `คำค้นกว้างเกินไป (ต้องสแกน ${shardCount.toLocaleString('th-TH')} ไฟล์ เกินเพดาน ` +
        `${MAX_SHARDS_TO_SCAN.toLocaleString('th-TH')} ไฟล์ต่อครั้ง) โปรดระบุปีงบประมาณ, ` +
        `กระทรวง/หน่วยงาน, หรือ item_key ให้แคบลงก่อนค้นหาอีกครั้ง${hint}`,
    );
    this.name = 'QueryTooBroadError';
    this.shardCount = shardCount;
    this.candidateShardCount = detail?.candidateShardCount ?? shardCount;
    this.availableYears = availableYears;
    this.availableMinistryCodes = availableMinistryCodes;
  }
}

export class RepoQueryError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RepoQueryError';
    this.cause = cause;
  }
}

export class InvalidShardPathError extends Error {
  constructor(paths: string[]) {
    super(`เส้นทางไฟล์ shard ไม่อยู่ใน manifest ปัจจุบัน: ${paths.join(', ')}`);
    this.name = 'InvalidShardPathError';
  }
}

// ---------------------------------------------------------------------------
// queryLines
// ---------------------------------------------------------------------------

export interface QueryLinesParams {
  dataset?: Dataset;
  fiscalYears?: number[];
  ministryCodes?: string[];
  province?: string;
  /** จาก `CatalogItem.keys ?? [key]` — ทำ normalize ช่องว่างให้อัตโนมัติ */
  itemKeys?: string[];
  /** fallback หางยาว (รายการที่ catalog ไม่ครอบ) — ต้องมี filter อื่นร่วมด้วยให้ shard ที่ต้องสแกน ≤
   * `MAX_SHARDS_TO_SCAN` มิฉะนั้น throw `QueryTooBroadError` */
  keyword?: string;
  agencyContains?: string;
  minAmount?: number;
  maxAmount?: number;
  /** ค่าเริ่มต้น = `DEFAULT_EXCLUDE_FLAGS` — ส่ง `[]` ถ้าต้องการเห็นทุกแถวรวม flag ที่ตัดออกปกติ */
  excludeFlags?: QualityFlag[];
  /** ≤ `MAX_QUERY_LIMIT` (ตัดให้อัตโนมัติถ้าเกิน), ค่าเริ่มต้น `DEFAULT_QUERY_LIMIT` */
  limit?: number;
  orderBy?: OrderBy;
  /**
   * รายชื่อ shard (relative path ใต้ `data/`) ที่ caller เลือกมาแล้ว (เช่นจาก catalog index) —
   * ต้องอยู่ใน `manifest.files` เท่านั้น (ตรวจซ้ำเสมอ) ถ้าไม่ระบุ จะคำนวณจาก
   * dataset/fiscalYears/ministryCodes/province ผ่าน `shardPathsFor`
   */
  shardPaths?: string[];
  mode?: QueryMode;
}

export interface QueryLinesResult {
  rows: BudgetLine[];
  totalMatched: number;
  /** T-206 B2: คิดจาก `totalMatched > limit` เสมอ (ไม่ใช่ `totalMatched > rows.length` — จำนวนแถวที่
   * parse ผ่านน้อยกว่าที่ขอเพราะแถวเสียเป็นคนละเรื่องกับ "ถูกตัดด้วย LIMIT" ดู `droppedRows`) */
  truncated: boolean;
  shardsScanned: number;
  /** T-206 B3: path (relative ใต้ `data/`) ของทุก shard ที่ query นี้สแกนจริง */
  shardPaths: string[];
  /** T-206 B3: แม็พ `source_id` ของแต่ละแถวใน `rows` → shard path ที่แถวนั้นมาจากจริง (มาจากคอลัมน์
   * `filename` ของ `read_parquet(..., filename=true)` — ดูคอมเมนต์ที่ `buildFromClause`) ใช้เป็น
   * `shardHints` ของ `getLines`/citation drawer รอบถัดไปได้ทันทีโดยไม่ต้องเดา */
  rowShards: Record<string, string>;
  bytesHint?: number;
  coverageNotes: CoverageNote[];
  /** T-206 B2: จำนวนแถวที่ query เจอจริงแต่ validate (Zod) ไม่ผ่าน แล้วถูกข้าม — ต้อง "ไม่ทิ้งเงียบ" */
  droppedRows: number;
  /** ข้อความไทยอธิบายแถวที่ถูกข้าม (มี source_id ถ้าทราบ) — ให้ tool layer ส่งต่อให้ AI เห็น */
  warnings: string[];
}

interface WhereClause {
  sql: string;
  params: SqlParam[];
}

function normalizeItemKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ');
}

function likeContainsPattern(term: string): string {
  const escaped = term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

function buildWhereClause(params: QueryLinesParams): WhereClause {
  const clauses: string[] = [];
  const sqlParams: SqlParam[] = [];

  if (params.dataset !== undefined) {
    clauses.push('dataset = ?');
    sqlParams.push(params.dataset);
  }
  if (params.fiscalYears && params.fiscalYears.length > 0) {
    clauses.push(`fiscal_year_be IN (${params.fiscalYears.map(() => '?').join(', ')})`);
    sqlParams.push(...params.fiscalYears);
  }
  if (params.ministryCodes && params.ministryCodes.length > 0) {
    clauses.push(`ministry_code IN (${params.ministryCodes.map(() => '?').join(', ')})`);
    sqlParams.push(...params.ministryCodes);
  }
  if (params.province !== undefined) {
    clauses.push('province = ?');
    sqlParams.push(params.province);
  }
  if (params.itemKeys && params.itemKeys.length > 0) {
    const normalized = params.itemKeys.map(normalizeItemKey);
    clauses.push(`item_key IN (${normalized.map(() => '?').join(', ')})`);
    sqlParams.push(...normalized);
  }
  if (params.keyword !== undefined && params.keyword.trim().length > 0) {
    clauses.push("item_name_raw ILIKE ? ESCAPE '\\'");
    sqlParams.push(likeContainsPattern(params.keyword.trim()));
  }
  if (params.agencyContains !== undefined && params.agencyContains.trim().length > 0) {
    clauses.push("agency ILIKE ? ESCAPE '\\'");
    sqlParams.push(likeContainsPattern(params.agencyContains.trim()));
  }
  if (params.minAmount !== undefined) {
    clauses.push('amount_thb >= ?');
    sqlParams.push(params.minAmount);
  }
  if (params.maxAmount !== undefined) {
    clauses.push('amount_thb <= ?');
    sqlParams.push(params.maxAmount);
  }
  const excludeFlags = params.excludeFlags ?? DEFAULT_EXCLUDE_FLAGS;
  for (const flag of excludeFlags) {
    clauses.push('NOT list_contains(quality_flags, ?)');
    sqlParams.push(flag);
  }

  return { sql: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE', params: sqlParams };
}

/** ป้องกัน injection ชั้นที่สอง (นอกเหนือจาก encodeURIComponent ใน `dataUrl`) ก่อน embed ลง SQL ตรง ๆ
 * — DuckDB ไม่รองรับ parameter สำหรับ argument ของ table function เช่น `read_parquet(...)` (ต้องเป็น
 * ค่าคงที่ตอน bind) จึง embed URL ตรง ๆ ได้เฉพาะเมื่อ URL มาจาก `dataUrl()`/manifest เท่านั้น (ADR-002) */
function sqlStringLiteral(value: string): string {
  if (value.includes("'") || value.includes('\\') || value.includes(';')) {
    throw new RepoQueryError('เส้นทางไฟล์ข้อมูลมีอักขระที่ไม่ปลอดภัยสำหรับ SQL');
  }
  return `'${value}'`;
}

/**
 * `dataUrl()` คืน root-relative URL (เช่น `/thai-government-budget-planner/data/...`) ซึ่ง resolve
 * ไม่ได้จากภายใน DuckDB worker (สร้างจาก `blob:` ตาม ADR-002 ข้อ 3 — blob URL มี base URL ของตัวเอง
 * แบบ opaque) ทำให้ `read_parquet('<root-relative>')` ถูกตีความเป็น glob pattern ของไฟล์ในเครื่อง
 * แทนที่จะเป็น HTTP URL (พบจริงตอน integration test: "IO Error: No files found that match the
 * pattern") ⇒ ต้องแปลงเป็น absolute URL (มี origin) ที่ระดับ main thread (มี `window.location` ที่
 * ถูกต้อง) ก่อน embed ลง SQL หรือส่งให้ `ensureShardRegistered` เสมอ
 */
function toAbsoluteDataUrl(path: string): string {
  return new URL(dataUrl(path), window.location.href).href;
}

/**
 * T-206 B3: `filename=true` ของ `read_parquet` เติมคอลัมน์ `filename` (URL/path ที่ table function
 * เปิดจริง) เข้าไปในผลลัพธ์ — ใช้แม็พแถวกลับไปหา shard ต้นทางเมื่อ query ข้ามหลาย shard พร้อมกัน
 *
 * **ทำไมไม่ทำให้ range mode อ่าน bytes เพิ่มอย่างมีนัย**: `filename` เป็น metadata ที่ DuckDB รู้อยู่
 * แล้วจากอาร์กิวเมนต์ที่ส่งเข้า `read_parquet` เอง (ไม่ใช่ค่าที่ต้องอ่านเพิ่มจากตัวไฟล์ parquet) —
 * ต่างจากการเพิ่มคอลัมน์ข้อมูลจริง (เช่น `item_name_raw`) ซึ่งต้องอ่าน column chunk เพิ่ม การเติม
 * `filename=true` จึงไม่เพิ่ม HTTP range request ใด ๆ เทียบกับ query เดิม — ใช้เฉพาะกับ query ที่ดึง
 * ทุกคอลัมน์อยู่แล้ว (phase 2 ของ `queryLines`, `getLines`) ไม่ใช้กับ phase 1 (เลือกคอลัมน์แคบ) เพราะ
 * ไม่จำเป็นต้องรู้ shard ของแถวที่ยังไม่ถูกเลือกมาแสดงจริง
 *
 * ทางเลือกที่พิจารณาแล้วตัดทิ้ง: query ทีละ shard แยกกัน (N คำสั่งแทน 1) — เพิ่ม round-trip เป็น N
 * เท่า (แย่กว่าในทางปฏิบัติ แม้ bytes ต่อคำสั่งจะเล็กลง) และทำให้ `count(*) OVER ()`/`ORDER BY` ข้าม
 * shard ในจังหวะเดียวทำไม่ได้ (ต้อง merge ผลเองใน JS ซึ่งเสี่ยง B1 ผิดพลาดซ้ำ)
 */
function buildFromClause(urls: string[], opts: { filename?: boolean } = {}): string {
  const filenameArg = opts.filename === true ? ', filename=true' : '';
  const only = urls[0];
  if (urls.length === 1 && only !== undefined) {
    return `read_parquet(${sqlStringLiteral(only)}${filenameArg})`;
  }
  return `read_parquet([${urls.map(sqlStringLiteral).join(', ')}]${filenameArg})`;
}

function validateKnownShards(manifest: Manifest, paths: string[]): void {
  const known = new Set(manifest.files.map((f) => f.path));
  const invalid = paths.filter((p) => !known.has(p));
  if (invalid.length > 0) {
    throw new InvalidShardPathError(invalid);
  }
}

function buildFileFilter(params: QueryLinesParams): ShardPathsQuery {
  // สร้างแบบไม่ใส่ key ที่ค่าเป็น undefined เอง (exactOptionalPropertyTypes: true ใน tsconfig
  // ไม่ยอมรับ `{ dataset: undefined }` แม้ type จะเป็น optional ก็ตาม)
  const filter: ShardPathsQuery = {};
  if (params.dataset !== undefined) {
    filter.dataset = params.dataset;
  }
  if (params.fiscalYears !== undefined) {
    filter.fiscalYears = params.fiscalYears;
  }
  if (params.ministryCodes !== undefined) {
    filter.ministryCodes = params.ministryCodes;
  }
  if (params.province !== undefined) {
    filter.province = params.province;
  }
  return filter;
}

function resolveShardPaths(manifest: Manifest, params: QueryLinesParams): string[] {
  const fileFilter = buildFileFilter(params);
  if (params.shardPaths) {
    validateKnownShards(manifest, params.shardPaths);
    const hasFileFilter =
      params.dataset !== undefined ||
      params.fiscalYears !== undefined ||
      params.ministryCodes !== undefined ||
      params.province !== undefined;
    if (!hasFileFilter) {
      return params.shardPaths;
    }
    // มี filter ระดับไฟล์ด้วย — ตัด shardPaths ที่ caller ส่งมาให้เหลือเฉพาะที่ตรงเงื่อนไข (defense in depth)
    const allowed = new Set(shardPathsFor(manifest, fileFilter));
    return params.shardPaths.filter((p) => allowed.has(p));
  }
  return shardPathsFor(manifest, fileFilter);
}

/** รวม coverage note ของทุก dataset/ปีที่ shard ที่เลือกจริงครอบคลุม (ไม่ใช่แค่จาก params ตรง ๆ
 * เพราะ caller อาจส่ง `shardPaths` เองโดยไม่ระบุ `dataset`) — ADR-004/005 */
function collectCoverageNotes(manifest: Manifest, paths: string[]): CoverageNote[] {
  const filesByPath = new Map(manifest.files.map((f) => [f.path, f]));
  const seen = new Set<string>();
  const notes: CoverageNote[] = [];
  for (const path of paths) {
    const file = filesByPath.get(path);
    if (!file?.dataset) {
      continue;
    }
    const relevant = coverageNotesFor(
      manifest,
      file.fiscal_year_be === null
        ? { dataset: file.dataset }
        : { dataset: file.dataset, fiscalYear: file.fiscal_year_be },
    );
    for (const note of relevant) {
      const key = `${note.dataset}|${String(note.fiscal_year_be)}|${note.note}`;
      if (!seen.has(key)) {
        seen.add(key);
        notes.push(note);
      }
    }
  }
  return notes;
}

function clampLimit(limit: number | undefined): number {
  const requested = limit ?? DEFAULT_QUERY_LIMIT;
  if (!Number.isFinite(requested)) {
    return DEFAULT_QUERY_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_QUERY_LIMIT);
}

/** รัน `run` ในโหมด range ก่อน (ถ้าไม่ได้บังคับ `full`) แล้ว fallback เป็น full-mode ตาม ADR-002 ข้อ 5
 * เมื่อ host ไม่ตอบ 206 (หรือ error อื่นระหว่างอ่านแบบ range) — ใช้ `ensureShardsRegistered` (แทน
 * `Promise.all` ตรง ๆ) เพื่อ pin ทั้งชุด shard ของ query นี้กันการ evict ตัวเอง (T-206 F7) */
async function runWithFallback<T>(
  urls: string[],
  mode: QueryMode | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (mode === 'full') {
    await ensureShardsRegistered(urls);
    return run();
  }
  try {
    return await run();
  } catch (rangeError) {
    try {
      await ensureShardsRegistered(urls);
    } catch (registerError) {
      throw new RepoQueryError(
        'อ่านข้อมูลไม่สำเร็จทั้งแบบ range request และ fallback โหลดทั้งไฟล์',
        registerError,
      );
    }
    try {
      return await run();
    } catch (fallbackError) {
      throw new RepoQueryError(
        'อ่านข้อมูลไม่สำเร็จทั้งแบบ range request และ fallback โหลดทั้งไฟล์',
        fallbackError ?? rangeError,
      );
    }
  }
}

/**
 * DuckDB/Arrow ตีความคอลัมน์ `LIST(VARCHAR)` ที่ทุกแถวในผลลัพธ์ชุดนั้นเป็น list ว่างเป็น
 * `LIST(NULL)` (ไม่มี element ให้ infer เป็น VARCHAR) แล้ว apache-arrow แปลง row นั้นเป็นค่าที่ไม่ใช่
 * `Array` จริง (พบจริงตอน integration test: `spec_tokens`/`quality_flags` กลายเป็นค่าที่ไม่ใช่
 * array เมื่อทุกแถวว่างพร้อมกัน) — coerce กลับเป็น `[]` เฉพาะ 2 คอลัมน์นี้ก่อน validate (ความหมาย
 * ถูกต้องอยู่แล้ว: "list ว่าง" ก็คือ `[]`)
 */
function parseBudgetLine(record: Record<string, unknown>): BudgetLine | null {
  const normalized = {
    ...record,
    spec_tokens: Array.isArray(record['spec_tokens']) ? record['spec_tokens'] : [],
    quality_flags: Array.isArray(record['quality_flags']) ? record['quality_flags'] : [],
  };
  // `filename` (จาก `read_parquet(..., filename=true)`) ไม่ใช่คอลัมน์ของ BudgetLineSchema — Zod
  // object (โหมด default 'strip') ตัดทิ้งเองอยู่แล้ว ไม่ต้องลบออกมือ
  const result = BudgetLineSchema.safeParse(normalized);
  return result.success ? result.data : null;
}

function warnForDroppedRow(sourceId: string | undefined): string {
  return sourceId !== undefined
    ? `แถวข้อมูล source_id=${sourceId} มีรูปแบบไม่ตรงตามที่คาดไว้ (validate ไม่ผ่าน) ถูกข้ามไป`
    : 'พบแถวข้อมูลที่มีรูปแบบไม่ตรงตามที่คาดไว้ (ไม่ทราบ source_id) ถูกข้ามไป';
}

/** T-206 B3: url → relative shard path (ย้อนกลับของ `toAbsoluteDataUrl`) สำหรับแม็พคอลัมน์ `filename` */
function buildUrlToPathMap(urls: string[], paths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  urls.forEach((url, i) => {
    const path = paths[i];
    if (path !== undefined) {
      map.set(url, path);
    }
  });
  return map;
}

/** หา shard ต้นทางของแถวหนึ่ง — ใช้คอลัมน์ `filename` ถ้ามีหลาย shard ที่เป็นไปได้ มิฉะนั้น (สแกน
 * shard เดียว) ใช้ shard นั้นตรง ๆ ได้เลยโดยไม่ต้องพึ่ง `filename` (single-shard query บางที่ไม่ได้
 * ขอ `filename=true` เช่น `getNeighborLines`) */
function resolveRowShard(
  record: Record<string, unknown>,
  urlToPath: Map<string, string>,
  singleShardFallback: string | undefined,
): string | undefined {
  const filename = record['filename'];
  if (typeof filename === 'string') {
    const mapped = urlToPath.get(filename);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return singleShardFallback;
}

export async function queryLines(params: QueryLinesParams): Promise<QueryLinesResult> {
  const manifest = await loadManifest();
  const paths = resolveShardPaths(manifest, params);
  const coverageNotes = collectCoverageNotes(manifest, paths);

  if (paths.length === 0) {
    return {
      rows: [],
      totalMatched: 0,
      truncated: false,
      shardsScanned: 0,
      shardPaths: [],
      rowShards: {},
      coverageNotes,
      droppedRows: 0,
      warnings: [],
    };
  }
  if (paths.length > MAX_SHARDS_TO_SCAN) {
    const summary = summarizeShardPaths(paths);
    throw new QueryTooBroadError(paths.length, {
      candidateShardCount: paths.length,
      availableYears: summary.years,
      availableMinistryCodes: summary.ministryCodes,
    });
  }

  const limit = clampLimit(params.limit);
  const where = buildWhereClause(params);
  const orderSql = ORDER_BY_SQL[params.orderBy ?? 'amount_desc'];
  const urls = paths.map((p) => toAbsoluteDataUrl(p));
  const urlToPath = buildUrlToPathMap(urls, paths);
  const singleShardFallback = paths.length === 1 ? paths[0] : undefined;
  const fromClause = buildFromClause(urls);
  const fromClauseWithFilename = buildFromClause(urls, { filename: true });

  const result = await runWithFallback(urls, params.mode, async () => {
    // จังหวะที่ 1 (ADR-002 ข้อ 4): เลือกคอลัมน์แคบที่สุด (แค่ source_id) + count(*) OVER() รวมทั้งชุด
    // ที่ผ่าน WHERE (คำนวณก่อน LIMIT ตามลำดับการประมวลผลของ SQL มาตรฐาน)
    const sql1 =
      `SELECT source_id, count(*) OVER () AS __total_matched FROM ${fromClause} ` +
      `WHERE ${where.sql} ORDER BY ${orderSql} LIMIT ${String(limit)}`;
    const phase1Rows = await queryRows(sql1, where.params);
    if (phase1Rows.length === 0) {
      return {
        rows: [] as BudgetLine[],
        totalMatched: 0,
        truncated: false,
        rowShards: {},
        droppedRows: 0,
        warnings: [] as string[],
      };
    }
    const totalMatched = Number(phase1Rows[0]?.['__total_matched'] ?? phase1Rows.length);
    const orderedSourceIds = phase1Rows.map((r) => String(r['source_id']));

    // จังหวะที่ 2 (ADR-002 ข้อ 4): ดึงทุกคอลัมน์ (รวม item_name_raw + filename) เฉพาะแถวที่จะแสดงจริง
    // (≤ 50 แถว) — ORDER BY ของแถวสุดท้ายอิงลำดับจาก `orderedSourceIds` (จังหวะที่ 1) เสมอ ไม่พึ่ง
    // ลำดับที่ SQL ของจังหวะนี้คืนมา (B1: deterministic อยู่แล้วจากจังหวะที่ 1)
    const sql2 = `SELECT * FROM ${fromClauseWithFilename} WHERE source_id IN (${orderedSourceIds
      .map(() => '?')
      .join(', ')})`;
    const phase2Rows = await queryRows(sql2, orderedSourceIds);
    const bySourceId = new Map(phase2Rows.map((r) => [String(r['source_id']), r]));
    const rows: BudgetLine[] = [];
    const rowShards: Record<string, string> = {};
    const warnings: string[] = [];
    let droppedRows = 0;
    for (const sourceId of orderedSourceIds) {
      const record = bySourceId.get(sourceId);
      if (!record) {
        // T-206 B2: ไม่ทิ้งเงียบแม้กรณีนี้แทบเป็นไปไม่ได้ในทางปฏิบัติ (ไฟล์ parquet เป็น static)
        droppedRows += 1;
        warnings.push(
          `ไม่พบแถว source_id=${sourceId} ในจังหวะที่สอง (ข้อมูลไม่สอดคล้องกันระหว่างสองจังหวะ) ถูกข้ามไป`,
        );
        continue;
      }
      const parsed = parseBudgetLine(record);
      if (parsed) {
        rows.push(parsed);
        const shard = resolveRowShard(record, urlToPath, singleShardFallback);
        if (shard !== undefined) {
          rowShards[sourceId] = shard;
        }
      } else {
        droppedRows += 1;
        warnings.push(warnForDroppedRow(sourceId));
      }
    }
    // T-206 B2: truncated มาจาก totalMatched > limit (ไม่ใช่ totalMatched > rows.length — แถวที่ถูก
    // ตัดเพราะ validate ไม่ผ่านเป็นคนละเรื่องกับ "ถูกตัดด้วย LIMIT")
    return { rows, totalMatched, truncated: totalMatched > limit, rowShards, droppedRows, warnings };
  });

  return { ...result, shardsScanned: paths.length, shardPaths: paths, coverageNotes };
}

// ---------------------------------------------------------------------------
// getLines / getNeighborLines
// ---------------------------------------------------------------------------

export interface GetLinesResult {
  rows: BudgetLine[];
  /** T-206 B3: shard hint ที่ถูกใช้จริง (คือ `shardHints` ที่รับเข้ามา — ตรวจแล้วว่าอยู่ใน manifest) */
  shardPaths: string[];
  /** T-206 B3: แม็พ source_id → shard path จริง (จากคอลัมน์ `filename` เมื่อ shardHints มีมากกว่า 1) */
  rowShards: Record<string, string>;
  /** T-206 F8: coverage note ของทุก shard ใน `shardHints` (ADR-004/005/V9/no_oracle) */
  coverageNotes: CoverageNote[];
  droppedRows: number;
  warnings: string[];
}

/**
 * ดึงแถวเต็ม (ทุกคอลัมน์) ตาม `source_id` — ใช้ใน citation drawer (T-407)
 *
 * ต้องระบุ `shardHints` เสมอ (path ของ shard ที่ทราบอยู่แล้วว่า source_id นี้อยู่ในไฟล์ไหน — ปกติมาจาก
 * ToolLog ของ session ที่เคย query เจอมาก่อน หรือ `QueryLinesResult.rowShards`) เพราะการค้นย้อนกลับจาก
 * source_id ไปหา shard โดยไม่มีเบาะแสต้องสแกนทุกไฟล์ ซึ่งขัดกับเพดาน `MAX_SHARDS_TO_SCAN` (ADR-002)
 */
export async function getLines(sourceIds: string[], shardHints: string[]): Promise<GetLinesResult> {
  if (sourceIds.length === 0) {
    return { rows: [], shardPaths: [], rowShards: {}, coverageNotes: [], droppedRows: 0, warnings: [] };
  }
  if (shardHints.length === 0) {
    throw new RepoQueryError(
      'ต้องระบุ shardHints (ไฟล์ shard ที่ทราบจาก citation เดิม) เพื่อค้นหาแถวตาม source_id — ' +
        'ระบบไม่สแกนทุกไฟล์เพื่อป้องกันโหลดข้อมูลมากเกินความจำเป็น',
    );
  }
  if (shardHints.length > MAX_SHARDS_TO_SCAN) {
    const summary = summarizeShardPaths(shardHints);
    throw new QueryTooBroadError(shardHints.length, {
      candidateShardCount: shardHints.length,
      availableYears: summary.years,
      availableMinistryCodes: summary.ministryCodes,
    });
  }
  const manifest = await loadManifest();
  validateKnownShards(manifest, shardHints);
  const coverageNotes = collectCoverageNotes(manifest, shardHints);
  const urls = shardHints.map((p) => toAbsoluteDataUrl(p));
  const urlToPath = buildUrlToPathMap(urls, shardHints);
  const singleShardFallback = shardHints.length === 1 ? shardHints[0] : undefined;
  const fromClause = buildFromClause(urls, { filename: true });
  const records = await runWithFallback(urls, undefined, () => {
    // B1: ORDER BY source_id ASC — deterministic เสมอไม่ว่า DuckDB จะคืนแถวลำดับไหนจากภายใน
    const sql = `SELECT * FROM ${fromClause} WHERE source_id IN (${sourceIds
      .map(() => '?')
      .join(', ')}) ORDER BY source_id ASC`;
    return queryRows(sql, sourceIds);
  });
  const rows: BudgetLine[] = [];
  const rowShards: Record<string, string> = {};
  const warnings: string[] = [];
  let droppedRows = 0;
  for (const record of records) {
    const parsed = parseBudgetLine(record);
    if (parsed) {
      rows.push(parsed);
      const shard = resolveRowShard(record, urlToPath, singleShardFallback);
      if (shard !== undefined) {
        rowShards[parsed.source_id] = shard;
      }
    } else {
      droppedRows += 1;
      const sid = typeof record['source_id'] === 'string' ? record['source_id'] : undefined;
      warnings.push(warnForDroppedRow(sid));
    }
  }
  return { rows, shardPaths: shardHints, rowShards, coverageNotes, droppedRows, warnings };
}

export interface GetNeighborLinesResult {
  rows: BudgetLine[];
  shardPaths: string[];
  rowShards: Record<string, string>;
  coverageNotes: CoverageNote[];
  droppedRows: number;
  warnings: string[];
}

/** "ดูแถวใกล้เคียง" — `source_row` ± n ในไฟล์/ชีตเดียวกับ `sourceId` (T-407) */
export async function getNeighborLines(
  sourceId: string,
  n: number,
  shardHint: string,
): Promise<GetNeighborLinesResult> {
  const anchorResult = await getLines([sourceId], [shardHint]);
  const anchor = anchorResult.rows[0];
  if (!anchor) {
    throw new RepoQueryError(`ไม่พบ source_id "${sourceId}" ในไฟล์ shard ที่ระบุ`);
  }
  const manifest = await loadManifest();
  validateKnownShards(manifest, [shardHint]);
  const coverageNotes = collectCoverageNotes(manifest, [shardHint]);
  const url = toAbsoluteDataUrl(shardHint);
  const fromClause = buildFromClause([url]);
  const records = await runWithFallback([url], undefined, () => {
    // B1: ORDER BY ที่ SQL เอง (ไม่ใช่แค่ .sort() ใน JS) — source_row ASC + source_id ASC tiebreaker
    const sql =
      `SELECT * FROM ${fromClause} WHERE source_sheet = ? AND source_row BETWEEN ? AND ? ` +
      `ORDER BY source_row ASC, source_id ASC`;
    return queryRows(sql, [anchor.source_sheet, anchor.source_row - n, anchor.source_row + n]);
  });
  const rows: BudgetLine[] = [];
  const rowShards: Record<string, string> = {};
  const warnings: string[] = [];
  let droppedRows = 0;
  for (const record of records) {
    const parsed = parseBudgetLine(record);
    if (parsed) {
      rows.push(parsed);
      rowShards[parsed.source_id] = shardHint;
    } else {
      droppedRows += 1;
      const sid = typeof record['source_id'] === 'string' ? record['source_id'] : undefined;
      warnings.push(warnForDroppedRow(sid));
    }
  }
  return { rows, shardPaths: [shardHint], rowShards, coverageNotes, droppedRows, warnings };
}

// ---------------------------------------------------------------------------
// facets
// ---------------------------------------------------------------------------

export async function facets(): Promise<Facets> {
  return loadJson('catalog/facets.json', FacetsSchema);
}

// ---------------------------------------------------------------------------
// BudgetRepo — interface เดียวที่ mock ง่ายในเทส (ผู้ใช้จริงของ `ai/`/`features/*` ต้อง import ผ่าน
// facade `@/data` เท่านั้น — ดู `data/index.ts`)
// ---------------------------------------------------------------------------

export interface BudgetRepo {
  queryLines(params: QueryLinesParams): Promise<QueryLinesResult>;
  getLines(sourceIds: string[], shardHints: string[]): Promise<GetLinesResult>;
  getNeighborLines(sourceId: string, n: number, shardHint: string): Promise<GetNeighborLinesResult>;
  facets(): Promise<Facets>;
}

export const budgetRepo: BudgetRepo = {
  queryLines,
  getLines,
  getNeighborLines,
  facets,
};
