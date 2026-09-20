/**
 * T-405 (ต่อสาย) — hook โหลด `TrendResult` ของ `TrendRef` หนึ่งตัวผ่าน `trendData.ts` (loading/loaded/
 * error) กัน race condition ด้วย request token เดียวกับแนวทางของ `useCitationDetail.ts`
 * (`features/citations/**`) เพื่อให้พฤติกรรมสอดคล้องกันทั้ง repo
 */
import { useEffect, useRef, useState } from 'react';
import type { TrendRef } from '@/ai/tools/proposal';
import { loadTrend, type TrendResult } from './trendData';

export type TrendState =
  | { status: 'loading' }
  | { status: 'loaded'; data: TrendResult | null }
  | { status: 'error'; message: string };

export function useTrendResult(ref: TrendRef): TrendState {
  const [state, setState] = useState<TrendState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });
    loadTrend(ref)
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setState({ status: 'loaded', data: result });
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref เป็น value object ใหม่ทุก render ของ
    // ผู้เรียกที่ inline literal ({kind,key}) ได้ — track เฉพาะ field ที่มีผลจริงต่อ cache key
  }, [ref.kind, ref.key]);

  return state;
}
