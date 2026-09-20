/**
 * T-302/T-303 — ToolLog: ดัชนีของทุกอย่างที่ "เคยเห็นจริงใน session นี้" ผ่านผลลัพธ์ของ tool call
 * ใช้ตรวจ citation integrity ใน `emit_proposal` (04 §D4, N3): ตัวเลข/อ้างอิงใด ๆ ที่ AI ใส่ใน
 * proposal ต้องเคยปรากฏใน ToolLog ของ session เดียวกันเท่านั้น มิฉะนั้นลดเป็น `estimate` + warning
 *
 * ไฟล์นี้เป็น **in-memory index เท่านั้น** (ไม่ persist — 04 §D7/09 §1) แต่ละ tool handler
 * (`tools/*.ts`) ต้องเรียก `recordXxx` ที่เกี่ยวข้องเองหลังคำนวณผลลัพธ์สำเร็จ (ไม่ scan ผลลัพธ์แบบ
 * generic เพราะรูปร่าง output ต่างกันมากต่อ tool และบาง field เช่น `sample_source_ids` เป็น string[]
 * ตรง ๆ ไม่ใช่ object ที่มี key `source_id`)
 *
 * T-307 (security review H2) — เดิม ToolLog เก็บแค่ "id เคยปรากฏ" (Set/Map ของ string) ทำให้
 * `emit_proposal` ยืนยันได้แค่ว่า source_id/doc_id/(indicator,year) เคยปรากฏจริง แต่ตรวจ "ค่า" ที่โมเดิล
 * แต่งขึ้นประกบ id จริงไม่ได้ (N3 ถูกเลี่ยงด้วย pointer ถูก + ตัวเลขผิด) — เพิ่ม `SourceFingerprint`
 * (ค่าจริงต่อ source_id) และดัชนีข้อความ chunk เอกสาร (ต่อ `(doc_id, page)`) ให้ `validateAndNormalizeProposal`
 * (`tools/proposal.ts`) เทียบค่าจริงแทนการเช็คแค่ id
 *
 * เมธอดใหม่ทั้งหมด (fingerprint/doc chunk) เป็น **optional** ในอินเทอร์เฟซ (ไม่ใช่ required) โดยตั้งใจ —
 * เพื่อไม่ทำลาย backward-compat กับโค้ดที่ implement `ToolLog` เองนอก `ai/**` อยู่ก่อนแล้ว (เช่น
 * `web/src/app/dataHarness/aiEvalHarness/toolLogSummary.ts#createCountingToolLog` ที่ wrap ทุกเมธอด
 * แบบ object literal ตรง ๆ — ถ้าเมธอดใหม่เป็น required จะทำให้ไฟล์นั้น type-error ทันทีโดยที่เราไม่ได้รับ
 * อนุญาตให้แก้ไฟล์นั้น) โค้ดที่เรียกเมธอดเหล่านี้ต้องใช้ optional chaining (`?.`) เสมอ และมี fallback ที่
 * ปลอดภัย (เช่น "ตรวจไม่ได้ = ปล่อยผ่านเหมือนพฤติกรรมเดิม" สำหรับ document citation, ไม่ใช่ "ตรวจไม่ได้ =
 * ปฏิเสธทั้งหมด") — `createToolLog()` ของไฟล์นี้ implement ครบทุกเมธอดเสมอ
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import { normalizeForQuoteMatch } from './textNormalize';

export interface InflationAdjustmentLogEntry {
  fromAmountThb: number;
  fromYearBe: number;
  toYearBe: number;
  indicator: string;
  factor: number;
  adjustedThb: number;
}

export interface TrendRefLog {
  kind: 'item' | 'indicator';
  key: string;
}

/** ค่าจริงของแถวงบที่ tool คืนให้โมเดลเห็นจริง ต่อ `source_id` หนึ่ง ๆ (T-307 H2) — ใช้เทียบกับค่าที่
 * โมเดลใส่ใน `comparables[]`/ตรวจ traceability ของ `boq[].unit_price_thb` (basis=historical) ใน
 * `tools/proposal.ts` ไม่ใช่ค่าที่ใช้แสดงผลเอง (แสดงผลใช้ output ของ tool ตรง ๆ) */
export interface SourceFingerprint {
  amountThb: number | null;
  unitPriceThb: number | null;
  itemQty: number | null;
  itemUnit: string | null;
  fiscalYearBe: number;
  agency: string | null;
  ministry: string | null;
  itemNameRaw: string;
  dataset: string;
}

export interface ToolLog {
  recordSourceId(sourceId: string): void;
  recordSourceIds(sourceIds: Iterable<string>): void;
  /** จำ shard path ของ `sourceId` (จาก `QueryLinesResult.rowShards`) — `get_budget_line` ใช้เป็น
   * `shardHints` ของ `data.getLines` แทนที่จะต้องให้ AI ทราบ path ของไฟล์ parquet เอง */
  recordSourceShard(sourceId: string, shardPath: string): void;
  getSourceShard(sourceId: string): string | undefined;
  /** T-604(B) — จำ "shard ที่เป็นไปได้" ของ `sourceId` (จาก `CatalogItem.shards` ตอน `search_catalog`
   * คืน `sample_source_ids` — รู้แค่ว่าอยู่ใน "หนึ่งในนี้" ไม่รู้ว่าไฟล์ไหนแน่ ต่างจาก
   * `recordSourceShard`/`getSourceShard` ที่รู้ไฟล์จริงแล้วจาก `rowShards` ของ `queryLines`/`getLines`)
   * — optional เหมือนเมธอด T-307/T-308 อื่น ๆ (ดูคอมเมนต์หัวไฟล์เรื่อง backward-compat) เรียกซ้ำ
   * sourceId เดิมได้ (รวม candidate ใหม่เข้ากับของเดิม ไม่เขียนทับ) */
  recordSourceShardCandidates?(sourceId: string, shardPaths: readonly string[]): void;
  /** candidate shard ทั้งหมดที่เคยบันทึกไว้ของ `sourceId` นี้ (`[]` ถ้าไม่เคยบันทึก/รู้ shard จริงแล้ว
   * ผ่าน `recordSourceShard` แทน) — ผู้เรียก (เช่น `get_budget_line`) เป็นคนไล่ค้นเป็นชุด ๆ เอง (เพดาน
   * `MAX_SHARDS_TO_SCAN` ต่อ `getLines` ครั้งเดียว) */
  getSourceShardCandidates?(sourceId: string): readonly string[];
  recordDocId(docId: string): void;
  recordEconValue(indicator: string, yearBe: number): void;
  recordInflationAdjustment(entry: InflationAdjustmentLogEntry): void;
  recordTrendRef(ref: TrendRefLog): void;
  recordIllustrationId(illustrationId: string): void;
  recordWebUrl(url: string): void;
  /** T-303 AC 2/4: จำว่า `sourceId` นี้ต้องมี confidence สูงสุดแค่ 'medium' (แถวมี quality flag ที่
   * บังคับ หรือมาจาก catalog aggregate ที่ n < 3) — `emit_proposal` ใช้ตัดสิน cap confidence ของ
   * BoqLine ที่อ้างแถวนี้ */
  recordConfidenceCeiling(sourceId: string, ceiling: 'medium'): void;
  getConfidenceCeiling(sourceId: string): 'medium' | undefined;
  /** นับจำนวนครั้งที่เรียก `emit_proposal` ใน session นี้ (05 §5: "แก้ได้สูงสุด 2 รอบ") — คืนลำดับ
   * ครั้งนี้ (1-based) */
  recordProposalAttempt(): number;
  proposalAttemptCount(): number;

  hasSourceId(sourceId: string): boolean;
  hasDocId(docId: string): boolean;
  hasEconValue(indicator: string, yearBe: number): boolean;
  /** T-410 ข้อ 3 (หลัง demo จริง 2569-09-20) — true เมื่อเคยเรียก `get_econ_indicator` สำเร็จ (ค่าไม่ null)
   * สำหรับ `indicator` นี้ "ปีใดก็ได้" ในบทสนทนานี้ — ใช้ผ่อนเกณฑ์ `trend_ref.kind==='indicator'` ใน
   * `tools/proposal.ts`: trend_ref เป็นแค่ pointer ให้ UI โหลด series เองมาวาดกราฟ ไม่ใช่ตัวเลขอ้างอิงที่
   * ต้อง trace ค่าตรง ๆ เหมือน citation อื่น ดังนั้นการเคยเห็นตัวชี้วัดนี้จริงก็เพียงพอ ไม่จำเป็นต้องบังคับให้
   * เรียก `get_price_trend` ซ้ำสำหรับตัวชี้วัดเดียวกัน (optional เหมือนเมธอด T-307 อื่น ๆ — ดูคอมเมนต์หัวไฟล์
   * เรื่อง backward-compat; ไม่มีเมธอดนี้ = พฤติกรรมเดิมทุกประการ คือต้องผ่าน `hasTrendRef` เท่านั้น) */
  hasEconIndicatorAny?(indicator: string): boolean;
  /** คืน entry ที่ตรงทั้ง fromAmountThb/fromYearBe/toYearBe/indicator (ไม่รวม factor — ใช้เทียบ factor
   * ที่ AI ประกาศใน `price_derivation` ว่าตรงกับผลจริงของ `adjust_for_inflation` หรือไม่) */
  findInflationAdjustment(
    key: Pick<InflationAdjustmentLogEntry, 'fromAmountThb' | 'fromYearBe' | 'toYearBe' | 'indicator'>,
  ): InflationAdjustmentLogEntry | undefined;
  hasTrendRef(ref: TrendRefLog): boolean;
  hasIllustrationId(illustrationId: string): boolean;
  hasWebUrl(url: string): boolean;

  /** จำนวนภาพประกอบที่ผ่าน `emit_illustration` สำเร็จแล้วใน session นี้ (T-309: ≤ 3/proposal) */
  illustrationCount(): number;

  // -- T-307 H2: fingerprint ของค่าจริง (optional — ดูคอมเมนต์หัวไฟล์เรื่อง backward-compat) --------

  /** จำค่าจริงของแถวที่ `source_id` นี้ชี้ไป — `query_budget_lines`/`get_budget_line` เรียกทุกครั้งที่
   * คืนแถวสำเร็จ เรียกซ้ำ id เดิมได้ (ค่าล่าสุดชนะ — แถวเดิมไม่ควรเปลี่ยนค่าระหว่าง session แต่ไม่ throw) */
  recordSourceFingerprint?(sourceId: string, fingerprint: SourceFingerprint): void;
  getSourceFingerprint?(sourceId: string): SourceFingerprint | undefined;

  /** จำเนื้อหา (ข้อความ, normalize แล้วสำหรับเทียบ substring) ของ chunk ที่ `read_document` คืนให้
   * โมเดลเห็นจริง ต่อ `(docId, page)` — จำกัดขนาดรวม ≤ 200 KB ต่อ session (เกิน → chunk นั้นไม่ถูกจำ
   * เนื้อหา ทำให้ quote ที่อ้างอิงจะตรวจไม่ได้แล้วถูกตัดทิ้งเสมอ ซึ่งเป็นพฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก) */
  recordDocChunkText?(docId: string, page: number | null, text: string): void;
  /** เคยอ่านหน้านี้ของเอกสารนี้จริงหรือไม่ (ผ่าน `read_document` ที่ระบุ `page` เจาะจง) */
  hasDocPage?(docId: string, page: number): boolean;
  /** `quote` (normalize แล้วเทียบกับ chunk ที่ normalize ไว้) เป็น substring ของเนื้อหาที่เคยอ่านจริง
   * หรือไม่ — `page` เป็น `undefined`/`null` แปลว่าเทียบกับทุก chunk ของเอกสารนี้ที่เคยอ่าน (ไม่เจาะจงหน้า) */
  hasDocQuote?(docId: string, page: number | null | undefined, quote: string): boolean;

  // -- T-308 (prompt-tuning รอบ 1, งาน B): implied_unit_price_hint ที่ query_budget_lines เคยคำนวณ ------

  /** จำค่า `value_thb` ของ `implied_unit_price_hint` ที่ `query_budget_lines` เคยคืนจริงใน session นี้
   * (optional เหมือน fingerprint ด้านบน — ดูเหตุผลเรื่อง backward-compat ที่คอมเมนต์หัวไฟล์) ใช้ให้
   * `tools/proposal.ts` ตัดสินว่า `boq[].unit_price_thb` ที่ตรงกับ hint นี้ "ตรวจสอบย้อนกลับได้" แต่ต้อง
   * บังคับ `basis:"estimate"` เสมอ (เป็นการประมาณจากรูปแบบตัวเลข ไม่ใช่ข้อเท็จจริงยืนยัน) */
  recordImpliedUnitPriceHint?(valueThb: number): void;
  /** ค่า hint ทั้งหมดที่เคยบันทึกใน session นี้ (ไม่ซ้ำ) — ผู้เรียกเป็นคนตัดสินใจ tolerance เอง */
  getImpliedUnitPriceHintValues?(): readonly number[];

  /** ล้างทั้งหมด (ใช้ตอนเริ่ม session ใหม่/ทดสอบ) */
  reset(): void;
}

function econKey(indicator: string, yearBe: number): string {
  return `${indicator}|${String(yearBe)}`;
}

function trendKey(ref: TrendRefLog): string {
  return `${ref.kind}|${ref.key}`;
}

function inflationKey(
  key: Pick<InflationAdjustmentLogEntry, 'fromAmountThb' | 'fromYearBe' | 'toYearBe' | 'indicator'>,
): string {
  return `${String(key.fromAmountThb)}|${String(key.fromYearBe)}|${String(key.toYearBe)}|${key.indicator}`;
}

/** เพดานขนาดรวมของข้อความ chunk เอกสารที่จำไว้เพื่อเทียบ quote (T-307 H2) — ประมาณด้วยจำนวนไบต์ utf-8
 * ของข้อความหลัง normalize (เข้มกว่าค่าดิบเล็กน้อยเพราะ normalize ตัดช่องว่าง/วรรคตอนบางส่วนออก แต่ก็เพียง
 * พอเป็นเพดานกันหน่วยความจำบวมของ session ที่อ่านเอกสารจำนวนมาก) เกินแล้ว chunk ใหม่จะไม่ถูกจำเนื้อหา
 * (ยอมรับว่า quote ของ chunk นั้นตรวจไม่ได้แล้ว — `tools/proposal.ts` จะตัด quote ทิ้งเสมอในกรณีนี้) */
const DOC_CHUNK_TEXT_BUDGET_BYTES = 200_000;

function docChunkKey(docId: string, page: number | null): string {
  return `${docId}|${page === null ? 'null' : String(page)}`;
}

export function createToolLog(): ToolLog {
  const sourceIds = new Set<string>();
  const sourceShards = new Map<string, string>();
  const sourceShardCandidates = new Map<string, string[]>();
  const docIds = new Set<string>();
  const econValues = new Set<string>();
  const econIndicatorsSeen = new Set<string>();
  const inflationAdjustments = new Map<string, InflationAdjustmentLogEntry>();
  const trendRefs = new Set<string>();
  const illustrationIds = new Set<string>();
  const webUrls = new Set<string>();
  const confidenceCeilings = new Map<string, 'medium'>();
  let proposalAttempts = 0;

  const sourceFingerprints = new Map<string, SourceFingerprint>();
  const docPagesSeen = new Set<string>();
  const docChunkTexts = new Map<string, string[]>();
  let docChunkBudgetUsedBytes = 0;
  const impliedUnitPriceHints = new Set<number>();

  return {
    recordSourceId(sourceId) {
      sourceIds.add(sourceId);
    },
    recordSourceIds(ids) {
      for (const id of ids) {
        sourceIds.add(id);
      }
    },
    recordSourceShard(sourceId, shardPath) {
      sourceShards.set(sourceId, shardPath);
    },
    getSourceShard(sourceId) {
      return sourceShards.get(sourceId);
    },
    recordSourceShardCandidates(sourceId, shardPaths) {
      const existing = sourceShardCandidates.get(sourceId);
      if (existing === undefined) {
        sourceShardCandidates.set(sourceId, [...shardPaths]);
        return;
      }
      for (const path of shardPaths) {
        if (!existing.includes(path)) {
          existing.push(path);
        }
      }
    },
    getSourceShardCandidates(sourceId) {
      return sourceShardCandidates.get(sourceId) ?? [];
    },
    recordDocId(docId) {
      docIds.add(docId);
    },
    recordEconValue(indicator, yearBe) {
      econValues.add(econKey(indicator, yearBe));
      econIndicatorsSeen.add(indicator);
    },
    recordInflationAdjustment(entry) {
      inflationAdjustments.set(inflationKey(entry), entry);
    },
    recordTrendRef(ref) {
      trendRefs.add(trendKey(ref));
    },
    recordIllustrationId(illustrationId) {
      illustrationIds.add(illustrationId);
    },
    recordWebUrl(url) {
      webUrls.add(url);
    },
    recordConfidenceCeiling(sourceId, ceiling) {
      confidenceCeilings.set(sourceId, ceiling);
    },
    getConfidenceCeiling(sourceId) {
      return confidenceCeilings.get(sourceId);
    },
    recordProposalAttempt() {
      proposalAttempts += 1;
      return proposalAttempts;
    },
    proposalAttemptCount() {
      return proposalAttempts;
    },

    hasSourceId(sourceId) {
      return sourceIds.has(sourceId);
    },
    hasDocId(docId) {
      return docIds.has(docId);
    },
    hasEconValue(indicator, yearBe) {
      return econValues.has(econKey(indicator, yearBe));
    },
    hasEconIndicatorAny(indicator) {
      return econIndicatorsSeen.has(indicator);
    },
    findInflationAdjustment(key) {
      return inflationAdjustments.get(inflationKey(key));
    },
    hasTrendRef(ref) {
      return trendRefs.has(trendKey(ref));
    },
    hasIllustrationId(illustrationId) {
      return illustrationIds.has(illustrationId);
    },
    hasWebUrl(url) {
      return webUrls.has(url);
    },
    illustrationCount() {
      return illustrationIds.size;
    },

    recordSourceFingerprint(sourceId, fingerprint) {
      sourceFingerprints.set(sourceId, fingerprint);
    },
    getSourceFingerprint(sourceId) {
      return sourceFingerprints.get(sourceId);
    },
    recordDocChunkText(docId, page, text) {
      if (page !== null) {
        docPagesSeen.add(`${docId}|${String(page)}`);
      }
      const normalized = normalizeForQuoteMatch(text);
      const bytes = new TextEncoder().encode(normalized).length;
      if (docChunkBudgetUsedBytes + bytes > DOC_CHUNK_TEXT_BUDGET_BYTES) {
        // เกินเพดาน — จงใจไม่จำเนื้อหา chunk นี้ (ดูคอมเมนต์ที่ DOC_CHUNK_TEXT_BUDGET_BYTES)
        return;
      }
      docChunkBudgetUsedBytes += bytes;
      const key = docChunkKey(docId, page);
      const existing = docChunkTexts.get(key);
      if (existing !== undefined) {
        existing.push(normalized);
      } else {
        docChunkTexts.set(key, [normalized]);
      }
    },
    hasDocPage(docId, page) {
      return docPagesSeen.has(`${docId}|${String(page)}`);
    },
    hasDocQuote(docId, page, quote) {
      const normalizedQuote = normalizeForQuoteMatch(quote);
      if (normalizedQuote.length === 0) {
        return false;
      }
      const keys: string[] =
        page !== undefined && page !== null
          ? [docChunkKey(docId, page)]
          : [...docChunkTexts.keys()].filter((k) => k.startsWith(`${docId}|`));
      return keys.some((key) => (docChunkTexts.get(key) ?? []).some((t) => t.includes(normalizedQuote)));
    },

    recordImpliedUnitPriceHint(valueThb) {
      impliedUnitPriceHints.add(valueThb);
    },
    getImpliedUnitPriceHintValues() {
      return [...impliedUnitPriceHints];
    },

    reset() {
      sourceIds.clear();
      sourceShards.clear();
      sourceShardCandidates.clear();
      docIds.clear();
      econValues.clear();
      econIndicatorsSeen.clear();
      inflationAdjustments.clear();
      trendRefs.clear();
      illustrationIds.clear();
      webUrls.clear();
      confidenceCeilings.clear();
      proposalAttempts = 0;
      sourceFingerprints.clear();
      docPagesSeen.clear();
      docChunkTexts.clear();
      docChunkBudgetUsedBytes = 0;
      impliedUnitPriceHints.clear();
    },
  };
}
