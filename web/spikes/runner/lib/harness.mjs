// helper ร่วมของ runner ทุกตัว: เปิด server, เปิด chromium, ดัก network ด้วย CDP
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_DIR = fileURLToPath(new URL('../..', import.meta.url));
export const PORT = Number(process.env.PORT ?? 5199);
export const ORIGIN = `http://localhost:${PORT}`;
export const PAGES_BASE = 'https://xzozero5.github.io/thai-government-budget-planner';

export async function startServer() {
  process.env.PORT = String(PORT);
  const mod = await import('../../server.mjs');
  await new Promise((r) => setTimeout(r, 300));
  return mod;
}

export async function serverStats({ reset = false, log = false } = {}) {
  const res = await fetch(`${ORIGIN}/__stats?reset=${reset ? 1 : 0}&log=${log ? 1 : 0}`);
  return res.json();
}

export async function launch(extraArgs = []) {
  return chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc', ...extraArgs],
  });
}

/** ดัก network ด้วย CDP (ครอบคลุม request จาก worker ด้วยถ้า auto-attach ทำงาน) */
export class Net {
  constructor() {
    this.events = new Map();
    this.finished = [];
  }
  async attach(context, page) {
    this.cdp = await context.newCDPSession(page);
    await this.cdp.send('Network.enable');
    this.cdp.on('Network.requestWillBeSent', (e) => {
      this.events.set(e.requestId, {
        url: e.request.url,
        method: e.request.method,
        range: e.request.headers.Range ?? e.request.headers.range ?? null,
      });
    });
    this.cdp.on('Network.responseReceived', (e) => {
      const r = this.events.get(e.requestId) ?? {};
      r.status = e.response.status;
      r.contentRange = e.response.headers['content-range'] ?? e.response.headers['Content-Range'] ?? null;
      r.fromCache = e.response.fromDiskCache === true;
      this.events.set(e.requestId, r);
    });
    this.cdp.on('Network.loadingFinished', (e) => {
      const r = this.events.get(e.requestId);
      if (r) {
        r.encodedDataLength = e.encodedDataLength;
        this.finished.push(r);
        this.events.delete(e.requestId);
      }
    });
    return this;
  }
  take() {
    const out = this.finished;
    this.finished = [];
    return out;
  }
  static summarize(evts, filter = () => true) {
    const f = evts.filter(filter);
    return {
      requests: f.length,
      bytes: f.reduce((a, b) => a + (b.encodedDataLength ?? 0), 0),
      partial: f.filter((e) => e.status === 206).length,
      urls: [...new Set(f.map((e) => e.url.replace(/^https?:\/\/[^/]+/, '')))].slice(0, 8),
    };
  }
}

/** อ่าน log ของ XHR ที่ถูก patch ไว้ใน duckdb worker (ดู makeInstrumentedWorker ใน src/s1.ts) */
export async function workerXhrLog(page, { clear = false } = {}) {
  for (const w of page.workers()) {
    try {
      const log = await w.evaluate((c) => {
        const l = self.__xhrLog ?? null;
        if (l && c) self.__xhrLog = [];
        return l;
      }, clear);
      if (log) return log;
    } catch {
      /* worker อาจปิดไปแล้ว */
    }
  }
  return null;
}

export function summarizeXhr(log, urlFilter = /\.parquet/) {
  const f = (log ?? []).filter((e) => urlFilter.test(e.u ?? ''));
  return {
    requests: f.length,
    bytes: f.reduce((a, b) => a + (b.len ?? 0), 0),
    range_requests: f.filter((e) => e.range).length,
    status_206: f.filter((e) => e.status === 206).length,
    methods: f.reduce((a, b) => ((a[b.m] = (a[b.m] ?? 0) + 1), a), {}),
    detail: f.map((e) => ({ m: e.m, range: e.range, status: e.status, len: e.len, ms: e.ms })),
  };
}

/** resource timing ภายใน worker ของ duckdb (นับ XHR ที่ worker ยิงเอง) */
export async function workerResourceTiming(page) {
  const out = [];
  for (const w of page.workers()) {
    try {
      const entries = await w.evaluate(() => {
        // eslint-disable-next-line no-undef
        const es = performance.getEntriesByType('resource');
        return es.map((e) => ({
          name: e.name,
          initiatorType: e.initiatorType,
          transferSize: e.transferSize,
          encodedBodySize: e.encodedBodySize,
          duration: e.duration,
        }));
      });
      out.push({ url: w.url(), entries });
    } catch (e) {
      out.push({ url: w.url(), error: String(e) });
    }
  }
  return out;
}

export async function clearWorkerResourceTiming(page) {
  for (const w of page.workers()) {
    try {
      await w.evaluate(() => performance.clearResourceTimings());
    } catch {
      /* ignore */
    }
  }
}

export function saveResult(name, data) {
  const dir = join(SPIKE_DIR, 'results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log('saved', file);
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
