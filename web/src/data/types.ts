/**
 * T-202 — ชนิดข้อมูล (types) + schema (Zod) ของ data layer ฝั่งเว็บ
 *
 * แหล่งความจริง: `web/tests/fixtures/data/**` (ไฟล์จริงที่ pipeline สร้าง) — ไม่ใช่แค่
 * `docs/03-DATA-PIPELINE.md`. จุดที่ fixture จริงขัดกับ spec เอกสาร (03) มีคอมเมนต์กำกับไว้ทุกจุด
 * ว่า "spec mismatch" พร้อมอธิบายว่ายึดตามอะไร
 *
 * ห้าม import React ในไฟล์นี้ (module boundary — ดู docs/04-ARCHITECTURE.md §3)
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Dataset enum (docs/03-DATA-PIPELINE.md §3.1 — ยืนยันตรงกับค่าจริงใน parquet fixture)
// ---------------------------------------------------------------------------

export const DATASETS = [
  'pbo_disbursement',
  'act_2570_draft',
  'act_2570_province',
  'local_ordinance_2570',
  'local_subsidy_2570',
  'committee_table',
] as const;

export const DatasetSchema = z.enum(DATASETS);
export type Dataset = z.infer<typeof DatasetSchema>;

// gov_level: central/local ยืนยันจาก fixture; state_enterprise มาจาก spec 03 §3.1 (ยังไม่พบใน
// fixture ตัวอย่าง — เก็บไว้เพราะเป็น controlled vocabulary ของ pipeline ไม่ใช่ raw data)
export const GOV_LEVELS = ['central', 'local', 'state_enterprise'] as const;
export const GovLevelSchema = z.enum(GOV_LEVELS);
export type GovLevel = z.infer<typeof GovLevelSchema>;

// ---------------------------------------------------------------------------
// QualityFlag — union ของ flag ที่พบจริง (ใน fixture parquet + spec 03 §3.1/§6/§7) + string fallback
// (ค่าที่ pipeline อาจเพิ่มในอนาคตยังต้อง parse ผ่านได้ — ไม่ fail ทั้งไฟล์เพราะ flag ใหม่หนึ่งค่า)
// ---------------------------------------------------------------------------

export const KNOWN_QUALITY_FLAGS = [
  // พบจริงใน web/tests/fixtures/data/budget_lines/**/*.parquet (คอลัมน์ quality_flags)
  'ministry_unmapped',
  'lump_sum_category',
  'org_tail_uncertain',
  'qty_is_measure',
  'org_unmapped',
  'qty_parsed_low_conf',
  'subset_of_act_2570_draft',
  // กล่าวถึงใน docs/03-DATA-PIPELINE.md แต่ยังไม่พบใน fixture ตัวอย่าง (เก็บไว้เพื่อ autocomplete)
  'ocr_suspect',
  'amount_outlier',
  'negative_amount',
  'group_total_mismatch',
  'corrupt_row',
  'unit_price_outlier',
] as const;

type KnownQualityFlag = (typeof KNOWN_QUALITY_FLAGS)[number];
/** union ของ flag ที่ยืนยันแล้ว + string fallback (ค่าอื่นที่ pipeline สร้างในอนาคต) */
export type QualityFlag = KnownQualityFlag | (string & Record<never, never>);

// รับ string อะไรก็ได้ตอน validate runtime (permissive) แต่ type ฝั่ง TS แนะนำค่าที่รู้จักก่อน
export const QualityFlagSchema = z.string() as unknown as z.ZodType<QualityFlag>;

// ---------------------------------------------------------------------------
// BudgetLine (docs/03-DATA-PIPELINE.md §3.1) — ตามคอลัมน์จริงใน parquet ที่ publish แล้ว
// (ไม่มี item_name (clean), location_text, fiscal_year_ce — ตัดออกตอน publish เพื่อคุมขนาด
// ตาม "หมายเหตุ publish" ท้าย §3.1 — ยืนยันจาก schema จริงของทุก shard ใน fixture)
//
// ตัวเงิน (amount_thb, unit_price_thb, revised_thb, po_thb, disbursed_thb,
// disbursed_incl_po_thb, reserved_thb, carryover_thb) เป็นคอลัมน์ parquet ชนิด int64 —
// เมื่ออ่านผ่าน parquet reader (เช่น hyparquet) จะได้ค่าเป็น `bigint` ของ JS
// **ตัดสินใจ**: แปลงเป็น `number` ที่ boundary ของการอ่านข้อมูล (ก่อนเข้าสู่ BudgetLineSchema นี้)
// เพราะค่าสูงสุดที่พบจริงในข้อมูลตัวอย่าง ~2.44e10 บาท และเพดานที่เป็นไปได้ในทางปฏิบัติ ~1e13 บาท
// (งบประมาณแผ่นดินไทยทั้งประเทศต่อปี ระดับ ~3-4 ล้านล้านบาท = ~4e12) ยังต่ำกว่า
// Number.MAX_SAFE_INTEGER (2^53-1 ≈ 9.007e15) มาก จึงไม่มี precision loss จากการแปลง bigint→number
// ---------------------------------------------------------------------------

export const BudgetLineSchema = z.object({
  source_id: z.string(),
  dataset: DatasetSchema,
  fiscal_year_be: z.number().int(),
  gov_level: GovLevelSchema,
  ministry: z.string().nullable(),
  ministry_code: z.string().nullable(),
  agency: z.string().nullable(),
  agency_code: z.string().nullable(),
  province: z.string().nullable(),
  local_gov_name: z.string().nullable(),
  strategy: z.string().nullable(),
  budget_group: z.string().nullable(),
  plan: z.string().nullable(),
  output_project: z.string().nullable(),
  activity: z.string().nullable(),
  budget_type: z.string().nullable(),
  expense_category: z.string().nullable(),
  // พบว่า nullable จริงใน fixture (250/998 แถวเป็น null) แม้ schema.py ต้นทางจะประกาศเป็น bool
  is_capital: z.boolean().nullable(),
  item_name_raw: z.string(),
  item_key: z.string(),
  item_qty: z.number().nullable(),
  item_unit: z.string().nullable(),
  spec_tokens: z.array(z.string()),
  // --- ตัวเงิน: number หลังแปลงจาก bigint ที่ boundary (ดูคอมเมนต์ด้านบน) ---
  amount_thb: z.number().nullable(),
  unit_price_thb: z.number().nullable(),
  revised_thb: z.number().nullable(),
  po_thb: z.number().nullable(),
  disbursed_thb: z.number().nullable(),
  disbursed_incl_po_thb: z.number().nullable(),
  reserved_thb: z.number().nullable(),
  carryover_thb: z.number().nullable(),
  disbursement_rate: z.number().nullable(),
  description: z.string().nullable(),
  legal_reference: z.string().nullable(),
  source_path: z.string(),
  source_sheet: z.string(),
  source_row: z.number().int(),
  source_page: z.number().int().nullable(),
  source_doc_id: z.string(),
  quality_flags: z.array(QualityFlagSchema),
});
export type BudgetLine = z.infer<typeof BudgetLineSchema>;

/** ชื่อคอลัมน์ทั้งหมดของ BudgetLine ตามลำดับจริงใน parquet (ไว้เทียบ schema ใน test) */
export const BUDGET_LINE_COLUMNS = Object.keys(BudgetLineSchema.shape) as (keyof BudgetLine)[];

// ---------------------------------------------------------------------------
// SourceDoc (docs/03-DATA-PIPELINE.md §3.2)
// spec mismatch: fixture จริงมี field เพิ่ม 2 ตัวที่ไม่อยู่ในตัวอย่าง JSON ของ §3.2 คือ
// `level` (string|null — คำอธิบาย "งบระดับ" เช่น "งบ อบจ. เชียงใหม่") และ `n_chunks` (number|null)
// ---------------------------------------------------------------------------

export const SOURCE_DOC_KINDS = ['pdf', 'xlsx', 'xls', 'docx', 'pptx', 'jpg', 'other'] as const;
export const SourceDocKindSchema = z.enum(SOURCE_DOC_KINDS);

export const SOURCE_DOC_COLLECTIONS = ['committee', 'province_budget', 'open_sso', 'pbo'] as const;
export const SourceDocCollectionSchema = z.enum(SOURCE_DOC_COLLECTIONS);

export const SourceDocSchema = z.object({
  doc_id: z.string(),
  rel_path: z.string(),
  kind: SourceDocKindSchema,
  bytes: z.number().int(),
  sha1: z.string(),
  pages: z.number().int().nullable(),
  has_text_layer: z.boolean().nullable(),
  extracted: z.boolean(),
  title_guess: z.string().nullable(),
  collection: SourceDocCollectionSchema,
  meeting_no: z.number().int().nullable(),
  meeting_date: z.string().nullable(),
  topic: z.string().nullable(),
  agency_guess: z.string().nullable(),
  province: z.string().nullable(),
  gov_level: GovLevelSchema.nullable(),
  // spec mismatch: ไม่มีใน docs/03 §3.2 ตัวอย่าง JSON — พบจริงใน sources.json fixture
  level: z.string().nullable(),
  fiscal_years: z.array(z.number().int()),
  text_chunks_file: z.string().nullable(),
  // spec mismatch: ไม่มีใน docs/03 §3.2 ตัวอย่าง JSON — พบจริงใน sources.json fixture
  n_chunks: z.number().int().nullable(),
  note: z.string().nullable(),
  duplicates: z.array(z.string()).nullable(),
});
export type SourceDoc = z.infer<typeof SourceDocSchema>;

export const SourcesFileSchema = z.array(SourceDocSchema);
export type SourcesFile = z.infer<typeof SourcesFileSchema>;

// ---------------------------------------------------------------------------
// DocChunk (docs/03-DATA-PIPELINE.md §3.3) — docs/<doc_id>.json.gz คือ array ของ DocChunk
// (ไม่ใช่ object เดี่ยว) — ยืนยันจาก fixture
// จึงกำหนดกว้าง ๆ เป็น string | number | null ตามที่ pdfplumber.extract_tables() มักคืนมา
// ---------------------------------------------------------------------------

const DocTableCellSchema = z.union([z.string(), z.number(), z.null()]);
// ยืนยันกับ production (142 ไฟล์ / 29,288 chunks, 20 ก.ย. 2569): ตารางจาก PDF = `{rows}` (เลขหน้าอยู่ที่
// chunk), ตารางจาก xlsx/xls = `{sheet, rows}`; `page` ของ chunk เป็น null สำหรับ xlsx/docx
// (pptx ใช้ลำดับสไลด์); cell เป็น string ทั้งหมดในข้อมูลจริง (เผื่อ number/null ไว้)
const DocTableSchema = z.object({
  page: z.number().int().optional(),
  sheet: z.string().optional(),
  rows: z.array(z.array(DocTableCellSchema)),
});

export const DocChunkSchema = z.object({
  doc_id: z.string(),
  page: z.number().int().nullable(),
  chunk_no: z.number().int(),
  text: z.string(),
  tables: z.array(DocTableSchema),
});
export type DocChunk = z.infer<typeof DocChunkSchema>;

export const DocChunksFileSchema = z.array(DocChunkSchema);
export type DocChunksFile = z.infer<typeof DocChunksFileSchema>;

// ---------------------------------------------------------------------------
// Catalog v2 (docs/03-DATA-PIPELINE.md §3.4 — schema_version 2 ตาม output จริง)
// ---------------------------------------------------------------------------

const CatalogStatsSchema = z.object({
  min: z.number(),
  p25: z.number(),
  median: z.number(),
  p75: z.number(),
  max: z.number(),
  n: z.number().int(),
});

export const CatalogItemSchema = z.object({
  key: z.string(),
  keys: z.array(z.string()).optional(),
  keys_truncated: z.boolean().optional(),
  name: z.string(),
  n_lines: z.number().int(),
  years: z.array(z.number().int()),
  top_agencies: z.array(z.string()),
  unit_price: CatalogStatsSchema.optional(),
  amount: CatalogStatsSchema.optional(),
  sample_source_ids: z.array(z.string()),
  // index เข้า CatalogFile.shard_paths — ไม่ cap จำนวน (ตาม catalog_scope ใน manifest)
  shards: z.array(z.number().int()),
  // ชื่อ shard ใน catalog/trends/{hh}.json.gz
  trend: z.string().optional(),
  low_specificity: z.boolean().optional(),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const CatalogFileSchema = z.object({
  schema_version: z.literal(2),
  shard_paths: z.array(z.string()),
  items: z.array(CatalogItemSchema),
});
export type CatalogFile = z.infer<typeof CatalogFileSchema>;

// ---------------------------------------------------------------------------
// Trends (docs/03-DATA-PIPELINE.md §3.4 ท้าย) — catalog/trends/{hh}.json.gz
//
// ยืนยันกับข้อมูล production จริง (main thread, 20 ก.ย. 2569 — สแกน 40 shards / 3,742 entries):
// - ไฟล์ shard เป็น **map** จาก key ตัวแทน (= `CatalogItem.key`) → entry; หลาย entry ต่อไฟล์
//   (hh = 2 hex แรกของ sha1(group_key))
// - entry = `{key, basis, series}` — ใช้ `key` เสมอ (fixture รุ่นเก่าที่มี `item_key` คือไฟล์ค้าง
//   จากบั๊ก `tgbp sample` ซึ่งแก้แล้ว); ไม่มี top-level `unit`
// - basis มี 2 ค่า และ **ไม่ปนกันใน series เดียว**:
//   - `amount_per_line`     → จุดมี `median_amount_thb` (ไม่มี p25/p75)
//   - `unit_price_per_line` → จุดมี `median_unit_price_thb`, `p25`, `p75` (พบน้อยมาก ~0.05 %
//     เพราะข้อมูลต้นทางส่วนใหญ่ไม่ระบุจำนวน)
// - จุดของปี 2562 มี `note: "source_incomplete"` (ADR-004)
// ---------------------------------------------------------------------------

export const TREND_BASES = ['amount_per_line', 'unit_price_per_line'] as const;
export const TrendBasisSchema = z.enum(TREND_BASES);
export type TrendBasis = z.infer<typeof TrendBasisSchema>;

export const TrendPointSchema = z.object({
  year_be: z.number().int(),
  n: z.number().int(),
  median_amount_thb: z.number().optional(),
  median_unit_price_thb: z.number().optional(),
  p25: z.number().optional(),
  p75: z.number().optional(),
  note: z.string().optional(),
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const TrendSeriesSchema = z
  .object({
    key: z.string(),
    basis: TrendBasisSchema,
    series: z.array(TrendPointSchema),
  })
  .refine(
    (v) =>
      v.series.every((p) =>
        v.basis === 'amount_per_line'
          ? p.median_amount_thb !== undefined
          : p.median_unit_price_thb !== undefined,
      ),
    { message: 'ทุกจุดใน series ต้องมีค่า median ที่ตรงกับ basis' },
  );
export type TrendSeries = z.infer<typeof TrendSeriesSchema>;

/** ไฟล์ catalog/trends/{hh}.json.gz คือ map จาก item-key string → TrendSeries (ไม่ใช่ object เดียว) */
export const TrendShardSchema = z.record(z.string(), TrendSeriesSchema);
export type TrendShard = z.infer<typeof TrendShardSchema>;

// ---------------------------------------------------------------------------
// Facets (catalog/facets.json)
// ---------------------------------------------------------------------------

const FacetCountStringSchema = z.object({ count: z.number().int(), value: z.string() });
const FacetCountNumberSchema = z.object({ count: z.number().int(), value: z.number() });

// CoverageNote (ใช้ร่วมกันทั้งใน manifest.json และ catalog/facets.json)
export const CoverageNoteSchema = z.object({
  dataset: z.string(),
  fiscal_year_be: z.number().int().optional(),
  status: z.string(),
  coverage_pct: z.number().optional(),
  missing_ministries: z.array(z.string()).optional(),
  partial_ministries: z.array(z.string()).optional(),
  note: z.string(),
  decision_ref: z.string(),
  n_rows: z.number().int().optional(),
  n_unmapped: z.number().int().optional(),
  pct_unmapped: z.number().optional(),
});
export type CoverageNote = z.infer<typeof CoverageNoteSchema>;

export const FacetsSchema = z.object({
  budget_types: z.array(FacetCountStringSchema),
  coverage_notes: z.array(CoverageNoteSchema),
  datasets: z.array(FacetCountStringSchema),
  fiscal_years: z.array(FacetCountNumberSchema),
  ministries: z.array(FacetCountStringSchema),
  provinces: z.array(FacetCountStringSchema),
});
export type Facets = z.infer<typeof FacetsSchema>;

// ---------------------------------------------------------------------------
// OrgRecord (catalog/orgs.json)
// ---------------------------------------------------------------------------

// พบจริงใน fixture แค่ 'ministry' | 'agency' (org master มาจาก A2 Data Dict เท่านั้น — 03 §5.3
// ระบุว่า อปท. ไม่ผ่าน fuzzy match กับ master นี้ จึงไม่คาดว่าจะมี level อื่นในไฟล์นี้)
export const ORG_LEVELS = ['ministry', 'agency'] as const;
export const OrgLevelSchema = z.enum(ORG_LEVELS);

export const OrgRecordSchema = z.object({
  code: z.string(),
  name: z.string(),
  level: OrgLevelSchema,
  ministry_code: z.string().nullable(),
  aliases: z.array(z.string()),
  synthetic: z.boolean(),
});
export type OrgRecord = z.infer<typeof OrgRecordSchema>;

export const OrgsFileSchema = z.array(OrgRecordSchema);
export type OrgsFile = z.infer<typeof OrgsFileSchema>;

// ---------------------------------------------------------------------------
// EconIndicator (docs/03-DATA-PIPELINE.md §3.5)
// ---------------------------------------------------------------------------

export const EconIndicatorRecordSchema = z.object({
  indicator: z.string(),
  year_ce: z.number().int(),
  year_be: z.number().int(),
  value: z.number().nullable(),
  unit: z.string(),
  source_name: z.string(),
  source_url: z.string(),
  retrieved_at: z.string(),
  verified: z.boolean(),
  note: z.string(),
});
export type EconIndicatorRecord = z.infer<typeof EconIndicatorRecordSchema>;

const EconSeriesPointSchema = z.object({
  year_be: z.number().int(),
  value: z.number(),
});

export const EconIndicatorSeriesSchema = z.object({
  indicator: z.string(),
  label_th: z.string(),
  unit: z.string(),
  points: z.array(EconSeriesPointSchema),
  source_name: z.string(),
  source_url: z.string(),
  verified: z.boolean(),
});
export type EconIndicatorSeries = z.infer<typeof EconIndicatorSeriesSchema>;

export const EconIndicatorsFileSchema = z.object({
  schema_version: z.number().int(),
  records: z.array(EconIndicatorRecordSchema),
  series: z.array(EconIndicatorSeriesSchema),
});
export type EconIndicatorsFile = z.infer<typeof EconIndicatorsFileSchema>;

// ---------------------------------------------------------------------------
// Manifest (docs/03-DATA-PIPELINE.md §7 + manifest.json fixture จริง)
// ---------------------------------------------------------------------------

export const ManifestFileSchema = z.object({
  path: z.string(),
  bytes: z.number().int(),
  sha256: z.string(),
  rows: z.number().int().nullable(),
  dataset: DatasetSchema.nullable(),
  fiscal_year_be: z.number().int().nullable(),
  ministry_code: z.string().nullable(),
  province: z.string().nullable(),
});
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

const CatalogThresholdTriedSchema = z.object({
  n_lines: z.number().int(),
  n_years: z.number().int(),
  n_unit_price_distinct: z.number().int(),
  count: z.number().int(),
  gz_bytes: z.number().int(),
});

const CatalogThresholdSchema = z.object({
  min_lines: z.number().int(),
  min_years: z.number().int(),
  min_unit_price_distinct: z.number().int(),
  n_entries: z.number().int(),
  n_low_specificity: z.number().int(),
  thresholds_tried: z.array(CatalogThresholdTriedSchema),
});

// ใช้ z.record(z.string(), ...) แทน z.record(DatasetSchema, ...) โดยตั้งใจ: zod v4 ทำให้ record ที่
// key เป็น enum ต้อง "ครบทุก key" (exhaustive) — เข้มเกินไปสำหรับข้อมูลจริงที่อาจไม่มีบาง dataset
// ในบาง build (เช่น sample เล็กที่ไม่มี local_subsidy_2570 เลย)
const ManifestTotalsSchema = z.object({
  files: z.number().int(),
  bytes: z.number().int(),
  rows_by_dataset: z.record(z.string(), z.number().int()),
});

export const ManifestSchema = z.object({
  schema_version: z.number().int(),
  data_version: z.string(),
  built_at: z.string(),
  sample: z.boolean(),
  totals: ManifestTotalsSchema,
  files: z.array(ManifestFileSchema),
  catalog_scope: z.string(),
  coverage_notes: z.array(CoverageNoteSchema),
  catalog_threshold: CatalogThresholdSchema,
});
export type Manifest = z.infer<typeof ManifestSchema>;
