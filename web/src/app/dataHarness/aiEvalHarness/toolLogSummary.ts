/**
 * T-306 — wrapper รอบ `ai/toolLog.ts#ToolLog` ที่นับจำนวนของแต่ละชนิดไว้ด้วย (เพื่อใส่ใน
 * transcript ของ eval — "ToolLog summary" ตามสเปก T-306 ข้อ 2) โดยไม่ต้องแก้ `ai/toolLog.ts`
 * (`ToolLog` ไม่มีเมธอด enum/size สาธารณะให้อยู่แล้ว — เจตนา: ปิดไม่ให้ tool handler อื่นวน scan ทั้งก้อน)
 *
 * pure ในแง่ที่ไม่แตะ DOM/network เอง — รับ `ToolLog` จริงมา wrap แล้วคืนทั้งตัวที่ wrap แล้ว + ฟังก์ชัน
 * อ่านสรุปทุกเมื่อ (ไม่ต้อง reset ระหว่างทาง)
 */
import type { ToolLog, TrendRefLog } from '@/ai/toolLog';

export interface ToolLogSummary {
  sourceIdCount: number;
  docIdCount: number;
  econValueCount: number;
  webUrlCount: number;
  trendRefCount: number;
  illustrationCount: number;
  proposalAttemptCount: number;
}

export interface CountingToolLog {
  toolLog: ToolLog;
  summary: () => ToolLogSummary;
}

function econKey(indicator: string, yearBe: number): string {
  return `${indicator}|${String(yearBe)}`;
}

function trendKey(ref: TrendRefLog): string {
  return `${ref.kind}|${ref.key}`;
}

/** ห่อ `ToolLog` จริง 1 ตัว — ทุกเมธอด delegate ไปยัง `inner` เสมอ (พฤติกรรมเดิมไม่เปลี่ยน) ส่วนตัวนับ
 * เป็นแค่ shadow index สำหรับอ่านสรุปเท่านั้น ไม่มีผลต่อ logic ของ citation integrity */
export function createCountingToolLog(inner: ToolLog): CountingToolLog {
  const sourceIds = new Set<string>();
  const docIds = new Set<string>();
  const econValues = new Set<string>();
  const webUrls = new Set<string>();
  const trendRefs = new Set<string>();

  const toolLog: ToolLog = {
    recordSourceId(sourceId) {
      sourceIds.add(sourceId);
      inner.recordSourceId(sourceId);
    },
    recordSourceIds(ids) {
      for (const id of ids) {
        sourceIds.add(id);
      }
      inner.recordSourceIds(ids);
    },
    recordSourceShard(sourceId, shardPath) {
      inner.recordSourceShard(sourceId, shardPath);
    },
    getSourceShard(sourceId) {
      return inner.getSourceShard(sourceId);
    },
    recordDocId(docId) {
      docIds.add(docId);
      inner.recordDocId(docId);
    },
    recordEconValue(indicator, yearBe) {
      econValues.add(econKey(indicator, yearBe));
      inner.recordEconValue(indicator, yearBe);
    },
    recordInflationAdjustment(entry) {
      inner.recordInflationAdjustment(entry);
    },
    recordTrendRef(ref) {
      trendRefs.add(trendKey(ref));
      inner.recordTrendRef(ref);
    },
    recordIllustrationId(illustrationId) {
      inner.recordIllustrationId(illustrationId);
    },
    recordWebUrl(url) {
      webUrls.add(url);
      inner.recordWebUrl(url);
    },
    recordConfidenceCeiling(sourceId, ceiling) {
      inner.recordConfidenceCeiling(sourceId, ceiling);
    },
    getConfidenceCeiling(sourceId) {
      return inner.getConfidenceCeiling(sourceId);
    },
    recordProposalAttempt() {
      return inner.recordProposalAttempt();
    },
    proposalAttemptCount() {
      return inner.proposalAttemptCount();
    },
    hasSourceId(sourceId) {
      return inner.hasSourceId(sourceId);
    },
    hasDocId(docId) {
      return inner.hasDocId(docId);
    },
    hasEconValue(indicator, yearBe) {
      return inner.hasEconValue(indicator, yearBe);
    },
    findInflationAdjustment(key) {
      return inner.findInflationAdjustment(key);
    },
    hasTrendRef(ref) {
      return inner.hasTrendRef(ref);
    },
    hasIllustrationId(illustrationId) {
      return inner.hasIllustrationId(illustrationId);
    },
    hasWebUrl(url) {
      return inner.hasWebUrl(url);
    },
    illustrationCount() {
      return inner.illustrationCount();
    },
    reset() {
      sourceIds.clear();
      docIds.clear();
      econValues.clear();
      webUrls.clear();
      trendRefs.clear();
      inner.reset();
    },
  };

  return {
    toolLog,
    summary: () => ({
      sourceIdCount: sourceIds.size,
      docIdCount: docIds.size,
      econValueCount: econValues.size,
      webUrlCount: webUrls.size,
      trendRefCount: trendRefs.size,
      illustrationCount: inner.illustrationCount(),
      proposalAttemptCount: inner.proposalAttemptCount(),
    }),
  };
}
