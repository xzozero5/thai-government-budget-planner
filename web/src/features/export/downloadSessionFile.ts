/**
 * T-502 — Save: ประกอบ `.tgbp.json` จาก store ปัจจุบัน (`proposalStore`/`chatStore`) แล้วดาวน์โหลด
 * (05-FEATURES §5 US-5.2, 09-SECURITY §1/§8)
 *
 * แยก `buildSessionFile` (pure-ish, testable — ไม่แตะ DOM) ออกจาก `saveSessionFile`/`downloadSessionFile`
 * (มี side effect ดาวน์โหลดไฟล์จริง) ตาม CLAUDE.md §7 "logic pure แยกจาก component"
 *
 * N2/09 §1: ไม่มี field ใดของ `apiKey`/client ถูกส่งเข้า `serializeSession` เลย (อ่านจาก
 * `proposalStore`/`chatStore`/`toolLogStore` เท่านั้น ซึ่งไม่มี field เหล่านั้นอยู่ในรูปแบบใน store — ดู
 * `tgbpFile.ts` หัวไฟล์) — `data.dataVersion()` (facade `@/data`) เป็นการอ่าน manifest ไฟล์ static ของ
 * เว็บเอง ไม่ใช่ cross-origin fetch (N5)
 *
 * `sourceShards` (แก้บั๊ก: citation ที่ถูกต้องจริงในไฟล์ `.tgbp.json` เคยแสดง "อ้างอิงไม่พบ" เสมอเพราะไฟล์
 * ไม่เคยเก็บว่า budget_line แต่ละอันมาจาก shard ไหน — ดู `LoadPage.tsx`) — เก็บเฉพาะ `source_id` ที่ถูก
 * อ้างจริงใน BOQ/audit findings/citations_web ของ**ทุกเวอร์ชัน** (ไม่ใช่แค่เวอร์ชันปัจจุบัน — ผู้ใช้สลับดู
 * เวอร์ชันเก่าในไฟล์ที่โหลดกลับมาได้) โดยใช้ `buildCitationRegistry` (ตัวเดียวกับที่ PDF export ใช้รวบรวม
 * citation อยู่แล้ว — ไม่ทำ helper รวบรวม citation ซ้ำอีกชุด) แล้วหา shard ของแต่ละ id ทีละตัวผ่าน
 * `ToolLog.getSourceShard` (ยังไม่มี API ดึงหลายตัวพร้อมกัน) ไม่มี ToolLog เลย (เช่น session ที่ไม่เคยเรียก
 * AI สักครั้ง) = `sourceShards` ว่าง (`serializeSession` จะไม่เขียน field นี้ลงไฟล์เลย — เหมือนไฟล์เก่า)
 */
import type { ToolLog } from '@/ai/toolLog';
import { data } from '@/data';
import { useChatStore } from '@/stores/chatStore';
import { getCurrentProposalVersion, useProposalStore, type ProposalVersion } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { downloadBlob } from './downloadBlob';
import { buildTgbpFileName } from './fileNames';
import { buildCitationRegistry } from './pdf/citationRegistry';
import { serializeSession } from './tgbpFile';

export interface BuiltSessionFile {
  fileName: string;
  json: string;
}

/** เก็บ shard hint ของ `source_id` ที่ถูกอ้างจริงในทุกเวอร์ชันของ proposal — ไม่มี ToolLog หรือไม่มี hint
 * ของ id นั้น (เช่นยังไม่เคยเรียก tool ที่คืนแถวนี้จริงในบทสนทนานี้) ก็แค่ข้าม ไม่ throw */
function collectReferencedSourceShards(
  proposalVersions: readonly ProposalVersion[],
  toolLog: Pick<ToolLog, 'getSourceShard'> | null,
): Record<string, string> {
  if (!toolLog) {
    return {};
  }
  const shards: Record<string, string> = {};
  for (const version of proposalVersions) {
    for (const entry of buildCitationRegistry(version.proposal)) {
      if (entry.citation.kind !== 'budget_line') {
        continue;
      }
      const sourceId = entry.citation.source_id;
      if (sourceId in shards) {
        continue;
      }
      const shardPath = toolLog.getSourceShard(sourceId);
      if (shardPath !== undefined) {
        shards[sourceId] = shardPath;
      }
    }
  }
  return shards;
}

/** ประกอบเนื้อหาไฟล์ + ชื่อไฟล์จาก store ปัจจุบัน — ไม่แตะ DOM/ดาวน์โหลด (ทดสอบง่าย) */
export async function buildSessionFile(): Promise<BuiltSessionFile> {
  const proposalState = useProposalStore.getState();
  const chatMessages = useChatStore.getState().messages;
  const appDataVersion = await data.dataVersion();
  const toolLog = useToolLogStore.getState().toolLog;
  const sourceShards = collectReferencedSourceShards(proposalState.versions, toolLog);

  const json = serializeSession({
    proposalVersions: proposalState.versions,
    currentProposalIndex: proposalState.currentIndex,
    chatMessages,
    appDataVersion,
    sourceShards,
  });

  const currentVersion = getCurrentProposalVersion(proposalState);
  const fileName = buildTgbpFileName(currentVersion?.proposal.title ?? '');
  return { fileName, json };
}

export type SaveSessionFileResult = { ok: true; fileName: string } | { ok: false; error: string };

/** ประกอบไฟล์แล้วดาวน์โหลดจริง — คืนผลลัพธ์ให้ผู้เรียกที่ต้องการแสดง toast/error เอง (เช่น `ExportDialog`) */
export async function saveSessionFile(): Promise<SaveSessionFileResult> {
  try {
    const { fileName, json } = await buildSessionFile();
    downloadBlob(new Blob([json], { type: 'application/json' }), fileName);
    return { ok: true, fileName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** จุดเรียกง่าย ๆ แบบ fire-and-forget (เช่น `ProposalPane.onSave`) — ไม่มีช่องแสดง error ของตัวเอง
 * (ใช้ `saveSessionFile()` โดยตรงถ้าต้องการรู้ผล/แสดง toast) */
export function downloadSessionFile(): void {
  void saveSessionFile();
}
