/**
 * T-407 — hook ที่ดึงรายละเอียดของ citation หนึ่งตัวผ่าน loader ที่ผู้ใช้ส่งมา (props-driven, ไม่เรียก
 * `@/data` เอง — ดู `CitationDrawer.tsx`)
 *
 * สัญญาของ loader ทุกตัว: คืน `null` = "ไม่พบในชุดข้อมูลปัจจุบัน" (ไม่ throw) ตาม signature ที่กำหนดไว้ใน
 * `CitationDrawerLoaders` — hook นี้จึง map `null` → สถานะ `not-found` เดียวกันทุกประเภท throw
 * (exception) เท่านั้นที่ map เป็นสถานะ `error` (มีปุ่ม "ลองใหม่")
 *
 * Race condition: ถ้า `citation` เปลี่ยนระหว่างที่ request เก่ายังไม่เสร็จ (หรือกด "ลองใหม่" ซ้ำ) ผลของ
 * request เก่าต้องไม่ทับ state ปัจจุบัน — ใช้ตัวนับ `requestIdRef` เทียบก่อน `setState` ทุกครั้ง
 */
import { useEffect, useRef, useState } from 'react';
import type { Citation } from '@/ai/tools/proposal';
import type { BudgetLine } from '@/data';

export interface DocumentChunkView {
  title: string;
  page: number | null;
  text: string;
  isScanned: boolean;
}

export interface EconPointView {
  label: string;
  value: number | null;
  unit: string;
  verified: boolean;
  sourceName?: string;
  sourceUrl?: string;
}

export interface CitationDrawerLoaders {
  loadBudgetLine(sourceId: string): Promise<BudgetLine | null>;
  loadNeighbors?(line: BudgetLine): Promise<BudgetLine[]>;
  loadDocumentChunk?(docId: string, page?: number): Promise<DocumentChunkView | null>;
  loadEconPoint?(indicator: string, yearBe: number): Promise<EconPointView | null>;
}

export type CitationDetailData =
  | { kind: 'budget_line'; line: BudgetLine }
  | { kind: 'document'; chunk: DocumentChunkView }
  | { kind: 'econ'; point: EconPointView }
  | { kind: 'web' };

export type CitationDetailState<T = CitationDetailData> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

export interface UseCitationDetailResult {
  state: CitationDetailState;
  /** เรียกซ้ำ request เดิมของ citation ปัจจุบัน (ปุ่ม "ลองใหม่" ตอน error) */
  retry: () => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** ดึงรายละเอียดของ `citation` ผ่าน loader ที่เหมาะกับ `kind` — กัน race condition ด้วย request token */
export function useCitationDetail(
  citation: Citation | null,
  loaders: CitationDrawerLoaders,
): UseCitationDetailResult {
  const [state, setState] = useState<CitationDetailState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const requestIdRef = useRef(0);
  const loadersRef = useRef(loaders);
  loadersRef.current = loaders;

  useEffect(() => {
    if (citation === null) {
      setState({ status: 'loading' });
      return;
    }

    if (citation.kind === 'web') {
      setState({ status: 'loaded', data: { kind: 'web' } });
      return;
    }

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    async function run(): Promise<void> {
      // narrow อีกครั้งในนี้เพื่อให้ TS รู้ discriminant หลังผ่าน closure ของ async function
      if (citation === null || citation.kind === 'web') {
        return;
      }
      try {
        if (citation.kind === 'budget_line') {
          const line = await loadersRef.current.loadBudgetLine(citation.source_id);
          if (requestIdRef.current !== requestId) return;
          setState(
            line === null ? { status: 'not-found' } : { status: 'loaded', data: { kind: 'budget_line', line } },
          );
          return;
        }
        if (citation.kind === 'document') {
          const chunk = loadersRef.current.loadDocumentChunk
            ? await loadersRef.current.loadDocumentChunk(citation.doc_id, citation.page)
            : null;
          if (requestIdRef.current !== requestId) return;
          setState(
            chunk === null
              ? { status: 'not-found' }
              : { status: 'loaded', data: { kind: 'document', chunk } },
          );
          return;
        }
        // citation.kind === 'econ'
        const point = loadersRef.current.loadEconPoint
          ? await loadersRef.current.loadEconPoint(citation.indicator, citation.year_be)
          : null;
        if (requestIdRef.current !== requestId) return;
        setState(
          point === null ? { status: 'not-found' } : { status: 'loaded', data: { kind: 'econ', point } },
        );
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setState({ status: 'error', message: errorMessage(err) });
      }
    }

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loaders` อ่านผ่าน ref เสมอ (loadersRef)
    // เพื่อไม่ให้ object literal ใหม่ทุก render ของผู้เรียกสั่ง refetch ซ้ำโดยไม่จำเป็น
  }, [citation, reloadToken]);

  return {
    state,
    retry: () => {
      setReloadToken((n) => n + 1);
    },
  };
}
