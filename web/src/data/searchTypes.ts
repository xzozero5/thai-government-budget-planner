/**
 * T-204/T-208 — Zod schema ของไฟล์ค้นหาแบบผอมที่ `web/scripts/build-search-index.mjs` สร้าง:
 * `catalog/items-slim.json.gz` และ `catalog/search-index.json.gz`
 *
 * ห้ามแก้ `data/types.ts` (ของ T-202) — schema ของ catalog เต็ม (`CatalogItemSchema`,
 * `CatalogFileSchema`) อยู่ที่นั่น ไฟล์นี้มีแค่ schema ของไฟล์ใหม่ 2 ไฟล์นี้เท่านั้น
 *
 * ห้าม import React (module boundary — `docs/04-ARCHITECTURE.md` §3)
 */
import { z } from 'zod';

export const CATALOG_SLIM_SCHEMA_VERSION = 1;
export const SEARCH_INDEX_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// catalog/items-slim.json.gz — `docs/BACKLOG.md` T-208: key/name/n_lines/years/flags/trend +
// ดัชนี `i` เข้า `CatalogFile.items` เต็ม (`catalog/items.json.gz`, schema v2 — `data/types.ts`)
// ---------------------------------------------------------------------------

export const CatalogItemSlimSchema = z.object({
  /** index เข้า `CatalogFile.items` เต็ม (array เดียวกับที่ build-search-index.mjs วนสร้าง slim) */
  i: z.number().int().nonnegative(),
  key: z.string(),
  name: z.string(),
  n_lines: z.number().int(),
  // เก็บเป็น list ปีทั้งหมดที่พบจริง (ไม่ใช่แค่ [min,max]) เพราะข้อมูลจริงมีปีขาดช่วงได้ (เช่น
  // [2559,2560,2561,2562,2563,2564,2566,2567,2570] ไม่มี 2565/2568/2569) — ถ้าเก็บแค่ min/max
  // ตัวกรอง `years` ของ `searchCatalog` จะ false positive กับปีที่ไม่ได้ตั้งงบจริง
  years: z.array(z.number().int()),
  /** แทนสถิติ `unit_price` เต็มด้วย flag บูลีน (ลดขนาดไฟล์) — ต้องการค่าจริงให้เรียก `getCatalogItem` */
  has_unit_price: z.boolean(),
  low_specificity: z.boolean().optional(),
  /** ชื่อ shard ใน `catalog/trends/{hh}.json.gz` (มีเมื่อ n ปี ≥ 3 — ดู `data/types.ts`) */
  trend: z.string().optional(),
});
export type CatalogItemSlim = z.infer<typeof CatalogItemSlimSchema>;

export const CatalogSlimFileSchema = z.object({
  schema_version: z.literal(CATALOG_SLIM_SCHEMA_VERSION),
  /** ต้องตรงกับ `Manifest.data_version` ตอน build มิฉะนั้น slim/index อาจอ้าง shard/`i` ที่ไม่ตรงกับ
   * `catalog/items.json.gz` ที่ deploy จริง */
  data_version: z.string(),
  items: z.array(CatalogItemSlimSchema),
});
export type CatalogSlimFile = z.infer<typeof CatalogSlimFileSchema>;

// ---------------------------------------------------------------------------
// catalog/search-index.json.gz — MiniSearch@7.2.0 prebuilt index แบบ `key_only` (S2 สรุปว่าคุ้มสุด:
// เล็กกว่า `full`/`key_keys` มาก โดย query คุณภาพพอกัน เพราะ variant ของ item_key ที่ต่างกันแค่ช่องว่าง
// (`CatalogItem.keys`) ถูก `foldThai` ทำให้ tokenize เหมือนกับ `key` ตัวแทนอยู่แล้ว — ไม่ต้อง index
// ซ้ำ — ดู `docs/decisions/SPIKES.md` §S2 ผล 5 และ `docs/BACKLOG.md` T-208)
//
// MiniSearch.toJSON()/loadJS() ใช้ type `AsPlainObject` ของไลบรารีเอง ซึ่งประกาศ field เป็น `any`
// ภายใน (posting list ของ radix tree ที่ serialize แล้ว) — เป็น **boundary ของ SDK ภายนอก**
// (อนุญาตตาม CLAUDE.md §7) เรา validate แค่ระดับ envelope (field ที่จำเป็นต่อ `loadJS` มีครบ/ชนิดถูก)
// ไม่ parse ลึกเข้าไปในโครงสร้าง index เอง แล้ว cast เป็น `AsPlainObject` ตอนเรียก `MiniSearch.loadJS`
// ที่ `data/search.ts` (คอมเมนต์กำกับไว้ตรงจุดนั้นอีกที)
// ---------------------------------------------------------------------------

export const MiniSearchPlainObjectSchema = z
  .object({
    documentCount: z.number().int(),
    nextId: z.number().int(),
    documentIds: z.record(z.string(), z.unknown()),
    fieldIds: z.record(z.string(), z.number()),
    fieldLength: z.record(z.string(), z.array(z.number())),
    averageFieldLength: z.array(z.number()),
    storedFields: z.record(z.string(), z.unknown()),
    dirtCount: z.number().int().optional(),
    index: z.array(z.tuple([z.string(), z.record(z.string(), z.unknown())])),
    serializationVersion: z.number().int(),
  })
  .loose();
export type MiniSearchPlainObject = z.infer<typeof MiniSearchPlainObjectSchema>;

export const SearchIndexFileSchema = z.object({
  schema_version: z.literal(SEARCH_INDEX_SCHEMA_VERSION),
  data_version: z.string(),
  /** ต้องตรงกับ `TOKENIZER_VERSION` ใน `data/thaiText.ts` ของโค้ดที่รันอยู่ ไม่ตรง → fallback
   * build index ใน browser (ดู `data/search.ts`) */
  tokenizer_version: z.string(),
  variant: z.literal('key_only'),
  fields: z.array(z.string()),
  minisearch: MiniSearchPlainObjectSchema,
});
export type SearchIndexFile = z.infer<typeof SearchIndexFileSchema>;
