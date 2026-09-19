/**
 * T-202 — manifest loader + helper อื่น ๆ ของ data layer ฝั่งเว็บ
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 * ห้าม fetch ข้าม origin (N5 — CLAUDE.md §2): ทุก URL มาจาก `dataUrl()` เท่านั้น ซึ่งต่อกับ
 * `import.meta.env.BASE_URL` (same-origin เสมอ ไม่ hard-code '/data/')
 */
import type { z } from 'zod';
import { type CoverageNote, type Dataset, type Manifest, ManifestSchema } from './types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type DataLoadErrorKind = 'network' | 'http' | 'schema';

/** Error ที่ชี้ชัดว่าปัญหาเกิดตอนไหน พร้อมข้อความไทยสำหรับแสดงใน UI ตรง ๆ */
export class DataLoadError extends Error {
  readonly kind: DataLoadErrorKind;
  override readonly cause?: unknown;

  constructor(kind: DataLoadErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'DataLoadError';
    this.kind = kind;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// dataUrl — สร้าง URL ของไฟล์ข้อมูลจาก BASE_URL เท่านั้น (ห้าม hard-code '/data/', N5)
// ---------------------------------------------------------------------------

/**
 * ตรวจว่า `path` เป็น relative path ที่ปลอดภัย: ห้ามว่าง, ห้ามขึ้นต้นด้วย '/', ห้ามมี URI scheme
 * (เช่น 'http:', 'https:') หรือขึ้นต้นด้วย '//' (protocol-relative), ห้ามมี segment '..'
 */
function assertSafeRelativePath(path: string): void {
  if (path.length === 0) {
    throw new Error('เส้นทางไฟล์ข้อมูลว่างเปล่า');
  }
  if (path.startsWith('/')) {
    throw new Error(`เส้นทางไฟล์ข้อมูลห้ามขึ้นต้นด้วย "/": ${path}`);
  }
  if (path.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    throw new Error(`เส้นทางไฟล์ข้อมูลห้ามมี scheme หรือ origin อื่น (N5): ${path}`);
  }
  if (path.split('/').includes('..')) {
    throw new Error(`เส้นทางไฟล์ข้อมูลห้ามมี ".." : ${path}`);
  }
}

/**
 * สร้าง URL ของไฟล์ใต้ `<BASE_URL>data/<path>` เสมอ (same-origin) — ห้ามเรียก origin อื่น (N5)
 * `import.meta.env.BASE_URL` มาจาก Vite `base` config (`/thai-government-budget-planner/` บน
 * GitHub Pages) — ลงท้ายด้วย '/' เสมอตาม Vite
 */
export function dataUrl(path: string): string {
  assertSafeRelativePath(path);
  const base = import.meta.env.BASE_URL;
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}data/${encodedPath}`;
}

// ---------------------------------------------------------------------------
// fetch + validate helpers ใช้ร่วมกันทั้ง loadJson และ loadJsonGz
// ---------------------------------------------------------------------------

async function fetchArrayBuffer(path: string, fetchImpl: typeof fetch): Promise<ArrayBuffer> {
  const url = dataUrl(path);
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new DataLoadError(
      'network',
      `โหลดไฟล์ข้อมูลไม่สำเร็จ (เครือข่ายขัดข้องหรือ CSP บล็อก): ${path}`,
      cause,
    );
  }
  if (!response.ok) {
    throw new DataLoadError(
      'http',
      `โหลดไฟล์ข้อมูลไม่สำเร็จ (เซิร์ฟเวอร์ตอบ ${String(response.status)}): ${path}`,
    );
  }
  try {
    return await response.arrayBuffer();
  } catch (cause) {
    throw new DataLoadError('network', `อ่านเนื้อหาไฟล์ข้อมูลไม่สำเร็จ: ${path}`, cause);
  }
}

function parseAndValidateJson<T>(path: string, jsonText: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (cause) {
    throw new DataLoadError('schema', `ไฟล์ข้อมูลไม่ใช่ JSON ที่ถูกต้อง: ${path}`, cause);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new DataLoadError(
      'schema',
      `โครงสร้างไฟล์ข้อมูลไม่ตรงกับที่คาดไว้ (${path}): ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
}

/** โหลดไฟล์ JSON ธรรมดา (ไม่ gzip) แล้ว validate ด้วย Zod schema */
export async function loadJson<T>(
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const buf = await fetchArrayBuffer(path, fetchImpl);
  const text = new TextDecoder('utf-8').decode(buf);
  return parseAndValidateJson(path, text, schema);
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

async function decompressGzip(path: string, buf: ArrayBuffer): Promise<string> {
  const stream = new Response(buf).body;
  if (!stream) {
    throw new DataLoadError('schema', `ไม่สามารถอ่าน stream ของไฟล์ gzip ได้: ${path}`);
  }
  try {
    const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressed).text();
  } catch (cause) {
    throw new DataLoadError('schema', `แตกไฟล์ gzip ไม่สำเร็จ: ${path}`, cause);
  }
}

/**
 * โหลดไฟล์ `.json.gz` แล้ว validate ด้วย Zod schema
 *
 * รองรับ 2 กรณี: (1) body เป็น gzip bytes จริง (magic bytes `1f 8b`) → แตกด้วย
 * `DecompressionStream('gzip')`, (2) host ส่ง `Content-Encoding: gzip` มาก่อนแล้ว (browser
 * แตกให้อัตโนมัติตอน `fetch`) → body เป็น JSON text อยู่แล้ว → parse ตรง ๆ
 */
export async function loadJsonGz<T>(
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const buf = await fetchArrayBuffer(path, fetchImpl);
  const bytes = new Uint8Array(buf);
  const isGzip = bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
  const text = isGzip ? await decompressGzip(path, buf) : new TextDecoder('utf-8').decode(buf);
  return parseAndValidateJson(path, text, schema);
}

// ---------------------------------------------------------------------------
// loadManifest — cache promise เดียวใน module
// ---------------------------------------------------------------------------

let manifestPromise: Promise<Manifest> | null = null;

/** ล้าง cache ของ manifest (ไว้ใช้ใน test เท่านั้น) */
export function resetManifestCache(): void {
  manifestPromise = null;
}

/** โหลด `manifest.json` (fetch + Zod validate) — cache เป็น promise เดียวต่อ module */
export function loadManifest(fetchImpl: typeof fetch = fetch): Promise<Manifest> {
  manifestPromise ??= loadJson('manifest.json', ManifestSchema, fetchImpl).catch((err: unknown) => {
    // อย่า cache promise ที่ fail — ให้เรียกซ้ำครั้งถัดไปได้ (เช่น ตอนเน็ตกลับมา)
    manifestPromise = null;
    throw err;
  });
  return manifestPromise;
}

// ---------------------------------------------------------------------------
// Helpers ที่อ่านจาก Manifest ที่โหลดแล้ว
// ---------------------------------------------------------------------------

export interface ShardPathsQuery {
  dataset?: Dataset;
  fiscalYears?: number[];
  ministryCodes?: string[];
  province?: string;
}

/** หา path ของ parquet shard ที่ตรงเงื่อนไขจาก `manifest.files` */
export function shardPathsFor(manifest: Manifest, query: ShardPathsQuery): string[] {
  return manifest.files
    .filter((file) => {
      if (query.dataset !== undefined && file.dataset !== query.dataset) {
        return false;
      }
      if (
        query.fiscalYears !== undefined &&
        (file.fiscal_year_be === null || !query.fiscalYears.includes(file.fiscal_year_be))
      ) {
        return false;
      }
      if (
        query.ministryCodes !== undefined &&
        (file.ministry_code === null || !query.ministryCodes.includes(file.ministry_code))
      ) {
        return false;
      }
      if (query.province !== undefined && file.province !== query.province) {
        return false;
      }
      return true;
    })
    .map((file) => file.path);
}

export interface CoverageNotesQuery {
  // union กับ string เฉย ๆ จะถูก TS ยุบเหลือ `string` (เสีย autocomplete) — ใช้ลูกเล่นเดียวกับ
  // `QualityFlag` ใน types.ts เพื่อให้ยังพิมพ์ค่าที่รู้จัก (Dataset) แนะนำได้ แต่ยอมรับ string อื่น
  // (เช่น dataset ใหม่ที่ manifest อาจเพิ่มในอนาคต) โดยไม่ error `no-redundant-type-constituents`
  dataset: Dataset | (string & Record<never, never>);
  fiscalYear?: number;
}

/**
 * หา coverage note ที่เกี่ยวกับ dataset (และปีถ้าระบุ) — note ที่ไม่มี `fiscal_year_be` ถือว่า
 * ครอบคลุมทุกปีของ dataset นั้น (เช่น `org_unmapped` ที่รายงานภาพรวมทั้งไฟล์)
 */
export function coverageNotesFor(manifest: Manifest, query: CoverageNotesQuery): CoverageNote[] {
  return manifest.coverage_notes.filter((note) => {
    if (note.dataset !== query.dataset) {
      return false;
    }
    if (
      query.fiscalYear !== undefined &&
      note.fiscal_year_be !== undefined &&
      note.fiscal_year_be !== query.fiscalYear
    ) {
      return false;
    }
    return true;
  });
}

/** ข้อมูลชุดนี้เป็น sample (dev/test) หรือ build เต็ม */
export function isSampleData(manifest: Manifest): boolean {
  return manifest.sample;
}
