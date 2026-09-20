/**
 * T-408 (ต่อสาย) — เรียก facade `@/data` แบบไม่บล็อก (fire-and-forget) ตอน workspace mount เพื่อให้
 * `dataStore` มีสถานะจริง (`loading` → `ready`/`error`) แทนที่จะค้าง `idle` ตลอดไป (ดูคอมเมนต์หัวไฟล์
 * `stores/dataStore.ts`/`DataLoadingIndicator.tsx`: "ยังไม่มีจุดใดเรียก setStatus จริง")
 *
 * ข้อจำกัดที่ทราบ (รายงานท้ายงาน): facade `@/data` (T-206) ยังไม่ export progress ต่อแหล่งข้อมูลแยกกัน
 * (มี `duckdb.ts#prefetchDb(onProgress)` แต่เป็น deep import ที่ `ai/`/`features/*` ห้ามแตะตรง ๆ —
 * ต้องให้ T-408 เต็มเป็นคนตัดสินใจ expose ผ่าน facade อย่างไร) จุดนี้จึงเรียกแค่ `data.dataVersion()`
 * (แตะ manifest.json) + `data.facets()` (แตะ catalog/facets.json) พร้อมกัน แล้ว mark ทั้งสามคีย์
 * (`manifest`/`duckdb`/`searchIndex`) ตามผลรวมเดียวกัน — หยาบกว่าความคืบหน้าต่อไฟล์จริง แต่ดีกว่าค้าง
 * `idle` ตลอด session (DuckDB-WASM เองเป็น lazy init อยู่แล้ว ไม่มี "ค่าเริ่มต้น" ให้ prefetch แยกจาก
 * query แรกที่ AI/citation drawer เรียกจริง)
 */
import { useEffect, useRef } from 'react';
import { data } from '@/data';
import { useDataStore, type DataSourceKey } from '@/stores/dataStore';

const TRACKED_SOURCES: readonly DataSourceKey[] = ['manifest', 'duckdb', 'searchIndex'];

export function useDataStoreInit(): void {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const setStatus = useDataStore.getState().setStatus;
    for (const source of TRACKED_SOURCES) {
      setStatus(source, 'loading');
    }

    Promise.all([data.dataVersion(), data.facets()])
      .then(() => {
        for (const source of TRACKED_SOURCES) {
          setStatus(source, 'ready');
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        for (const source of TRACKED_SOURCES) {
          setStatus(source, 'error', message);
        }
      });
  }, []);
}
