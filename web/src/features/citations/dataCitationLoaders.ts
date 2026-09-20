/**
 * Loader ของ `CitationDrawerLoaders` ที่ผูกกับ facade `@/data` จริง — แยกจาก `ToolLog`/session ตรง ๆ
 * (ต่างจาก `features/workspace/citationDrawerLoaders.ts` เดิมที่ผูกทั้งสองไว้ด้วยกัน) รับแค่ฟังก์ชัน
 * "หา shard hint ของ source_id" (`getShardHint`) เพื่อให้ทั้งสองที่ที่ต้องเปิด citation drawer ใช้โค้ด
 * เดียวกัน ไม่ copy:
 * - workspace (session AI จริง): hint มาจาก `ToolLog.getSourceShard`
 * - หน้า `/load` (ไฟล์ `.tgbp.json`): hint มาจาก `TgbpFile.sourceShards[sourceId]`
 *
 * document/econ ไม่มีแนวคิด shard hint (ค้นตรงด้วย `doc_id`/`(indicator, year_be)` ได้เลย) — export เป็น
 * ฟังก์ชันเดี่ยว ๆ ให้ผู้เรียกประกอบเองพร้อม fallback ของตัวเอง (เช่น `/load` ใช้ quote ที่ฝังในไฟล์เป็น
 * fallback เมื่อ data layer โหลดไม่ได้ — ดู `LoadPage.tsx`)
 */
import { DocNotFoundError, InvalidShardPathError, data } from '@/data';
import type { CitationDrawerLoaders, DocumentChunkView, EconPointView } from './useCitationDetail';

const NEIGHBOR_ROW_COUNT = 10;

export type BudgetLineCitationLoaders = Required<
  Pick<CitationDrawerLoaders, 'hasBudgetLineHint' | 'loadBudgetLine' | 'loadNeighbors'>
>;

/**
 * สร้าง loader ของ budget_line citation จากฟังก์ชัน "หา shard hint ของ source_id" ที่ผู้เรียกกำหนดเอง —
 * ไม่มี hint (`getShardHint` คืน `undefined`) จะไม่เรียก `data.getLines`/`getNeighborLines` เลย
 *
 * shard ที่ manifest ปัจจุบันไม่รู้จักแล้ว (เช่นข้อมูลถูก republish ระหว่างที่ผู้ใช้เก็บไฟล์ไว้) ก็ถือว่า
 * "ไม่พบ" เช่นกัน (`InvalidShardPathError` จาก `data.getLines`/`getNeighborLines`) — ไม่ throw ขึ้น UI
 * เป็นสถานะ error เพราะไม่ใช่ปัญหาเครือข่าย/โค้ด แค่ hint เก่าไม่ตรงกับข้อมูลรุ่นปัจจุบันแล้ว
 */
export function createBudgetLineLoaders(
  getShardHint: (sourceId: string) => string | undefined,
): BudgetLineCitationLoaders {
  return {
    hasBudgetLineHint(sourceId) {
      return getShardHint(sourceId) !== undefined;
    },

    async loadBudgetLine(sourceId) {
      const shardHint = getShardHint(sourceId);
      if (shardHint === undefined) {
        return null;
      }
      try {
        const result = await data.getLines([sourceId], [shardHint]);
        return result.rows[0] ?? null;
      } catch (err) {
        if (err instanceof InvalidShardPathError) {
          return null;
        }
        throw err;
      }
    },

    async loadNeighbors(line) {
      const shardHint = getShardHint(line.source_id);
      if (shardHint === undefined) {
        return [];
      }
      try {
        const result = await data.getNeighborLines(line.source_id, NEIGHBOR_ROW_COUNT, shardHint);
        return result.rows;
      } catch (err) {
        if (err instanceof InvalidShardPathError) {
          return [];
        }
        throw err;
      }
    },
  };
}

/** document citation ผ่าน facade `@/data` จริง — คืน `null` เมื่อไม่พบเอกสารนี้ในชุดข้อมูลปัจจุบัน
 * (`DocNotFoundError`) error อื่น (network/shard) ปล่อย throw ต่อให้ผู้เรียกตัดสินใจเอง */
export async function loadDocumentChunkFromData(
  docId: string,
  page?: number,
): Promise<DocumentChunkView | null> {
  try {
    const result = await data.getDoc(docId, page !== undefined ? { page } : {});
    const chunks = result.chunks;
    const resolvedPage = page ?? chunks?.[0]?.page ?? null;
    return {
      title: result.doc.title_guess ?? docId,
      page: resolvedPage,
      text: chunks ? chunks.map((c) => c.text).join('\n\n') : '',
      isScanned: result.doc.has_text_layer === false,
    };
  } catch (err) {
    if (err instanceof DocNotFoundError) {
      return null;
    }
    throw err;
  }
}

/** econ citation ผ่าน facade `@/data` จริง — คืน `null` เมื่อไม่มี record ของ (indicator, yearBe) นี้เลย;
 * label ใช้ `EconIndicatorSeries.label_th` ถ้ามี series ของ indicator นั้น มิฉะนั้น fallback เป็นรหัส
 * indicator ตัวพิมพ์ใหญ่ (เหมือน `getCitationChipLabel` ใน `citationLabel.ts`) */
export async function loadEconPointFromData(
  indicator: string,
  yearBe: number,
): Promise<EconPointView | null> {
  const [value, series] = await Promise.all([
    data.getEconValue(indicator, yearBe),
    data.getEconSeries(indicator),
  ]);
  if (value === null) {
    return null;
  }
  return {
    label: series?.label_th ?? indicator.toUpperCase(),
    value: value.value,
    unit: value.unit,
    verified: value.verified,
    sourceName: value.source_name,
    sourceUrl: value.source_url,
  };
}
