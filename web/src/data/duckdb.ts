/**
 * T-203 — DuckDB-WASM lazy singleton client
 *
 * ทุกค่า/พฤติกรรมในไฟล์นี้อ้างอิง `docs/decisions/ADR-002-duckdb-wasm-range-and-self-hosted-extension.md`
 * (บังคับ) และ `docs/decisions/SPIKES.md` §S1 (ตัวเลขที่วัดจริง) ห้ามเปลี่ยนค่า config ของ
 * `filesystem` โดยไม่อ่าน ADR-002 ก่อน — ค่า default ของ library (`{}`) โหลดทั้งไฟล์เสมอ (ผิดความคาดหมาย)
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 * ห้าม fetch ข้าม origin (N5 — CLAUDE.md §2): URL เดียวที่ยิงออกคือ (ก) asset ของ duckdb-wasm เอง
 * (bundle ผ่าน Vite `?url` — same-origin เสมอ), (ข) `custom_extension_repository` ที่ชี้กลับมาที่
 * origin ของเราเอง (ADR-002 ข้อ 2), (ค) shard parquet ที่ `repo.ts` ส่ง URL มาจาก `dataUrl()` เท่านั้น
 *
 * boundary กับ `@duckdb/duckdb-wasm`/`apache-arrow`: ทั้งสอง package พิมพ์หลายจุดเป็น `any` โดยเจตนา
 * (เช่น `arrow.Table.toArray(): any[]`) — ไฟล์นี้แคบ surface ที่แตะ duckdb-wasm ไว้ในอินเทอร์เฟซ
 * `Minimal*` ของเราเอง (ใช้ `unknown` แทน `any` เสมอที่ขอบเขตนี้) เพื่อไม่ให้ `any` รั่วออกไปที่อื่น
 */

// ต้องเป็น type-only import เท่านั้น (ถูกลบออกตอน compile ทั้งหมด — ไม่กระทบขนาด initial bundle)
// ใช้เพื่ออ้างอิงชนิดของ config ที่ผ่านให้ library จริงเท่านั้น ไม่ import ค่า runtime ใด ๆ จาก module นี้
// ที่ระดับบนสุด (การโหลดจริงเป็น `import()` แบบ dynamic ข้างล่าง เพื่อให้เป็น lazy chunk แยกจาก
// initial bundle เสมอ — ดู docs/04-ARCHITECTURE.md §5)
import type { DuckDBConfig } from '@duckdb/duckdb-wasm';

// ---------------------------------------------------------------------------
// ค่าคงที่ที่ผูกกับเวอร์ชัน @duckdb/duckdb-wasm (ADR-002 ข้อ 2) — มี test คู่กันที่
// `web/src/data/duckdb.test.ts` อ่าน package.json ตรง ๆ แล้ว fail ถ้าเวอร์ชัน lib เปลี่ยนแต่ค่านี้
// ไม่เปลี่ยนตาม (ต้องไปตรวจ extension version ใหม่ที่ตรงกับ duckdb build ของเวอร์ชันนั้นก่อนแก้)
// ---------------------------------------------------------------------------

/** เวอร์ชัน `@duckdb/duckdb-wasm` ที่ path ของ extension ด้านล่างนี้ผูกกับ (SPIKES.md §S1 สภาพแวดล้อมร่วม) */
export const EXPECTED_DUCKDB_WASM_PACKAGE_VERSION = '1.32.0';

/** โฟลเดอร์ย่อยใต้ `web/public/duckdb-ext/` ที่ vendor ไฟล์ parquet extension ไว้ (ADR-002 ข้อ 2) */
export const DUCKDB_EXTENSION_VERSION_PATH = 'v1.4.3';

/** ชื่อไฟล์ extension ที่คาดไว้ใต้ `duckdb-ext/<version>/wasm_eh/` */
export const DUCKDB_EXTENSION_FILENAME = 'parquet.duckdb_extension.wasm';

/** จำกัดหน่วยความจำของ DuckDB เอง (04 §5: "DuckDB จำกัด 512 MB") — เผื่อ headroom ให้ heap อื่นของแอป */
const DUCKDB_MEMORY_LIMIT = '400MB';

/** ADR-002 ข้อ 5: ถ้า registered buffer รวมกันเกินนี้ ให้ evict ตัวที่ใช้นานสุด (LRU) */
export const MAX_REGISTERED_SHARD_BYTES = 150 * 1024 * 1024;
/** 04 §5: "ไม่โหลดเกิน 3 ปี × 3 กระทรวงพร้อมกันโดยไม่ evict" ⇒ เพดานจำนวนไฟล์ที่ register พร้อมกัน */
export const MAX_REGISTERED_SHARDS = 9;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DuckDbInitError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DuckDbInitError';
    this.cause = cause;
  }
}

export class DuckDbQueryError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DuckDbQueryError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Progress reporting (T-408 จะใช้แสดง progress ของการ prefetch — 04 §5)
// ---------------------------------------------------------------------------

export type DuckDbPhase =
  | 'idle'
  | 'downloading-wasm'
  | 'opening'
  | 'installing-extension'
  | 'ready'
  | 'error';

export interface DuckDbProgress {
  phase: DuckDbPhase;
  loadedBytes?: number;
  totalBytes?: number;
}

export type DuckDbProgressListener = (progress: DuckDbProgress) => void;

// ---------------------------------------------------------------------------
// Minimal surface ของ duckdb-wasm ที่ไฟล์นี้ต้องการจริง ๆ (แคบกว่า type เต็มของ library มาก)
// ทำให้ inject fake ใน unit test ได้โดยไม่ต้อง implement class เต็มของ AsyncDuckDB/Connection
// ประกาศเป็น method-shorthand (ไม่ใช่ arrow-typed property) โดยตั้งใจ — ให้ TS ตรวจ compat แบบ
// bivariant ตาม convention ของ method member ใน interface ซึ่งเพียงพอสำหรับ boundary นี้
// ---------------------------------------------------------------------------

/** subset ของ `apache-arrow` row proxy ที่ใช้จริง (`toJSON()`) — ดู comment บนสุดของไฟล์ (boundary) */
interface ArrowRowLike {
  toJSON(): Record<string, unknown>;
}

/** subset ของ `arrow.Table` ที่ใช้จริง */
export interface QueryResultLike {
  toArray(): unknown[];
}

export type SqlParam = string | number | boolean | null;

export interface MinimalPreparedStatement {
  query(...params: SqlParam[]): Promise<QueryResultLike>;
  close(): Promise<void>;
}

export interface MinimalDuckDbConnection {
  query(sql: string): Promise<QueryResultLike>;
  prepare(sql: string): Promise<MinimalPreparedStatement>;
  close(): Promise<void>;
}

/** subset ของ `InstantiationProgress` จริง (มี startedAt/updatedAt ด้วยแต่เราไม่ใช้) */
export interface InstantiationProgressLike {
  bytesLoaded: number;
  bytesTotal: number;
}

export interface MinimalAsyncDuckDb {
  instantiate(
    mainModuleUrl: string,
    pthreadWorkerUrl?: string | null,
    onProgress?: (progress: InstantiationProgressLike) => void,
  ): Promise<null>;
  open(config: DuckDBConfig): Promise<void>;
  connect(): Promise<MinimalDuckDbConnection>;
  terminate(): Promise<void>;
  registerFileBuffer(name: string, buffer: Uint8Array): Promise<void>;
  dropFile(name: string): Promise<null>;
}

export interface DuckDbFactory {
  create(worker: Worker): MinimalAsyncDuckDb;
}

interface DuckDbHandle {
  db: MinimalAsyncDuckDb;
  conn: MinimalDuckDbConnection;
}

// ---------------------------------------------------------------------------
// Dependency injection seam — ใช้จริงใน production ผ่าน `defaultDeps`, ใช้ fake ใน unit test
// ผ่าน `__setDuckDbDepsForTests`
// ---------------------------------------------------------------------------

export interface DuckDbDeps {
  loadFactory: () => Promise<DuckDbFactory>;
  loadEhWasmUrl: () => Promise<string>;
  loadEhWorkerUrl: () => Promise<string>;
  createWorker: (workerScriptUrl: string) => Worker;
}

/**
 * สร้าง worker จาก `blob:` ที่ `importScripts()` ไฟล์ worker ของเรา (ไม่ใช่ `new Worker(url)` ตรง ๆ)
 * เพื่อให้ worker สืบทอด CSP ของหน้า (ADR-002 ข้อ 3 — บังคับ) worker ที่สร้างจาก URL same-origin
 * ตรง ๆ จะได้ CSP จาก response header ของสคริปต์ตัวเอง ซึ่ง GitHub Pages ตั้งไม่ได้ (04 §D8) ทำให้
 * `worker-src`/`connect-src` ใน `<meta>` ไม่มีผลกับมัน (S1 ผล 5 — ยืนยันด้วยการวัดจริง)
 *
 * ฟังก์ชันนี้เรียก `Worker`/`Blob`/`URL.createObjectURL` ของ browser จริงเท่านั้น — ไม่ถูกเรียกใน
 * unit test (ถูกแทนที่ด้วย fake ผ่าน `createWorker` ใน `DuckDbDeps` เสมอ) ถูกใช้จริงเฉพาะใน
 * Playwright e2e (`web/tests/e2e/data/**`)
 */
function createBlobWorker(workerScriptUrl: string): Worker {
  const absoluteUrl = new URL(workerScriptUrl, window.location.href).href;
  const bootstrap = `importScripts(${JSON.stringify(absoluteUrl)});`;
  const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
  // ไม่ revoke blobUrl ทันที: worker อ่าน script แบบ async ตอน construct (ยืนยันจาก spike S1 ที่ไม่
  // revoke เช่นกัน — revoke ก่อนเวลาทำให้ worker โหลด script ไม่สำเร็จในบาง browser)
  return new Worker(blobUrl);
}

/**
 * absolute same-origin URL ของ `duckdb-ext/` (ADR-002 ข้อ 2: "absolute same-origin URL ของ
 * BASE_URL + duckdb-ext") — DuckDB จะเติม `/<version>/<platform>/<extname>.duckdb_extension.wasm`
 * ต่อท้ายเองตอน `INSTALL`/`LOAD`
 */
function buildExtensionRepositoryUrl(): string {
  const base = import.meta.env.BASE_URL;
  return new URL(`${base}duckdb-ext`, window.location.origin).href;
}

const defaultDeps: DuckDbDeps = {
  loadFactory: async () => {
    // dynamic import — แยกเป็น lazy chunk เสมอ (~8.6 MB gz ตาม SPIKES §S1 ผล 6) ไม่กระทบ initial bundle
    const duckdbModule = await import('@duckdb/duckdb-wasm');
    return {
      create(worker: Worker): MinimalAsyncDuckDb {
        return new duckdbModule.AsyncDuckDB(new duckdbModule.VoidLogger(), worker);
      },
    };
  },
  loadEhWasmUrl: async () => {
    const mod = await import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url');
    return mod.default;
  },
  loadEhWorkerUrl: async () => {
    const mod = await import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url');
    return mod.default;
  },
  createWorker: createBlobWorker,
};

let currentDeps: DuckDbDeps = defaultDeps;

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let handlePromise: Promise<DuckDbHandle> | null = null;
let lastProgress: DuckDbProgress = { phase: 'idle' };
const progressListeners = new Set<DuckDbProgressListener>();

function notify(progress: DuckDbProgress): void {
  lastProgress = progress;
  for (const listener of progressListeners) {
    listener(progress);
  }
}

async function initDb(deps: DuckDbDeps): Promise<DuckDbHandle> {
  try {
    notify({ phase: 'downloading-wasm', loadedBytes: 0 });
    const [factory, wasmUrl, workerUrl] = await Promise.all([
      deps.loadFactory(),
      deps.loadEhWasmUrl(),
      deps.loadEhWorkerUrl(),
    ]);
    const worker = deps.createWorker(workerUrl);
    const db = factory.create(worker);
    // ต้องเป็น absolute URL (มี origin) ก่อนส่งให้ worker เสมอ — worker ถูกสร้างจาก `blob:` (ADR-002
    // ข้อ 3) ซึ่งมี base URL เป็นของตัวเอง (opaque) resolve URL แบบ root-relative ("/assets/...") ที่
    // Vite คืนมาจาก `?url` ไม่ได้ (พบจริงตอน integration test: "Failed to parse URL from /assets/...")
    const absoluteWasmUrl = new URL(wasmUrl, window.location.href).href;
    await db.instantiate(absoluteWasmUrl, null, (progress) => {
      notify({
        phase: 'downloading-wasm',
        loadedBytes: progress.bytesLoaded,
        totalBytes: progress.bytesTotal,
      });
    });
    notify({ phase: 'opening' });
    // ADR-002 ข้อ 1 (บังคับ) — ค่า default ของ library ทั้งสามค่านี้ทำให้โหลดทั้งไฟล์เสมอ
    // (วัดจริงใน SPIKES.md §S1 ผล 2: `{}` = 6,167,492 B ต่อ query เดียว) ต้องระบุครบทั้งสามค่านี้เอง
    await db.open({
      query: { castBigIntToDouble: true },
      allowUnsignedExtensions: false,
      filesystem: {
        forceFullHTTPReads: false,
        allowFullHTTPReads: true,
        reliableHeadRequests: true,
      },
    });
    const conn = await db.connect();
    notify({ phase: 'installing-extension' });
    await conn.query(`SET memory_limit = '${DUCKDB_MEMORY_LIMIT}'`);
    // ADR-002 ข้อ 2 (บังคับ) — self-host parquet extension แทนการปล่อยให้ library โหลดจาก
    // https://extensions.duckdb.org เอง (ละเมิด N5 — ยืนยันจริงใน SPIKES.md §S1 ผล 5)
    const repoUrl = buildExtensionRepositoryUrl();
    await conn.query(`SET custom_extension_repository = '${repoUrl}'`);
    await conn.query('INSTALL parquet');
    await conn.query('LOAD parquet');
    notify({ phase: 'ready' });
    return { db, conn };
  } catch (cause) {
    notify({ phase: 'error' });
    throw new DuckDbInitError('เตรียมเครื่องมือค้นข้อมูลงบประมาณ (DuckDB) ไม่สำเร็จ', cause);
  }
}

/** เริ่มต้น DuckDB ถ้ายังไม่เริ่ม (idempotent, singleton) — ใช้ภายใน `repo.ts` เท่านั้น */
export function getDb(): Promise<{ db: MinimalAsyncDuckDb; conn: MinimalDuckDbConnection }> {
  handlePromise ??= initDb(currentDeps).catch((err: unknown) => {
    // อย่า cache promise ที่ fail — ให้ retry ครั้งถัดไปได้ (เช่น เน็ตกลับมา)
    handlePromise = null;
    throw err;
  });
  return handlePromise;
}

/** shortcut สำหรับ `repo.ts`: ขอ connection ที่พร้อมใช้งานแล้ว (extension โหลดแล้ว) */
export async function getConnection(): Promise<MinimalDuckDbConnection> {
  const { conn } = await getDb();
  return conn;
}

/**
 * เริ่มโหลด DuckDB ล่วงหน้า (04 §5: "ต้องเริ่ม prefetch หลังผู้ใช้ใส่ key สำเร็จ") พร้อม callback
 * progress เรียกได้หลายครั้ง/หลายผู้ฟังพร้อมกัน (T-408) — ไม่ throw ถ้า init ล้มเหลว เผื่อ caller
 * ไม่ได้ await ผลลัพธ์ (แค่อยาก "จุดชนวน" การโหลด) แต่ promise ที่คืนจะ reject ถ้าอยาก await จริง
 */
export function prefetchDb(onProgress?: DuckDbProgressListener): Promise<void> {
  if (onProgress) {
    progressListeners.add(onProgress);
    onProgress(lastProgress);
  }
  return getDb().then(
    () => undefined,
    (err: unknown) => {
      throw err;
    },
  );
}

/** ปิด DuckDB + ล้าง state ของ registered shard ทั้งหมด (ไว้ใช้ตอน logout/idle clear) */
export async function closeDb(): Promise<void> {
  const promise = handlePromise;
  handlePromise = null;
  registeredShards.clear();
  if (promise) {
    try {
      const { db, conn } = await promise;
      await conn.close();
      await db.terminate();
    } catch {
      // ปิดแบบ best-effort — ไม่ต้อง rethrow ถ้าปิดไม่สำเร็จ (เช่น init เดิม fail ไปแล้ว)
    }
  }
  notify({ phase: 'idle' });
}

// ---------------------------------------------------------------------------
// Fallback mode: fetch ทั้ง shard แล้ว registerFileBuffer (ADR-002 ข้อ 5) + LRU eviction (04 §5)
// ---------------------------------------------------------------------------

interface RegisteredShardInfo {
  bytes: number;
  lastUsed: number;
}

const registeredShards = new Map<string, RegisteredShardInfo>();
let shardLruClock = 0;

function totalRegisteredBytes(): number {
  let sum = 0;
  for (const info of registeredShards.values()) {
    sum += info.bytes;
  }
  return sum;
}

async function evictLeastRecentlyUsed(db: MinimalAsyncDuckDb): Promise<void> {
  while (
    registeredShards.size > MAX_REGISTERED_SHARDS ||
    totalRegisteredBytes() > MAX_REGISTERED_SHARD_BYTES
  ) {
    let oldestUrl: string | null = null;
    let oldestUsed = Infinity;
    for (const [url, info] of registeredShards) {
      if (info.lastUsed < oldestUsed) {
        oldestUsed = info.lastUsed;
        oldestUrl = url;
      }
    }
    if (oldestUrl === null) {
      break;
    }
    await db.dropFile(oldestUrl);
    registeredShards.delete(oldestUrl);
  }
}

/**
 * ลงทะเบียน shard ทั้งไฟล์ไว้ในหน่วยความจำของ DuckDB (fallback ตาม ADR-002 ข้อ 5) — ใช้ชื่อไฟล์
 * ตรงกับ `url` เป๊ะ ๆ เพื่อให้ `read_parquet('<url เดิม>')` ใช้ buffer ที่ register แทนการยิง HTTP จริง
 * โดยไม่ต้องเปลี่ยน SQL ระหว่างโหมด `range`/`full`
 */
export async function ensureShardRegistered(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { db } = await getDb();
  const existing = registeredShards.get(url);
  if (existing) {
    existing.lastUsed = shardLruClock;
    shardLruClock += 1;
    return;
  }
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new DuckDbQueryError(`โหลดไฟล์ shard แบบเต็มไฟล์ไม่สำเร็จ (เครือข่ายขัดข้อง): ${url}`, cause);
  }
  if (!response.ok) {
    throw new DuckDbQueryError(
      `โหลดไฟล์ shard แบบเต็มไฟล์ไม่สำเร็จ (เซิร์ฟเวอร์ตอบ ${String(response.status)}): ${url}`,
    );
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  await db.registerFileBuffer(url, buffer);
  registeredShards.set(url, { bytes: buffer.byteLength, lastUsed: shardLruClock });
  shardLruClock += 1;
  await evictLeastRecentlyUsed(db);
}

/** จำนวน/รายชื่อ shard ที่ register แบบเต็มไฟล์อยู่ตอนนี้ — ไว้ตรวจใน test เท่านั้น */
export function getRegisteredShardUrlsForTests(): string[] {
  return [...registeredShards.keys()];
}

// ---------------------------------------------------------------------------
// Query helpers ที่ `repo.ts` ใช้ — คืนค่าเป็น plain record (แปลง bigint → number ที่ boundary นี้
// ตามที่ตัดสินใจไว้ใน `types.ts`)
// ---------------------------------------------------------------------------

function normalizeValue(value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

function arrowRowToRecord(row: unknown): Record<string, unknown> {
  const withToJson = row as ArrowRowLike;
  const json = withToJson.toJSON();
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

/** รัน SQL statement ที่ไม่มี parameter (ใช้เฉพาะ SET/INSTALL/LOAD ภายในไฟล์นี้เท่านั้น) */
export async function runStatement(sql: string): Promise<void> {
  const conn = await getConnection();
  await conn.query(sql);
}

/**
 * รัน prepared statement + parameters แล้วคืนเป็น array ของ plain record — จุดเดียวที่ `repo.ts`
 * เรียกเพื่อรันคำสั่งที่มีค่าจาก filter (ไม่ว่าจะเป็น AI/ผู้ใช้ป้อนมาหรือไม่) **ห้าม**ต่อค่าพวกนี้
 * เป็น string เข้าไปใน `sql` — ต้องมาเป็น `params` เท่านั้น (N-safety ของ `repo.ts`)
 */
export async function queryRows(
  sql: string,
  params: SqlParam[],
): Promise<Record<string, unknown>[]> {
  const conn = await getConnection();
  let statement: MinimalPreparedStatement;
  try {
    statement = await conn.prepare(sql);
  } catch (cause) {
    throw new DuckDbQueryError('เตรียมคำสั่งค้นหาไม่สำเร็จ', cause);
  }
  try {
    const result = await statement.query(...params);
    return result.toArray().map(arrowRowToRecord);
  } catch (cause) {
    throw new DuckDbQueryError('ค้นหาข้อมูลไม่สำเร็จ (อาจเป็นเพราะเครือข่ายหรือรูปแบบไฟล์)', cause);
  } finally {
    await statement.close();
  }
}

// ---------------------------------------------------------------------------
// Test-only seams (ตามแบบ `resetManifestCache` ใน manifest.ts) — ห้าม import จากโค้ดแอปจริง
// ---------------------------------------------------------------------------

/** แทนที่ dependency ของ duckdb.ts ด้วย fake สำหรับ unit test เท่านั้น */
export function __setDuckDbDepsForTests(overrides: Partial<DuckDbDeps>): void {
  currentDeps = { ...defaultDeps, ...overrides };
}

/** ล้าง singleton/registered shard/progress state ระหว่าง test เท่านั้น */
export function resetDuckDbForTests(): void {
  handlePromise = null;
  currentDeps = defaultDeps;
  registeredShards.clear();
  shardLruClock = 0;
  lastProgress = { phase: 'idle' };
  progressListeners.clear();
}
