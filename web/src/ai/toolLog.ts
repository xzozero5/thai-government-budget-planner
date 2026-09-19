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
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */

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

export interface ToolLog {
  recordSourceId(sourceId: string): void;
  recordSourceIds(sourceIds: Iterable<string>): void;
  /** จำ shard path ของ `sourceId` (จาก `QueryLinesResult.rowShards`) — `get_budget_line` ใช้เป็น
   * `shardHints` ของ `data.getLines` แทนที่จะต้องให้ AI ทราบ path ของไฟล์ parquet เอง */
  recordSourceShard(sourceId: string, shardPath: string): void;
  getSourceShard(sourceId: string): string | undefined;
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

export function createToolLog(): ToolLog {
  const sourceIds = new Set<string>();
  const sourceShards = new Map<string, string>();
  const docIds = new Set<string>();
  const econValues = new Set<string>();
  const inflationAdjustments = new Map<string, InflationAdjustmentLogEntry>();
  const trendRefs = new Set<string>();
  const illustrationIds = new Set<string>();
  const webUrls = new Set<string>();
  const confidenceCeilings = new Map<string, 'medium'>();
  let proposalAttempts = 0;

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
    recordDocId(docId) {
      docIds.add(docId);
    },
    recordEconValue(indicator, yearBe) {
      econValues.add(econKey(indicator, yearBe));
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
    reset() {
      sourceIds.clear();
      sourceShards.clear();
      docIds.clear();
      econValues.clear();
      inflationAdjustments.clear();
      trendRefs.clear();
      illustrationIds.clear();
      webUrls.clear();
      confidenceCeilings.clear();
      proposalAttempts = 0;
    },
  };
}
