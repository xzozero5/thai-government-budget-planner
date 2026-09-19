// S1 — DuckDB-WASM (eh build, ไม่มี threads) + Parquet ผ่าน HTTP range
// หน้านี้ไม่มี UI จริง; runner (Playwright) เรียก window.__s1.* แล้วเก็บผล
import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

type Json = Record<string, unknown>;

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

const log = (m: string) => {
  const el = document.getElementById('out');
  if (el) el.textContent += m + '\n';
};

function heap(): Json {
  // performance.memory เป็น non-standard (Chromium) — ต้องรันด้วย --enable-precise-memory-info
  const pm = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return pm ? { usedJSHeapSize: pm.usedJSHeapSize, totalJSHeapSize: pm.totalJSHeapSize } : { unavailable: true };
}

type FsConfig = {
  allowFullHTTPReads?: boolean;
  forceFullHTTPReads?: boolean;
  reliableHeadRequests?: boolean;
  extensionRepo?: string;
  allowUnsignedExtensions?: boolean;
};

/**
 * สร้าง worker แบบ blob ที่ patch XMLHttpRequest ก่อน importScripts ของ duckdb
 * → นับ request/bytes ที่ duckdb ยิงจริงได้ (CDP ของ Playwright ไม่เห็น request ของ worker)
 * pattern เดียวกับที่ duckdb-wasm แนะนำสำหรับ CDN และต้องผ่าน CSP `worker-src 'self' blob:`
 */
function makeInstrumentedWorker(workerUrl: string): Worker {
  const abs = new URL(workerUrl, location.href).href;
  const bootstrap = `
self.__xhrLog = [];
(function () {
  var O = XMLHttpRequest.prototype.open, S = XMLHttpRequest.prototype.send, H = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return O.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (String(k).toLowerCase() === 'range') this.__range = v; return H.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var t0 = Date.now();
    var r = S.apply(this, arguments);
    try {
      if (this.readyState === 4) {
        var len = 0;
        try {
          if (this.response && this.response.byteLength != null) len = this.response.byteLength;
          else if (this.responseType === '' || this.responseType === 'text') len = (this.responseText || '').length;
        } catch (e) {}
        var cr = null, cl = null;
        try { cr = this.getResponseHeader('content-range'); cl = this.getResponseHeader('content-length'); } catch (e) {}
        self.__xhrLog.push({ m: this.__m, u: this.__u, range: this.__range || null, status: this.status,
          cr: cr, cl: cl, len: len, ms: Date.now() - t0 });
      }
    } catch (e) {}
    return r;
  };
})();
importScripts(${JSON.stringify('')} + ${JSON.stringify(abs)});
`;
  const url = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
  return new Worker(url);
}

async function init(opts: FsConfig & { instrument?: boolean }): Promise<Json> {
  const t0 = performance.now();
  const worker = opts.instrument === false ? new Worker(ehWorkerUrl) : makeInstrumentedWorker(ehWorkerUrl);
  const tWorker = performance.now() - t0;
  const logger = new duckdb.VoidLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  const t1 = performance.now();
  await db.instantiate(ehWasmUrl);
  const tInstantiate = performance.now() - t1;
  const t2 = performance.now();
  await db.open({
    path: ':memory:',
    query: { castBigIntToDouble: true },
    allowUnsignedExtensions: opts.allowUnsignedExtensions ?? false,
    filesystem: {
      allowFullHTTPReads: opts.allowFullHTTPReads,
      forceFullHTTPReads: opts.forceFullHTTPReads,
      reliableHeadRequests: opts.reliableHeadRequests,
    },
  });
  const tOpen = performance.now() - t2;
  conn = await db.connect();
  const extension: Json = {};
  if (opts.extensionRepo) {
    // ป้องกันการยิงไป https://extensions.duckdb.org (ผิด N5) โดยชี้ repo มาที่ origin ของเราเอง
    const t3 = performance.now();
    try {
      await conn.query(`SET custom_extension_repository = '${opts.extensionRepo}'`);
      await conn.query(`INSTALL parquet`);
      await conn.query(`LOAD parquet`);
      extension.ok = true;
    } catch (e) {
      extension.ok = false;
      extension.error = String(e);
    }
    extension.ms = performance.now() - t3;
  }
  const version = await db.getVersion();
  log(`init ok ${(performance.now() - t0).toFixed(0)} ms`);
  return {
    ms_total: performance.now() - t0,
    ms_new_worker: tWorker,
    ms_instantiate: tInstantiate,
    ms_open: tOpen,
    duckdb_version: version,
    extension,
    heap_after_init: heap(),
  };
}

async function runSql(sql: string, collectRows: number): Promise<Json> {
  if (!conn) throw new Error('not connected');
  const t = performance.now();
  const res = await conn.query(sql);
  const ms = performance.now() - t;
  const rows: unknown[] = [];
  const n = Math.min(collectRows, res.numRows);
  for (let i = 0; i < n; i++) {
    const r = res.get(i);
    rows.push(r ? JSON.parse(JSON.stringify(r.toJSON(), (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) : null);
  }
  return { ms, num_rows: res.numRows, rows };
}

async function memoryStats(): Promise<Json> {
  if (!conn) return { unavailable: true };
  try {
    const r = await conn.query('SELECT * FROM pragma_database_size()');
    const row = r.get(0);
    return row ? JSON.parse(JSON.stringify(row.toJSON(), (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) : {};
  } catch (e) {
    return { error: String(e) };
  }
}

async function registerBuffer(name: string, url: string): Promise<Json> {
  if (!db) throw new Error('no db');
  const t = performance.now();
  const resp = await fetch(url);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const msFetch = performance.now() - t;
  const bytes = buf.byteLength; // ต้องอ่านก่อน register (buffer ถูก transfer ไป worker แล้ว byteLength = 0)
  const t2 = performance.now();
  await db.registerFileBuffer(name, buf);
  return { ms_fetch: msFetch, bytes, ms_register: performance.now() - t2 };
}

async function reset(): Promise<void> {
  if (conn) await conn.close();
  if (db) await db.terminate();
  conn = null;
  db = null;
}

declare global {
  interface Window {
    __s1: {
      init: typeof init;
      runSql: typeof runSql;
      memoryStats: typeof memoryStats;
      registerBuffer: typeof registerBuffer;
      reset: typeof reset;
      heap: typeof heap;
      ready: boolean;
    };
  }
}

window.__s1 = { init, runSql, memoryStats, registerBuffer, reset, heap, ready: true };
log('module loaded');
