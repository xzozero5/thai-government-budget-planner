/**
 * T-403 — `toolLogStore`: จุดเข้าถึง `ToolLog`/`IllustrationSink` ของ session ปัจจุบันสำหรับ UI
 * (04 §D7 ระบุ slice `toolLog`) — citation drawer (T-407) อ่าน `toolLog`/`illustrationSink` ผ่านสโตร์
 * นี้ได้ตรง ๆ
 *
 * **ไม่ได้เก็บสำเนาข้อมูลของ ToolLog ในสโตร์** (T-403 brief: "ToolLog/illustrationSink อยู่ตลอด
 * session ... ต้องเข้าถึงได้จาก UI citation drawer ผ่าน getter") — `ai/session/chatController.ts`
 * เป็นเจ้าของ instance จริงตลอด session แล้ว `attach()` reference (ไม่ใช่สำเนา) เข้ามาที่นี่ครั้งเดียว
 * ตอนสร้าง controller ทั้งสอง object นี้ไม่มี key/apiKey ปนอยู่เลย (`ToolLog`/`IllustrationSink` เก็บแค่
 * id/ตัวเลข/SVG ที่ sanitize แล้ว) จึงอ้างอิงใน Zustand ได้อย่างปลอดภัยตาม N2 — ประเด็นเดียวที่ต้อง
 * ระวังคือการ "มองเห็นการเปลี่ยนแปลง" ของ React เพราะ mutate object เดิมไม่ trigger re-render เอง จึงมี
 * `version` (ตัวเลขที่ `bump()` ทุกครั้งหลัง tool call ใหม่) ให้ subscribe เป็น invalidation signal
 */
import { create } from 'zustand';
import type { IllustrationSink } from '@/ai/illustrationSink';
import type { ToolLog } from '@/ai/toolLog';

export interface ToolLogStoreState {
  toolLog: ToolLog | null;
  illustrationSink: IllustrationSink | null;
  /** เพิ่มขึ้นทุกครั้งที่ `bump()` ถูกเรียก — subscribe ค่านี้เพื่อรู้ว่าควรอ่าน `toolLog`/
   * `illustrationSink` ใหม่ (ตัว object ไม่ immutable) */
  version: number;

  attach: (toolLog: ToolLog, illustrationSink: IllustrationSink) => void;
  bump: () => void;
  reset: () => void;
}

export const useToolLogStore = create<ToolLogStoreState>((set) => ({
  toolLog: null,
  illustrationSink: null,
  version: 0,

  attach(toolLog, illustrationSink) {
    set((state) => ({ toolLog, illustrationSink, version: state.version + 1 }));
  },

  bump() {
    set((state) => ({ version: state.version + 1 }));
  },

  reset() {
    set({ toolLog: null, illustrationSink: null, version: 0 });
  },
}));
