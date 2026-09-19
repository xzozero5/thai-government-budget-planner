/**
 * T-403 — `dataStore`: สถานะการโหลดข้อมูล (manifest / DuckDB-WASM / ดัชนีค้นหา) (04 §D7 slice `data`)
 *
 * ขอบเขตของงานนี้: เก็บแค่สถานะ (`idle`/`loading`/`ready`/`error`) ต่อแหล่งข้อมูล — `@/data` (facade
 * ที่งานนี้ต้อง import ผ่านเท่านั้น) ยังไม่ export ตัว progress reporter ใด ๆ (มีแค่
 * `DuckDbProgress`/`prefetchDb` ใน `src/data/duckdb.ts` ซึ่งเป็น deep import ที่ต้องรอ T-408
 * "Data loading indicator" เป็นคนตัดสินใจว่าจะ expose ผ่าน facade อย่างไร — ทำตอนนี้จะต้องเดา API ที่
 * ยังไม่ถูกออกแบบ) เมื่อ T-408 เพิ่ม progress เข้า facade แล้ว ให้ขยาย `setStatus` ให้รับ
 * `progress` เพิ่มโดยไม่ต้องแก้ store อื่น
 *
 * ไม่มี `persist`/`devtools` middleware (09 §1) — ไม่มีข้อมูลผู้ใช้ในนี้อยู่แล้ว (สถานะโหลดข้อมูล
 * สาธารณะล้วน ๆ) แต่คงกฎเดียวกันทั้ง repo เพื่อความสม่ำเสมอ
 */
import { create } from 'zustand';

export type DataLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type DataSourceKey = 'manifest' | 'duckdb' | 'searchIndex';

const DATA_SOURCE_KEYS: readonly DataSourceKey[] = ['manifest', 'duckdb', 'searchIndex'];

export interface DataStoreState {
  status: Record<DataSourceKey, DataLoadStatus>;
  errors: Partial<Record<DataSourceKey, string>>;

  setStatus: (source: DataSourceKey, status: DataLoadStatus, errorMessage?: string) => void;
  reset: () => void;
}

function initialStatus(): Record<DataSourceKey, DataLoadStatus> {
  return { manifest: 'idle', duckdb: 'idle', searchIndex: 'idle' };
}

export const useDataStore = create<DataStoreState>((set) => ({
  status: initialStatus(),
  errors: {},

  setStatus(source, status, errorMessage) {
    set((state) => {
      let nextErrors = state.errors;
      if (status === 'error') {
        if (errorMessage !== undefined) {
          nextErrors = { ...state.errors, [source]: errorMessage };
        }
      } else if (state.errors[source] !== undefined) {
        // no-dynamic-delete: สร้าง object ใหม่โดยตัด key ออกแทน `delete obj[computedKey]`
        nextErrors = Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== source));
      }
      return {
        status: { ...state.status, [source]: status },
        errors: nextErrors,
      };
    });
  },

  reset() {
    set({ status: initialStatus(), errors: {} });
  },
}));

/** true เมื่อทุกแหล่งข้อมูลที่ติดตามอยู่พร้อมใช้งานแล้ว — ใช้เป็น selector: `useDataStore(isAllDataReady)` */
export function isAllDataReady(state: DataStoreState): boolean {
  return DATA_SOURCE_KEYS.every((key) => state.status[key] === 'ready');
}
