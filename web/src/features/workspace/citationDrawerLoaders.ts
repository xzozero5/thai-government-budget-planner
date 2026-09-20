/**
 * T-405 (ต่อสาย) — สร้าง `CitationDrawerLoaders` (`@/features/citations`) จริง ผูกกับ `ToolLog` ของ
 * session ปัจจุบัน (`CitationDrawer` เอง**ไม่**เรียก `@/data`/`ToolLog` ตรง ๆ — ดูคอมเมนต์หัวไฟล์
 * `CitationDrawer.tsx`)
 *
 * โค้ดจริงของ loader ทั้งหมด (ผูกกับ facade `@/data`) อยู่ที่ `features/citations/dataCitationLoaders.ts`
 * — ไฟล์นี้เป็นแค่ตัวประกอบ "หา shard hint จาก `ToolLog.getSourceShard`" ให้ `createBudgetLineLoaders`
 * (ไฟล์เดียวกับที่หน้า `/load` ใช้ ต่างกันแค่แหล่งของ hint — `TgbpFile.sourceShards` แทน `ToolLog` — ดู
 * `features/export/LoadPage.tsx`) ไม่ copy โค้ดค้นหา/แปลงผล budget_line/document/econ ซ้ำอีกชุด
 *
 * **ไม่ส่งต่อ `hasBudgetLineHint`**: ใน session ที่มี ToolLog จริง การไม่มี shard hint ของ source_id หนึ่ง
 * ๆ ยังคงถือเป็น "อ้างอิงไม่พบ" ทั่วไป (`citation.notFoundTitle`) เหมือนพฤติกรรมเดิมของ T-405/T-407 (มี
 * test ยืนยันไว้แล้วใน `slots.test.tsx`) — ข้อความ "เปิดดูแถวต้นทางไม่ได้" (`citation.lookupUnavailable*`)
 * มีไว้เฉพาะกรณีไฟล์ `.tgbp.json` เก่าที่หน้า `/load` เปิด ซึ่งเป็นกรณีที่ทราบชัดว่าไม่ใช่อ้างอิงปลอม (ดู
 * `LoadPage.tsx`)
 */
import type { ToolLog } from '@/ai/toolLog';
import {
  createBudgetLineLoaders,
  loadDocumentChunkFromData,
  loadEconPointFromData,
  type CitationDrawerLoaders,
} from '@/features/citations';

export function createCitationDrawerLoaders(toolLog: ToolLog | null): CitationDrawerLoaders {
  const { loadBudgetLine, loadNeighbors } = createBudgetLineLoaders((sourceId) =>
    toolLog?.getSourceShard(sourceId),
  );
  return {
    loadBudgetLine,
    loadNeighbors,
    loadDocumentChunk: loadDocumentChunkFromData,
    loadEconPoint: loadEconPointFromData,
  };
}
