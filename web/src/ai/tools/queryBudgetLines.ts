/**
 * T-302 — `query_budget_lines`: ค้นบรรทัดงบจริงผ่าน `data.queryLines` (DuckDB-WASM) เท่านั้น
 * **ห้ามให้ AI ส่ง SQL** (05 §3, 09 §3) — ทุก filter ผ่าน parameter ที่กำหนดไว้ตายตัวเท่านั้น
 *
 * **ช่องว่างของ facade ที่พบ (รายงานแล้ว)**:
 * - 05 §3 ระบุ `dataset?: string[]` (หลาย dataset พร้อมกัน) แต่ `repo.QueryLinesParams.dataset`
 *   รับได้ค่าเดียว — tool นี้ใช้แค่ตัวแรกของ array ที่ผู้ใช้ส่งมา (มี warning แจ้ง AI เมื่อส่งมากกว่า 1)
 * - 05 §3 ระบุ `keywords?: string[]` (หลายคำ) แต่ `repo.QueryLinesParams.keyword` รับ string เดียว
 *   (ILIKE '%keyword%') — ใช้แค่ตัวแรกเช่นกัน
 * - (แก้แล้ว) `getCatalogItemByKey` คืน `shardPaths` จริง → tool ส่งต่อเป็นตัวจำกัด shard ให้ `queryLines`
 *   (intersection กับ filter ปี/กระทรวง/จังหวัด) — ลดการสแกนและโอกาสชน `QueryTooBroadError`
 *
 * T-604 (main thread, รายงานปัญหาจาก eval จริง 2569-09-20, `web/tests/eval/real-runs/*.json`):
 * `keywords`/`item_key` ที่ catalog resolve ไม่เจอ ชน `QueryTooBroadError` ซ้ำ ๆ เมื่อ shard ที่ต้องสแกน
 * (ตาม fiscal_years/ministry_code ที่ให้มา) เกินเพดานแม้ auto-narrow ปีแล้ว (1 ปีก็ยังมี ~30 shard/
 * กระทรวง) — แก้โดยลอง **จัดอันดับ shard ด้วย `search_catalog`** (ข้อมูลที่มีอยู่แล้ว ไม่ใช่การเดา) ก่อน
 * ตัดปีทิ้ง เพราะรักษาช่วงปีที่ผู้ใช้ขอไว้ได้ครบกว่า — ดู `tryNarrowByCatalogSearch`/`queryWithAutoNarrow`
 */
import { z } from 'zod';
import {
  MAX_SHARDS_TO_SCAN,
  QueryTooBroadError,
  summarizeShardPaths,
  type Dataset,
  type QueryLinesParams,
  type QueryLinesResult,
} from '@/data';
import { itemKeyNotFoundWarning, suggestCatalogKeys } from './catalogKeyLookup';
import { computeImpliedUnitPriceHint } from './impliedUnitPrice';
import {
  clampRows,
  createTool,
  MAX_COVERAGE_NOTES_PER_CALL,
  MAX_RESULT_ROWS,
  truncateString,
  type ToolContext,
} from './toolKit';

const ORDER_BY_VALUES = [
  'amount_desc',
  'amount_asc',
  'unit_price_desc',
  'unit_price_asc',
  'source_id',
] as const;

/** จำนวนปีล่าสุดที่ลองค้นให้อัตโนมัติเมื่อคำค้นกว้างเกินเพดานสแกน (ลองจากมากไปน้อย) */
const AUTO_NARROW_YEAR_COUNTS = [3, 2, 1] as const;

/** จำนวน catalog item สูงสุดที่พิจารณาต่อครั้งตอนจัดอันดับ shard (เท่ากับเพดานจริงของ `searchCatalog`,
 * `data/search.ts#SEARCH_CATALOG_MAX_LIMIT` — ไม่ได้ export ผ่าน facade เพราะเป็นรายละเอียดภายในของ
 * `searchCatalog` เอง ไม่ใช่สัญญาที่ tool ควรพึ่งพาโดยตรง จึงจดค่าตรงนี้พร้อมอ้างอิงที่มา ค่านี้ผิดไปจาก
 * ต้นทาง (เช่น ลดเพดานลงในอนาคต) อย่างมากที่สุดคือได้ candidate น้อยลง ไม่ทำให้ผลผิด) */
const CATALOG_NARROW_SEARCH_LIMIT = 20;

/**
 * main thread (T-604, ยืนยันด้วย production data จริงระหว่างพัฒนา — `web/public/data`): item หนึ่ง ๆ
 * (เช่น "กล้องสำรวจแบบประมวลผลรวม total station") มักปรากฏในหลายปีงบ (`CatalogItem.shards` ครอบ
 * shard ของ**ทุกปี**ที่ item นั้นเคยตั้งงบ ไม่ใช่แค่ปีที่ผู้ใช้ขอ) — ถ้าเลือก shard ตามลำดับ
 * `detail.shardPaths` ดิบโดยไม่กรองปีก่อน จะได้ shard ของปีอื่นปนมาเต็มโควตา แล้วโดน
 * `resolveShardPaths` (`data/repo.ts`) intersect กับ `fiscalYears` ทีหลังจนเหลือ shard ที่ตรงจริง
 * น้อยกว่าที่ควร (พิสูจน์แล้วจริง: เคส "Total Station" 3 ปี ได้ shard ที่ตรงปีจริงแค่ 1 จาก 12 ที่เลือก
 * แบบไม่กรอง) ⇒ ต้องกรอง path ที่ **รู้แน่ชัด** ว่าเป็นปีอื่นทิ้งก่อน select (path ที่ parse ปีไม่ได้ เช่น
 * dataset ที่ไม่มีปีในชื่อไฟล์ ให้เก็บไว้ก่อน — `summarizeShardPaths` คืน `[]` ให้เมื่อไม่รู้จริง ๆ)
 */
function filterShardPathsByYear(paths: readonly string[], fiscalYears: number[] | undefined): string[] {
  if (fiscalYears === undefined) {
    return [...paths];
  }
  return paths.filter((path) => {
    const years = summarizeShardPaths([path]).years;
    return years.length === 0 || years.some((y) => fiscalYears.includes(y));
  });
}

/**
 * T-604 — ใช้ `search_catalog` (มีอยู่แล้ว, MiniSearch จัดอันดับความเกี่ยวข้องจริงจาก `item.key`) หา
 * catalog item ที่ตรงคำค้นที่สุด แล้ว resolve เป็น shard path จริงผ่าน `getCatalogItem` (แหล่งเดียวกับที่
 * `resolveItem` ใช้กับ `item_key`) รวมเป็นชุด ≤ `cap` shard แบบ deterministic (เรียงตามคะแนนค้นหา แล้ว
 * ตามลำดับ shardPaths ของแต่ละ item ที่กรองปีแล้ว) — คืน `undefined` เมื่อ catalog ไม่มีอะไรใกล้เคียงเลย
 * (ให้ caller fallback ไปตัดปีแทน ไม่ใช่การเดา — N7: ใช้ข้อมูลที่มีอยู่แล้วเท่านั้น)
 */
async function selectShardsBySearchCatalog(
  searchText: string,
  fiscalYears: number[] | undefined,
  cap: number,
  ctx: ToolContext,
): Promise<string[] | undefined> {
  const trimmed = searchText.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const searchResult = await ctx.data.searchCatalog(trimmed, {
    limit: CATALOG_NARROW_SEARCH_LIMIT,
    ...(fiscalYears !== undefined ? { years: fiscalYears } : {}),
  });
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const match of searchResult.matches) {
    if (selected.length >= cap) {
      break;
    }
    const detail = await ctx.data.getCatalogItem(match.item.i);
    const candidatePaths = filterShardPathsByYear(detail.shardPaths, fiscalYears);
    for (const path of candidatePaths) {
      if (selected.length >= cap) {
        break;
      }
      if (seen.has(path)) {
        continue;
      }
      seen.add(path);
      selected.push(path);
    }
  }
  return selected.length > 0 ? selected : undefined;
}

/**
 * T-604 — กลยุทธ์ที่ 1 เมื่อกว้างเกิน (ลองก่อนตัดปีเสมอถ้ามีคำค้น): เลือก shard ที่ "น่าจะมีรายการตรงมาก
 * ที่สุด" ผ่าน `search_catalog` แทนการเดา/สแกนทุกไฟล์ (เพดาน `MAX_SHARDS_TO_SCAN` มีไว้เพื่อ performance
 * ของ DuckDB-WASM ในเบราว์เซอร์ — ห้ามยกเพดาน ดู `docs/decisions/SPIKES.md`) — คง `fiscalYears` ที่ผู้ใช้
 * ขอไว้ครบ (ต่างจากกลยุทธ์ตัดปี) เพราะ `resolveShardPaths` (`data/repo.ts`) ยัง intersect shard ที่เลือก
 * กับ fiscalYears/ministryCodes/province เดิมอยู่ดี — ผลจึงถูกต้องเสมอ ไม่มีทาง exceed cap ต่อให้
 * intersect แล้วเหลือ shard น้อยกว่าที่เลือกมา (ไม่มีทางมากกว่า) คืน `undefined` เมื่อ catalog ไม่มีอะไร
 * ใกล้เคียงเลย (ให้ caller fallback ไปกลยุทธ์ตัดปีต่อ)
 */
async function tryNarrowByCatalogSearch(
  params: QueryLinesParams,
  ctx: ToolContext,
  searchText: string,
  err: QueryTooBroadError,
  warnings: string[],
): Promise<QueryLinesResult | undefined> {
  const selected = await selectShardsBySearchCatalog(
    searchText,
    params.fiscalYears,
    MAX_SHARDS_TO_SCAN,
    ctx,
  );
  if (selected === undefined) {
    return undefined;
  }
  const narrowed = await ctx.data.queryLines({ ...params, shardPaths: selected });
  const ministrySummary = summarizeShardPaths(narrowed.shardPaths);
  const ministryNote =
    ministrySummary.ministryCodes.length > 0
      ? ` (กระทรวง: ${ministrySummary.ministryCodes.join(', ')})`
      : '';
  warnings.push(
    `คำค้นกว้างเกินเพดานสแกน ระบบจึงค้นเฉพาะ ${narrowed.shardPaths.length.toLocaleString('th-TH')} ` +
      `ไฟล์ที่มีรายการตรงกับคำค้นมากที่สุดจากทั้งหมด ${err.candidateShardCount.toLocaleString('th-TH')} ` +
      `ไฟล์${ministryNote} — ผลนี้จึงไม่ครบทุกไฟล์ที่เข้าเงื่อนไข ระบุ ministry_code หรือ item_key ให้ ` +
      'เจาะจงขึ้นเพื่อค้นให้ครบ',
  );
  return narrowed;
}

/**
 * main thread (หลัง demo จริงครั้งแรก 2569-09-20): โมเดลมักส่ง `fiscal_years` กว้าง (5–11 ปี) แล้วชน
 * `QueryTooBroadError` ซ้ำ ๆ — เสียรอบ tool + เงินของผู้ใช้โดยไม่ได้ข้อมูล (3 ใน 4 ครั้งล้มใน session จริง)
 * ⇒ เมื่อกว้างเกิน ให้ค้น "ปีล่าสุดที่มีข้อมูล" ให้เองแล้วบอกตรง ๆ ใน warnings ว่าจำกัดปีไว้เท่าไร (ไม่เงียบ — N3)
 * ถ้าจำกัดเหลือ 1 ปีแล้วยังกว้างเกิน จึงค่อยคืน error เดิมให้โมเดลระบุกระทรวง/หน่วยงานเพิ่ม
 *
 * T-604: ก่อนตัดปีทิ้ง ลองกลยุทธ์ `tryNarrowByCatalogSearch` ก่อนเสมอเมื่อมี `catalogSearchText` (มาจาก
 * `keywords`/`item_key` ที่ catalog resolve แบบตรงเป๊ะไม่เจอ — ดูจุดเรียกใน `handler`) เพราะเจาะจงกว่า
 * (อิงรายการที่ตรงคำค้นจริง) และไม่ต้องเสียสละช่วงปีที่ผู้ใช้ขอ ตัดปีเป็น fallback ลำดับถัดไปเมื่อ catalog
 * ไม่มีอะไรใกล้เคียงเลย (เช่น รายการหางยาวที่ไม่เคยเข้า catalog)
 */
async function queryWithAutoNarrow(
  params: QueryLinesParams,
  ctx: ToolContext,
  warnings: string[],
  catalogSearchText: string | undefined,
): Promise<QueryLinesResult> {
  try {
    return await ctx.data.queryLines(params);
  } catch (err) {
    if (!(err instanceof QueryTooBroadError)) {
      throw err;
    }

    if (catalogSearchText !== undefined) {
      // best-effort: ความล้มเหลวของกลยุทธ์นี้ (ไม่ว่าจะ "ไม่มี match" หรือ error อื่นระหว่างเรียก
      // search_catalog/getCatalogItem เช่นเครือข่ายขัดข้อง) ต้องไม่ทำให้ทั้ง query ล้มไปด้วย — ตกไปลอง
      // กลยุทธ์ตัดปีต่อเสมอ (ท้ายสุดยังคืน `err` เดิมที่มีคำแนะนำอยู่แล้วถ้าทุกกลยุทธ์ไม่สำเร็จ)
      try {
        const narrowedByCatalog = await tryNarrowByCatalogSearch(
          params,
          ctx,
          catalogSearchText,
          err,
          warnings,
        );
        if (narrowedByCatalog !== undefined) {
          return narrowedByCatalog;
        }
      } catch {
        // ตกไปกลยุทธ์ตัดปีด้านล่าง
      }
    }

    if (err.availableYears.length === 0) {
      throw err;
    }
    const requested = params.fiscalYears;
    const candidateYears = [...err.availableYears]
      .filter((year) => requested === undefined || requested.includes(year))
      .sort((a, b) => b - a);
    for (const count of AUTO_NARROW_YEAR_COUNTS) {
      const years = candidateYears.slice(0, count);
      if (years.length === 0 || years.length === requested?.length) {
        continue;
      }
      try {
        const narrowed = await ctx.data.queryLines({ ...params, fiscalYears: years });
        const otherYears = err.availableYears.filter((year) => !years.includes(year));
        warnings.push(
          `คำค้นกว้างเกินเพดานสแกน ระบบจึงค้นเฉพาะปีงบประมาณ ${years.join(', ')} ให้อัตโนมัติ` +
            (otherYears.length > 0
              ? ` — ปีอื่นที่มีข้อมูล: ${otherYears.join(', ')} (เรียกซ้ำโดยระบุ fiscal_years ครั้งละไม่เกิน 3 ปีถ้าต้องการ)`
              : ''),
        );
        return narrowed;
      } catch (retryErr) {
        if (!(retryErr instanceof QueryTooBroadError)) {
          throw retryErr;
        }
      }
    }
    throw err;
  }
}

export const QueryBudgetLinesInputSchema = z.object({
  item_key: z
    .string()
    .max(200)
    .optional()
    .describe('item_key จาก search_catalog (auto-resolve variant สะกดต่างช่องว่าง)'),
  keywords: z
    .array(z.string().max(200))
    .max(5)
    .optional()
    .describe('คำค้นสำรอง (ใช้แค่คำแรก) นอก catalog — ต้องระบุปี/กระทรวงร่วมด้วย'),
  fiscal_years: z
    .array(z.number().int())
    .max(20)
    .optional()
    .describe(
      'พ.ศ. — ใส่ไม่เกิน ~2-3 ปีต่อครั้ง เริ่มจากปีล่าสุด (ระบบสแกนได้สูงสุด 12 ไฟล์ต่อคำขอ ' +
        'ใส่มากไปจะถูกปฏิเสธพร้อมคำแนะนำ; ระบุ item_key/ministry_code ร่วมด้วยขยายช่วงปีได้)',
    ),
  ministry_code: z.string().max(50).optional(),
  agency: z.string().max(200).optional().describe('ค้นแบบ substring ในชื่อหน่วยงาน'),
  province: z.string().max(100).optional(),
  dataset: z
    .array(z.string().max(50))
    .max(5)
    .optional()
    .describe('ชื่อ dataset เช่น pbo_disbursement (ใช้ได้ทีละ 1 ค่า)'),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  order_by: z.enum(ORDER_BY_VALUES).optional(),
  limit: z.number().int().min(1).max(MAX_RESULT_ROWS).optional(),
});
export type QueryBudgetLinesInput = z.infer<typeof QueryBudgetLinesInputSchema>;

const QUALITY_FLAGS_REQUIRE_MEDIUM = new Set([
  'upstream_ocr',
  'group_total_mismatch',
  'corrupt_row',
  'qty_parsed_low_conf',
  'qty_is_measure',
  'org_tail_uncertain',
]);

const OCR_FLAGS = new Set(['upstream_ocr', 'group_total_mismatch']);

/** AC4 (T-113/T-302): แถวที่มี flag เหล่านี้ → confidence สูงสุด = medium + หมายเหตุไทย (ADR-005) */
function confidenceNoteFor(flags: readonly string[]): string | undefined {
  const hits = flags.filter((f) => QUALITY_FLAGS_REQUIRE_MEDIUM.has(f));
  if (hits.length === 0) {
    return undefined;
  }
  if (hits.some((f) => OCR_FLAGS.has(f))) {
    return 'ตัวเลขถอดจาก OCR ของต้นทาง โปรดตรวจสอบกับหน้าเอกสารต้นฉบับก่อนใช้ยืนยัน (ADR-005)';
  }
  return `แถวนี้มีข้อบ่งชี้คุณภาพข้อมูลที่ควรตรวจสอบเพิ่มเติม (${hits.join(', ')}) ความมั่นใจสูงสุดคือระดับกลาง`;
}

const BudgetLineLiteSchema = z.object({
  source_id: z.string(),
  dataset: z.string(),
  fiscal_year_be: z.number().int(),
  gov_level: z.string(),
  ministry: z.string().nullable(),
  agency: z.string().nullable(),
  province: z.string().nullable(),
  item_name_raw: z.string(),
  item_key: z.string(),
  item_qty: z.number().nullable(),
  item_unit: z.string().nullable(),
  amount_thb: z.number().nullable(),
  unit_price_thb: z.number().nullable(),
  /** AC2: ไม่มี unit_price → 'amount_per_line' ("ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย") */
  price_basis: z.enum(['unit_price', 'amount_per_line']),
  price_basis_note: z.string().optional(),
  quality_flags: z.array(z.string()),
  max_confidence: z.enum(['medium']).optional(),
  confidence_note: z.string().optional(),
  source_doc_id: z.string(),
});

const CoverageNoteResultSchema = z.object({
  dataset: z.string(),
  fiscal_year_be: z.number().int().optional(),
  status: z.string(),
  note: z.string(),
});

/** T-308 (งาน B2) — ดูที่มา/หลักการเต็มที่ `../impliedUnitPrice.ts` */
const ImpliedUnitPriceHintResultSchema = z.object({
  value_thb: z.number(),
  support_rows: z.number().int(),
  total_rows: z.number().int(),
  method_th: z.string(),
  label: z.literal('estimate'),
});

export const QueryBudgetLinesOutputSchema = z.object({
  rows: z.array(BudgetLineLiteSchema),
  total: z.number().int(),
  truncated: z.boolean(),
  shards_loaded: z.array(z.string()),
  coverage_notes: z.array(CoverageNoteResultSchema),
  /** T-308 (งาน B2) — ค่าที่ "อาจ" เป็นราคาต่อหน่วยร่วมของแถวที่คืน (คำนวณจาก amount_thb ของแถว
   * price_basis="amount_per_line" เท่านั้น) — `null` เมื่อไม่มั่นใจพอ (ห้ามเดา) */
  implied_unit_price_hint: ImpliedUnitPriceHintResultSchema.nullable(),
  warnings: z.array(z.string()),
});
export type QueryBudgetLinesOutput = z.infer<typeof QueryBudgetLinesOutputSchema>;

interface ResolvedItem {
  itemKeys: string[];
  /** shard ที่ catalog บอกว่ามี item นี้ — undefined เมื่อ resolve ไม่เจอ (ปล่อยให้ queryLines เลือกเอง) */
  shardPaths?: string[];
  /** T-604(A): true เมื่อ catalog หา item_key นี้ไม่เจอเลย (ทั้งแบบตรงเป๊ะและ normalize ช่องว่าง) —
   * ต่างจากกรณีเจอ item แต่ shardPaths resolve ไม่ได้ (manifest ไม่มี path นั้นแล้ว) ซึ่ง itemKeys ยังมา
   * จาก catalog จริง — ใช้ตัดสินว่าควรเสนอ key ที่ใกล้เคียงเมื่อผลลัพธ์สุดท้ายว่างเปล่า */
  notFoundInCatalog: boolean;
}

async function resolveItem(
  itemKey: string | undefined,
  ctx: ToolContext,
): Promise<ResolvedItem | undefined> {
  if (itemKey === undefined) {
    return undefined;
  }
  const item = await ctx.data.getCatalogItemByKey(itemKey);
  if (item === null) {
    // resolve ไม่เจอไม่ได้แปลว่าไม่มีข้อมูล — ส่ง key เดิมตรง ๆ ต่อให้ queryLines เผื่อ match เป๊ะ
    return { itemKeys: [itemKey], notFoundInCatalog: true };
  }
  return {
    itemKeys: item.keys !== undefined && item.keys.length > 0 ? item.keys : [item.key],
    notFoundInCatalog: false,
    ...(item.shardPaths.length > 0 ? { shardPaths: item.shardPaths } : {}),
  };
}

async function handler(
  input: QueryBudgetLinesInput,
  ctx: ToolContext,
): Promise<QueryBudgetLinesOutput> {
  const warnings: string[] = [];
  if ((input.dataset?.length ?? 0) > 1) {
    warnings.push('รองรับ dataset ได้ทีละ 1 ค่าเท่านั้นในตอนนี้ — ใช้ค่าแรกที่ระบุ');
  }
  if ((input.keywords?.length ?? 0) > 1) {
    warnings.push('รองรับ keyword ได้ทีละ 1 คำเท่านั้นในตอนนี้ — ใช้คำแรกที่ระบุ');
  }

  const resolved = await resolveItem(input.item_key, ctx);
  const itemKeys = resolved?.itemKeys;
  const firstKeyword = input.keywords?.[0];
  const firstDataset = input.dataset?.[0];

  const params: QueryLinesParams = {
    ...(itemKeys !== undefined ? { itemKeys } : {}),
    ...(resolved?.shardPaths !== undefined ? { shardPaths: resolved.shardPaths } : {}),
    ...(firstKeyword !== undefined ? { keyword: firstKeyword } : {}),
    ...(input.fiscal_years !== undefined ? { fiscalYears: input.fiscal_years } : {}),
    ...(input.ministry_code !== undefined ? { ministryCodes: [input.ministry_code] } : {}),
    ...(input.agency !== undefined ? { agencyContains: input.agency } : {}),
    ...(input.province !== undefined ? { province: input.province } : {}),
    // boundary: dataset เป็นคำที่โมเดลพิมพ์มาเอง (untrusted) — ถ้าไม่ตรง enum จริงของ parquet, DuckDB
    // แค่ไม่เจอแถว (WHERE dataset = ?) ไม่ throw จึงปลอดภัยที่จะ cast โดยไม่ validate ซ้ำที่นี่
    ...(firstDataset !== undefined ? { dataset: firstDataset as Dataset } : {}),
    ...(input.min_amount !== undefined ? { minAmount: input.min_amount } : {}),
    ...(input.max_amount !== undefined ? { maxAmount: input.max_amount } : {}),
    ...(input.order_by !== undefined ? { orderBy: input.order_by } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };

  // T-604: shard candidate ให้ narrow ตอนกว้างเกิน — เฉพาะเมื่อยังไม่มี shardPaths ที่ catalog resolve
  // ไว้แน่นอนแล้ว (item_key ที่เจอตรง ๆ ใน catalog ไม่ต้องพึ่งการจัดอันดับนี้)
  const catalogSearchText =
    resolved?.shardPaths !== undefined ? undefined : (firstKeyword ?? input.item_key);

  const result = await queryWithAutoNarrow(params, ctx, warnings, catalogSearchText);

  // T-604(A): item_key ที่ catalog หาไม่เจอเลย (แม้ normalize ช่องว่างแล้ว) แล้วผลลัพธ์สุดท้ายว่างเปล่า —
  // เดิมเงียบ (total=0 ไม่มีคำอธิบาย) ทำให้โมเดลสรุปผิดว่า "ไม่มีข้อมูล" ทั้งที่ key สะกดคลาดเคลื่อน (N3)
  if (resolved?.notFoundInCatalog === true && result.totalMatched === 0 && input.item_key !== undefined) {
    // best-effort: การแนะนำ key ใกล้เคียงพลาด (เช่นเครือข่ายขัดข้องตอนเรียก search_catalog) ต้องไม่ทำให้
    // ผลลัพธ์ที่ถูกต้องอยู่แล้ว (แค่ไม่มีแถว) กลายเป็น error ทั้ง call
    try {
      const suggestions = await suggestCatalogKeys(ctx, input.item_key);
      warnings.push(itemKeyNotFoundWarning(input.item_key, suggestions));
    } catch {
      // ปล่อยผ่าน — ไม่มีคำแนะนำเพิ่มเติม แต่ผลลัพธ์หลัก (total:0) ยังถูกต้อง
    }
  }

  const rows = clampRows(result.rows).map((line) => {
    const priceBasis: 'unit_price' | 'amount_per_line' =
      line.unit_price_thb !== null ? 'unit_price' : 'amount_per_line';
    const confidenceNote = confidenceNoteFor(line.quality_flags);
    ctx.toolLog.recordSourceId(line.source_id);
    ctx.toolLog.recordDocId(line.source_doc_id);
    // T-307 H2: จำค่าจริงของแถวนี้ไว้เทียบกับ comparables/BOQ ที่ `emit_proposal` จะตรวจภายหลัง
    ctx.toolLog.recordSourceFingerprint?.(line.source_id, {
      amountThb: line.amount_thb,
      unitPriceThb: line.unit_price_thb,
      itemQty: line.item_qty,
      itemUnit: line.item_unit,
      fiscalYearBe: line.fiscal_year_be,
      agency: line.agency,
      ministry: line.ministry,
      itemNameRaw: line.item_name_raw,
      dataset: line.dataset,
    });
    const shard = result.rowShards[line.source_id];
    if (shard !== undefined) {
      ctx.toolLog.recordSourceShard(line.source_id, shard);
    }
    if (confidenceNote !== undefined) {
      ctx.toolLog.recordConfidenceCeiling(line.source_id, 'medium');
    }
    return {
      source_id: line.source_id,
      dataset: line.dataset,
      fiscal_year_be: line.fiscal_year_be,
      gov_level: line.gov_level,
      ministry: line.ministry,
      agency: line.agency,
      province: line.province,
      item_name_raw: line.item_name_raw,
      item_key: line.item_key,
      item_qty: line.item_qty,
      item_unit: line.item_unit,
      amount_thb: line.amount_thb,
      unit_price_thb: line.unit_price_thb,
      price_basis: priceBasis,
      quality_flags: line.quality_flags,
      source_doc_id: line.source_doc_id,
      ...(priceBasis === 'amount_per_line'
        ? { price_basis_note: 'ราคาต่อรายการงบ ไม่ใช่ราคาต่อหน่วย' }
        : {}),
      ...(confidenceNote !== undefined
        ? { max_confidence: 'medium' as const, confidence_note: confidenceNote }
        : {}),
    };
  });

  // T-308 (งาน B1/B2): เตือนระดับบนสุดเมื่อแถวส่วนใหญ่เป็น amount_per_line + แนบ hint ราคาต่อหน่วย
  // (ถ้าคำนวณได้อย่างมั่นใจ) — คำนวณจาก `rows` ที่คืนจริง (หลังตัด ≤50 แถวแล้ว) เท่านั้น
  const amountPerLineRows = rows.filter((r) => r.price_basis === 'amount_per_line');
  if (rows.length > 0 && amountPerLineRows.length / rows.length >= 0.5) {
    warnings.push(
      'แถวส่วนใหญ่ที่คืนเป็น price_basis="amount_per_line" — amount_thb เป็นยอดรวมต่อบรรทัดงบ ' +
        'อาจครอบคลุมหลายหน่วย ห้ามใช้เป็นราคาต่อหน่วยตรง ๆ (ดู implied_unit_price_hint ถ้ามี หรือใช้ get_price_trend)',
    );
  }
  const impliedHint = computeImpliedUnitPriceHint(amountPerLineRows.map((r) => r.amount_thb));
  if (impliedHint !== null) {
    ctx.toolLog.recordImpliedUnitPriceHint?.(impliedHint.value_thb);
  }

  return {
    rows,
    total: result.totalMatched,
    truncated: result.truncated,
    shards_loaded: result.shardPaths,
    coverage_notes: clampRows(result.coverageNotes, MAX_COVERAGE_NOTES_PER_CALL).map((n) => ({
      dataset: n.dataset,
      ...(n.fiscal_year_be !== undefined ? { fiscal_year_be: n.fiscal_year_be } : {}),
      status: n.status,
      note: truncateString(n.note),
    })),
    implied_unit_price_hint: impliedHint,
    warnings: [...warnings, ...result.warnings],
  };
}

export const queryBudgetLinesTool = createTool({
  name: 'query_budget_lines',
  description:
    'ค้นบรรทัดงบประมาณจริง (DuckDB — ไม่รับ SQL) ต้องระบุ item_key หรือ keyword+ปี/กระทรวงเสมอ ' +
    'fiscal_years ใส่ ~2-3 ปีต่อครั้งพอ ผลลัพธ์ ≤ 50 แถว — คำค้นกว้างเกินเพดานสแกนจะไม่ถูกปฏิเสธเสมอไป ' +
    'ระบบอาจเลือกค้นเฉพาะไฟล์ที่ตรงคำค้นที่สุดให้แทน (ดู warnings ว่าครบทุกไฟล์หรือไม่) ยังกว้างเกินไปจริง ๆ ' +
    'จึงถูกปฏิเสธพร้อมคำแนะนำ อ่าน coverage_notes/quality_flags ก่อนสรุปว่า "ไม่พบ" ' +
    '(ปี 2562 ข้อมูลไม่ครบ ไม่ใช่ไม่มีงบ)',
  inputSchema: QueryBudgetLinesInputSchema,
  outputSchema: QueryBudgetLinesOutputSchema,
  handler,
});
