/**
 * T-203 — Repository ของข้อมูลงบประมาณ (`BudgetRepo`)
 *
 * `ai/` เรียกข้อมูลผ่านไฟล์นี้เท่านั้น (docs/04-ARCHITECTURE.md §3: `ai/` ห้ามแตะ DuckDB โดยตรง)
 * ทุก query ที่มีค่าจาก AI/ผู้ใช้ (item_keys, keyword, agencyContains, min/maxAmount, excludeFlags)
 * ต้องผ่าน prepared statement + parameters เท่านั้น (`duckdb.queryRows`) — ห้ามต่อค่าพวกนี้เป็น
 * string ลง SQL text เด็ดขาด ส่วน path ของ shard parquet มาจาก `manifest.files` ผ่าน `dataUrl()`
 * เท่านั้น (ผ่านการ sanitize ใน manifest.ts แล้ว) จึง embed ตรง ๆ ใน SQL ได้ (ADR-002)
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import {
  coverageNotesFor,
  dataUrl,
  loadJson,
  loadJsonGz,
  loadManifest,
  type ShardPathsQuery,
  shardPathsFor,
} from './manifest';
import {
  ensureShardRegistered,
  queryRows,
  type SqlParam,
} from './duckdb';
import {
  type BudgetLine,
  BudgetLineSchema,
  type CoverageNote,
  type Dataset,
  type DocChunk,
  DocChunksFileSchema,
  type Facets,
  FacetsSchema,
  type Manifest,
  type QualityFlag,
  type SourceDoc,
  SourcesFileSchema,
} from './types';

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------

/** ADR-002/BACKLOG T-203: บังคับจำกัดจำนวน shard ที่สแกนต่อ query เดียว เพื่อคุมขนาดที่โหลด */
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

const ORDER_BY_SQL: Record<OrderBy, string> = {
  amount_desc: 'amount_thb DESC NULLS LAST',
  amount_asc: 'amount_thb ASC NULLS LAST',
  unit_price_desc: 'unit_price_thb DESC NULLS LAST',
  unit_price_asc: 'unit_price_thb ASC NULLS LAST',
  source_id: 'source_id ASC',
};

/** โหมด `full` = fetch ทั้ง shard แล้ว registerFileBuffer เสมอ (ADR-002 ข้อ 5) ใช้ตอน caller ขอเอง
 * หรือระบบ fallback อัตโนมัติเมื่อโหมด `range` (ค่าเริ่มต้น) query ไม่สำเร็จ */
export type QueryMode = 'range' | 'full';

// ---------------------------------------------------------------------------
// Error types — ข้อความไทยสำหรับ UI/AI เสมอ
// ---------------------------------------------------------------------------

export class QueryTooBroadError extends Error {
  readonly shardCount: number;
  constructor(shardCount: number) {
    super(
      `คำค้นกว้างเกินไป (ต้องสแกน ${shardCount.toLocaleString('th-TH')} ไฟล์ เกินเพดาน ` +
        `${MAX_SHARDS_TO_SCAN.toLocaleString('th-TH')} ไฟล์ต่อครั้ง) โปรดระบุปีงบประมาณ, ` +
        'กระทรวง/หน่วยงาน, หรือ item_key ให้แคบลงก่อนค้นหาอีกครั้ง',
    );
    this.name = 'QueryTooBroadError';
    this.shardCount = shardCount;
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

export class DocNotFoundError extends Error {
  constructor(docId: string) {
    super(`ไม่พบเอกสารต้นทาง (doc_id): ${docId}`);
    this.name = 'DocNotFoundError';
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
  truncated: boolean;
  shardsScanned: number;
  bytesHint?: number;
  coverageNotes: CoverageNote[];
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

function buildFromClause(urls: string[]): string {
  const only = urls[0];
  if (urls.length === 1 && only !== undefined) {
    return `read_parquet(${sqlStringLiteral(only)})`;
  }
  return `read_parquet([${urls.map(sqlStringLiteral).join(', ')}])`;
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
 * เมื่อ host ไม่ตอบ 206 (หรือ error อื่นระหว่างอ่านแบบ range) */
async function runWithFallback<T>(
  urls: string[],
  mode: QueryMode | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (mode === 'full') {
    await Promise.all(urls.map((url) => ensureShardRegistered(url)));
    return run();
  }
  try {
    return await run();
  } catch (rangeError) {
    try {
      await Promise.all(urls.map((url) => ensureShardRegistered(url)));
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
  const result = BudgetLineSchema.safeParse(normalized);
  return result.success ? result.data : null;
}

export async function queryLines(params: QueryLinesParams): Promise<QueryLinesResult> {
  const manifest = await loadManifest();
  const paths = resolveShardPaths(manifest, params);
  const coverageNotes = collectCoverageNotes(manifest, paths);

  if (paths.length === 0) {
    return { rows: [], totalMatched: 0, truncated: false, shardsScanned: 0, coverageNotes };
  }
  if (paths.length > MAX_SHARDS_TO_SCAN) {
    throw new QueryTooBroadError(paths.length);
  }

  const limit = clampLimit(params.limit);
  const where = buildWhereClause(params);
  const orderSql = ORDER_BY_SQL[params.orderBy ?? 'amount_desc'];
  const urls = paths.map((p) => toAbsoluteDataUrl(p));
  const fromClause = buildFromClause(urls);

  const result = await runWithFallback(urls, params.mode, async () => {
    // จังหวะที่ 1 (ADR-002 ข้อ 4): เลือกคอลัมน์แคบที่สุด (แค่ source_id) + count(*) OVER() รวมทั้งชุด
    // ที่ผ่าน WHERE (คำนวณก่อน LIMIT ตามลำดับการประมวลผลของ SQL มาตรฐาน)
    const sql1 =
      `SELECT source_id, count(*) OVER () AS __total_matched FROM ${fromClause} ` +
      `WHERE ${where.sql} ORDER BY ${orderSql} LIMIT ${String(limit)}`;
    const phase1Rows = await queryRows(sql1, where.params);
    if (phase1Rows.length === 0) {
      return { rows: [] as BudgetLine[], totalMatched: 0, truncated: false };
    }
    const totalMatched = Number(phase1Rows[0]?.['__total_matched'] ?? phase1Rows.length);
    const orderedSourceIds = phase1Rows.map((r) => String(r['source_id']));

    // จังหวะที่ 2 (ADR-002 ข้อ 4): ดึงทุกคอลัมน์ (รวม item_name_raw) เฉพาะแถวที่จะแสดงจริง (≤ 50 แถว)
    const sql2 = `SELECT * FROM ${fromClause} WHERE source_id IN (${orderedSourceIds
      .map(() => '?')
      .join(', ')})`;
    const phase2Rows = await queryRows(sql2, orderedSourceIds);
    const bySourceId = new Map(phase2Rows.map((r) => [String(r['source_id']), r]));
    const rows: BudgetLine[] = [];
    for (const sourceId of orderedSourceIds) {
      const record = bySourceId.get(sourceId);
      const parsed = record ? parseBudgetLine(record) : null;
      if (parsed) {
        rows.push(parsed);
      }
    }
    return { rows, totalMatched, truncated: totalMatched > rows.length };
  });

  return { ...result, shardsScanned: paths.length, coverageNotes };
}

// ---------------------------------------------------------------------------
// getLines / getNeighborLines
// ---------------------------------------------------------------------------

/**
 * ดึงแถวเต็ม (ทุกคอลัมน์) ตาม `source_id` — ใช้ใน citation drawer (T-407)
 *
 * ต้องระบุ `shardHints` เสมอ (path ของ shard ที่ทราบอยู่แล้วว่า source_id นี้อยู่ในไฟล์ไหน — ปกติมาจาก
 * ToolLog ของ session ที่เคย query เจอมาก่อน) เพราะการค้นย้อนกลับจาก source_id ไปหา shard โดยไม่มี
 * เบาะแสต้องสแกนทุกไฟล์ ซึ่งขัดกับเพดาน `MAX_SHARDS_TO_SCAN` (ADR-002)
 */
export async function getLines(sourceIds: string[], shardHints: string[]): Promise<BudgetLine[]> {
  if (sourceIds.length === 0) {
    return [];
  }
  if (shardHints.length === 0) {
    throw new RepoQueryError(
      'ต้องระบุ shardHints (ไฟล์ shard ที่ทราบจาก citation เดิม) เพื่อค้นหาแถวตาม source_id — ' +
        'ระบบไม่สแกนทุกไฟล์เพื่อป้องกันโหลดข้อมูลมากเกินความจำเป็น',
    );
  }
  if (shardHints.length > MAX_SHARDS_TO_SCAN) {
    throw new QueryTooBroadError(shardHints.length);
  }
  const manifest = await loadManifest();
  validateKnownShards(manifest, shardHints);
  const urls = shardHints.map((p) => toAbsoluteDataUrl(p));
  const fromClause = buildFromClause(urls);
  const records = await runWithFallback(urls, undefined, () => {
    const sql = `SELECT * FROM ${fromClause} WHERE source_id IN (${sourceIds
      .map(() => '?')
      .join(', ')})`;
    return queryRows(sql, sourceIds);
  });
  const rows: BudgetLine[] = [];
  for (const record of records) {
    const parsed = parseBudgetLine(record);
    if (parsed) {
      rows.push(parsed);
    }
  }
  return rows;
}

/** "ดูแถวใกล้เคียง" — `source_row` ± n ในไฟล์/ชีตเดียวกับ `sourceId` (T-407) */
export async function getNeighborLines(
  sourceId: string,
  n: number,
  shardHint: string,
): Promise<BudgetLine[]> {
  const [anchor] = await getLines([sourceId], [shardHint]);
  if (!anchor) {
    throw new RepoQueryError(`ไม่พบ source_id "${sourceId}" ในไฟล์ shard ที่ระบุ`);
  }
  const manifest = await loadManifest();
  validateKnownShards(manifest, [shardHint]);
  const url = toAbsoluteDataUrl(shardHint);
  const fromClause = buildFromClause([url]);
  const records = await runWithFallback([url], undefined, () => {
    const sql = `SELECT * FROM ${fromClause} WHERE source_sheet = ? AND source_row BETWEEN ? AND ?`;
    return queryRows(sql, [anchor.source_sheet, anchor.source_row - n, anchor.source_row + n]);
  });
  const rows: BudgetLine[] = [];
  for (const record of records) {
    const parsed = parseBudgetLine(record);
    if (parsed) {
      rows.push(parsed);
    }
  }
  rows.sort((a, b) => a.source_row - b.source_row);
  return rows;
}

// ---------------------------------------------------------------------------
// getDoc
// ---------------------------------------------------------------------------

export interface GetDocResult {
  doc: SourceDoc;
  chunks: DocChunk[] | null;
  note?: string;
}

export async function getDoc(docId: string, opts?: { page?: number }): Promise<GetDocResult> {
  const sources = await loadJson('sources.json', SourcesFileSchema);
  const doc = sources.find((d) => d.doc_id === docId);
  if (!doc) {
    throw new DocNotFoundError(docId);
  }
  if (!doc.extracted) {
    return {
      doc,
      chunks: null,
      note: doc.note ?? 'เอกสารนี้เป็นเอกสารสแกน ระบบไม่ได้อ่านเนื้อหา (N4)',
    };
  }
  if (!doc.text_chunks_file) {
    return { doc, chunks: null, note: 'ไม่มีไฟล์เนื้อหาที่แยกไว้สำหรับเอกสารนี้' };
  }
  const chunks = await loadJsonGz(doc.text_chunks_file, DocChunksFileSchema);
  const filtered = opts?.page !== undefined ? chunks.filter((c) => c.page === opts.page) : chunks;
  return { doc, chunks: filtered };
}

// ---------------------------------------------------------------------------
// facets
// ---------------------------------------------------------------------------

export async function facets(): Promise<Facets> {
  return loadJson('catalog/facets.json', FacetsSchema);
}

// ---------------------------------------------------------------------------
// BudgetRepo — interface เดียวที่ `ai/` ควร import (mock ง่ายในเทส: implement interface นี้ตรง ๆ)
// ---------------------------------------------------------------------------

export interface BudgetRepo {
  queryLines(params: QueryLinesParams): Promise<QueryLinesResult>;
  getLines(sourceIds: string[], shardHints: string[]): Promise<BudgetLine[]>;
  getNeighborLines(sourceId: string, n: number, shardHint: string): Promise<BudgetLine[]>;
  getDoc(docId: string, opts?: { page?: number }): Promise<GetDocResult>;
  facets(): Promise<Facets>;
}

export const budgetRepo: BudgetRepo = {
  queryLines,
  getLines,
  getNeighborLines,
  getDoc,
  facets,
};
