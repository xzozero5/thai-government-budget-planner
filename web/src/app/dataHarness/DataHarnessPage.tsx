/**
 * T-203 §4 — หน้า harness สำหรับ Playwright e2e ของ `data/duckdb.ts` + `data/repo.ts` เท่านั้น
 *
 * ไม่มีใน production bundle ปกติ — ดู `web/src/app/dataHarness/DataHarnessRoute.tsx` (จุดที่ตัด
 * ด้วย `import.meta.env.MODE`) หน้านี้ไม่มี UI จริง แค่ expose ฟังก์ชันของ data layer ไว้ที่
 * `window.__dataHarness` ให้ Playwright เรียกผ่าน `page.evaluate` แล้วตั้ง `data-ready="true"` เมื่อพร้อม
 */
import { type ReactElement, useEffect, useState } from 'react';
import { closeDb, prefetchDb } from '@/data/duckdb';
import { getDoc, type GetDocOptions, type GetDocResult } from '@/data/documents';
import {
  budgetRepo,
  type GetLinesResult,
  type QueryLinesParams,
  type QueryLinesResult,
} from '@/data/repo';
import type { Facets } from '@/data/types';

type SafeResult<T> = { ok: true; data: T } | { ok: false; errorName: string; message: string };

async function safeCall<T>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      errorName: err instanceof Error ? err.name : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface DataHarnessApi {
  queryLines: (params: QueryLinesParams) => Promise<SafeResult<QueryLinesResult>>;
  getLines: (sourceIds: string[], shardHints: string[]) => Promise<SafeResult<GetLinesResult>>;
  getDoc: (docId: string, opts?: GetDocOptions) => Promise<SafeResult<GetDocResult>>;
  facets: () => Promise<SafeResult<Facets>>;
  prefetchDb: () => Promise<SafeResult<void>>;
  closeDb: () => Promise<SafeResult<void>>;
}

declare global {
  interface Window {
    __dataHarness?: DataHarnessApi;
  }
}

export function DataHarnessPage(): ReactElement {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    window.__dataHarness = {
      queryLines: (params) => safeCall(() => budgetRepo.queryLines(params)),
      getLines: (sourceIds, shardHints) =>
        safeCall(() => budgetRepo.getLines(sourceIds, shardHints)),
      getDoc: (docId, opts) => safeCall(() => getDoc(docId, opts)),
      facets: () => safeCall(() => budgetRepo.facets()),
      prefetchDb: () => safeCall(() => prefetchDb()),
      closeDb: () => safeCall(() => closeDb()),
    };
    setReady(true);
    return () => {
      delete window.__dataHarness;
    };
  }, []);

  return <div data-testid="data-harness-root" data-ready={ready ? 'true' : 'false'} />;
}
