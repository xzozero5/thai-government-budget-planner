import { beforeEach, describe, expect, it } from 'vitest';
import { isAllDataReady, useDataStore } from './dataStore';

beforeEach(() => {
  useDataStore.getState().reset();
});

describe('dataStore', () => {
  it('เริ่มต้นทุกแหล่งข้อมูลเป็น idle และ isAllDataReady=false', () => {
    const state = useDataStore.getState();
    expect(state.status).toEqual({ manifest: 'idle', duckdb: 'idle', searchIndex: 'idle' });
    expect(isAllDataReady(state)).toBe(false);
  });

  it('setStatus อัปเดตเฉพาะแหล่งข้อมูลที่ระบุ', () => {
    useDataStore.getState().setStatus('manifest', 'loading');
    const state = useDataStore.getState();
    expect(state.status.manifest).toBe('loading');
    expect(state.status.duckdb).toBe('idle');
  });

  it('setStatus(error, message) เก็บข้อความ error ต่อแหล่งข้อมูล', () => {
    useDataStore.getState().setStatus('duckdb', 'error', 'โหลด DuckDB-WASM ไม่สำเร็จ');
    expect(useDataStore.getState().errors.duckdb).toBe('โหลด DuckDB-WASM ไม่สำเร็จ');
  });

  it('setStatus กลับเป็นสถานะอื่นที่ไม่ใช่ error → ล้างข้อความ error เดิมของแหล่งนั้น', () => {
    useDataStore.getState().setStatus('duckdb', 'error', 'พัง');
    useDataStore.getState().setStatus('duckdb', 'loading');
    expect(useDataStore.getState().errors.duckdb).toBeUndefined();
  });

  it('isAllDataReady=true เมื่อทั้ง 3 แหล่งพร้อมแล้วเท่านั้น', () => {
    useDataStore.getState().setStatus('manifest', 'ready');
    useDataStore.getState().setStatus('duckdb', 'ready');
    expect(isAllDataReady(useDataStore.getState())).toBe(false);
    useDataStore.getState().setStatus('searchIndex', 'ready');
    expect(isAllDataReady(useDataStore.getState())).toBe(true);
  });

  it('reset คืนค่าเริ่มต้นทั้งหมด', () => {
    useDataStore.getState().setStatus('manifest', 'error', 'x');
    useDataStore.getState().reset();
    expect(useDataStore.getState().status.manifest).toBe('idle');
    expect(useDataStore.getState().errors).toEqual({});
  });
});
