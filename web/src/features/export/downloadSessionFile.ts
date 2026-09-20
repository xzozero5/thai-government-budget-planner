/**
 * T-502 — Save: ประกอบ `.tgbp.json` จาก store ปัจจุบัน (`proposalStore`/`chatStore`) แล้วดาวน์โหลด
 * (05-FEATURES §5 US-5.2, 09-SECURITY §1/§8)
 *
 * แยก `buildSessionFile` (pure-ish, testable — ไม่แตะ DOM) ออกจาก `saveSessionFile`/`downloadSessionFile`
 * (มี side effect ดาวน์โหลดไฟล์จริง) ตาม CLAUDE.md §7 "logic pure แยกจาก component"
 *
 * N2/09 §1: ไม่มี field ใดของ `apiKey`/client ถูกส่งเข้า `serializeSession` เลย (อ่านจาก
 * `proposalStore`/`chatStore` เท่านั้น ซึ่งไม่มี field เหล่านั้นอยู่ในรูปแบบใน store — ดู `tgbpFile.ts`
 * หัวไฟล์) — `data.dataVersion()` (facade `@/data`) เป็นการอ่าน manifest ไฟล์ static ของเว็บเอง ไม่ใช่
 * cross-origin fetch (N5)
 */
import { data } from '@/data';
import { useChatStore } from '@/stores/chatStore';
import { getCurrentProposalVersion, useProposalStore } from '@/stores/proposalStore';
import { downloadBlob } from './downloadBlob';
import { buildTgbpFileName } from './fileNames';
import { serializeSession } from './tgbpFile';

export interface BuiltSessionFile {
  fileName: string;
  json: string;
}

/** ประกอบเนื้อหาไฟล์ + ชื่อไฟล์จาก store ปัจจุบัน — ไม่แตะ DOM/ดาวน์โหลด (ทดสอบง่าย) */
export async function buildSessionFile(): Promise<BuiltSessionFile> {
  const proposalState = useProposalStore.getState();
  const chatMessages = useChatStore.getState().messages;
  const appDataVersion = await data.dataVersion();

  const json = serializeSession({
    proposalVersions: proposalState.versions,
    currentProposalIndex: proposalState.currentIndex,
    chatMessages,
    appDataVersion,
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
