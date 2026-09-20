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
import { MAX_SHARDS_TO_SCAN, data } from '@/data';
import {
  createBudgetLineLoaders,
  loadDocumentChunkFromData,
  loadEconPointFromData,
  type CitationDrawerLoaders,
} from '@/features/citations';

/** จำนวนชุด (ชุดละ ≤ `MAX_SHARDS_TO_SCAN` ไฟล์) สูงสุดที่ยอมไล่หา shard ของ source_id ที่รู้แค่ "candidate" —
 * ตัวเลขเดียวกับ `ai/tools/getBudgetLine.ts#MAX_CANDIDATE_SHARD_BATCHES` */
const MAX_CANDIDATE_SHARD_BATCHES = 5;

/**
 * T-603 (พบจาก eval จริง T-604): `sample_source_ids` ของ `search_catalog` อ้างเป็น citation ได้ แต่ ToolLog รู้แค่
 * "shard ที่เป็นไปได้" (จาก `CatalogItem.shards`) ไม่ใช่ shard ตัวจริง — ถ้าโมเดลอ้าง id นั้นโดยไม่เคยเรียก
 * `get_budget_line` drawer จะขึ้น "อ้างอิงไม่พบ" กับอ้างอิงที่ถูกต้อง → ไล่หาเป็นชุด ๆ ตอนผู้ใช้กดชิป (lazy)
 * แล้วจำ shard ตัวจริงไว้ใน ToolLog (ไฟล์ `.tgbp.json` ที่บันทึกหลังจากนั้นจะมี hint ของ id นี้ด้วย)
 */
async function resolveShardFromCandidates(toolLog: ToolLog, sourceId: string): Promise<string | undefined> {
  const candidates = toolLog.getSourceShardCandidates?.(sourceId) ?? [];
  const maxShards = MAX_SHARDS_TO_SCAN * MAX_CANDIDATE_SHARD_BATCHES;
  for (let offset = 0; offset < candidates.length && offset < maxShards; offset += MAX_SHARDS_TO_SCAN) {
    const batch = candidates.slice(offset, offset + MAX_SHARDS_TO_SCAN);
    try {
      const result = await data.getLines([sourceId], batch);
      const shard = result.rowShards[sourceId];
      if (shard !== undefined) {
        toolLog.recordSourceShard(sourceId, shard);
        return shard;
      }
    } catch {
      // ชุดนี้เปิดไม่ได้ (shard ไม่อยู่ใน manifest ปัจจุบัน ฯลฯ) — ลองชุดถัดไป
    }
  }
  return undefined;
}

export function createCitationDrawerLoaders(toolLog: ToolLog | null): CitationDrawerLoaders {
  const { loadBudgetLine, loadNeighbors } = createBudgetLineLoaders((sourceId) =>
    toolLog?.getSourceShard(sourceId),
  );
  return {
    async loadBudgetLine(sourceId) {
      if (toolLog !== null && toolLog.getSourceShard(sourceId) === undefined) {
        await resolveShardFromCandidates(toolLog, sourceId);
      }
      return loadBudgetLine(sourceId);
    },
    loadNeighbors,
    loadDocumentChunk: loadDocumentChunkFromData,
    loadEconPoint: loadEconPointFromData,
  };
}
