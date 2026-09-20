/**
 * T-405 (ต่อสาย) — สร้าง `CitationDrawerLoaders` (`@/features/citations`) จริง ผูกกับ facade `@/data`
 * โดยใช้ shard hint จาก `ToolLog.getSourceShard`/`getSourceFingerprint` ของ session ปัจจุบัน
 * (`CitationDrawer` เอง**ไม่**เรียก `@/data`/`ToolLog` ตรง ๆ — ดูคอมเมนต์หัวไฟล์ `CitationDrawer.tsx`)
 *
 * กติกาการแปลง null/throw (ตรงกับสัญญาของ `useCitationDetail.ts`):
 * - budget_line: ไม่มี shard hint ใน `ToolLog` (เช่น citation มาจากไฟล์ `.tgbp.json` เก่าที่โหลดกลับมา
 *   โดยไม่มี ToolLog ของ session เดิมแล้ว) → คืน `null` (not-found) ทันที ไม่เรียก `data.getLines`
 *   (ซึ่ง throw เมื่อ `shardHints` ว่างอยู่แล้ว — ดู `data/repo.ts#getLines`)
 * - document: `DocNotFoundError` → `null` (not-found); error อื่น (เช่น shard/network) ปล่อย throw ต่อ
 * - econ: ไม่มี record ของ (indicator, yearBe) เลย → `null`; label ใช้ `EconIndicatorSeries.label_th`
 *   ถ้ามี series ของ indicator นั้น มิฉะนั้น fallback เป็นรหัส indicator ตัวพิมพ์ใหญ่ (เหมือน
 *   `getCitationChipLabel` ใน `features/citations/citationLabel.ts`)
 */
import { DocNotFoundError, data, type BudgetLine } from '@/data';
import type { ToolLog } from '@/ai/toolLog';
import type { CitationDrawerLoaders } from '@/features/citations';

const NEIGHBOR_ROW_COUNT = 10;

export function createCitationDrawerLoaders(toolLog: ToolLog | null): CitationDrawerLoaders {
  return {
    async loadBudgetLine(sourceId: string): Promise<BudgetLine | null> {
      const shardHint = toolLog?.getSourceShard(sourceId);
      if (shardHint === undefined) {
        return null;
      }
      const result = await data.getLines([sourceId], [shardHint]);
      return result.rows[0] ?? null;
    },

    async loadNeighbors(line: BudgetLine): Promise<BudgetLine[]> {
      const shardHint = toolLog?.getSourceShard(line.source_id);
      if (shardHint === undefined) {
        return [];
      }
      const result = await data.getNeighborLines(line.source_id, NEIGHBOR_ROW_COUNT, shardHint);
      return result.rows;
    },

    async loadDocumentChunk(docId, page) {
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
    },

    async loadEconPoint(indicator, yearBe) {
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
    },
  };
}
