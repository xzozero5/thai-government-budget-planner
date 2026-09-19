// S2 — ค้นหาภาษาไทย: Intl.Segmenter + MiniSearch กับ catalog ตัวจริง (45,193 entries)
import MiniSearch from 'minisearch';

type Json = Record<string, unknown>;

interface CatalogItem {
  key: string;
  keys?: string[];
  name: string;
  n_lines: number;
  years: number[];
  top_agencies?: string[];
  unit_price?: { median: number; n: number };
  amount?: { median: number; n: number };
  shards?: number[];
  low_specificity?: boolean;
}
interface Catalog {
  schema_version: number;
  shard_paths: string[];
  items: CatalogItem[];
}

let catalog: Catalog | null = null;
let mini: MiniSearch | null = null;

const out = (m: string) => {
  const el = document.getElementById('out');
  if (el) el.textContent += m + '\n';
};

function heap(): Json {
  const pm = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return pm ? { used: pm.usedJSHeapSize, total: pm.totalJSHeapSize } : { unavailable: true };
}

async function gcHeap(): Promise<Json> {
  const g = (window as unknown as { gc?: () => void }).gc;
  if (g) {
    g();
    await new Promise((r) => setTimeout(r, 60));
    g();
    await new Promise((r) => setTimeout(r, 60));
  }
  return { ...heap(), gc_available: !!g };
}

// ---------- tokenizer ----------
const THAI = /[฀-๿]/;
let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter;
  if (typeof Intl.Segmenter !== 'function') return null;
  segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  return segmenter;
}

function tokenizeSegmenter(text: string): string[] {
  const s = getSegmenter();
  if (!s) return tokenizeNgram(text);
  const res: string[] = [];
  for (const part of s.segment(text)) {
    if (part.isWordLike) res.push(part.segment);
  }
  return res;
}

/** fallback เมื่อไม่มี Intl.Segmenter: n-gram 3 สำหรับอักษรไทย + split ปกติสำหรับ latin/เลข */
function tokenizeNgram(text: string, n = 3): string[] {
  const res: string[] = [];
  for (const chunk of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!chunk) continue;
    if (!THAI.test(chunk)) {
      res.push(chunk);
      continue;
    }
    if (chunk.length <= n) res.push(chunk);
    else for (let i = 0; i + n <= chunk.length; i++) res.push(chunk.slice(i, i + n));
  }
  return res;
}

/** folding สำหรับ text ที่มาจาก PDF (02 §B): ตัดช่องว่างระหว่างอักษรไทย + ำ→า */
export function foldThai(s: string): string {
  return s
    .normalize('NFC')
    .replace(/([฀-๿])[ \t ]+(?=[฀-๿])/g, '$1')
    .replace(/ํา|ำ/g, 'า'); // ํา และ ำ → า
}

const lower = (t: string) => t.toLowerCase();

// ---------- load ----------
async function loadCatalog(url: string): Promise<Json> {
  const t0 = performance.now();
  const resp = await fetch(url);
  const gzBuf = await resp.arrayBuffer();
  const tFetch = performance.now() - t0;

  const t1 = performance.now();
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([gzBuf]).stream().pipeThrough(ds);
  const text = await new Response(stream).text();
  const tGunzip = performance.now() - t1;

  const t2 = performance.now();
  catalog = JSON.parse(text) as Catalog;
  const tParse = performance.now() - t2;

  return {
    ms_fetch: tFetch,
    ms_gunzip: tGunzip,
    ms_parse: tParse,
    ms_total: performance.now() - t0,
    bytes_gz: gzBuf.byteLength,
    chars_json: text.length,
    entries: catalog.items.length,
    schema_version: catalog.schema_version,
    heap_after: heap(),
  };
}

// ---------- index ----------
type Variant = 'full' | 'key_only' | 'key_keys' | 'ngram_full';

function buildDocs(variant: Variant) {
  const items = catalog!.items;
  if (variant === 'key_only') return items.map((it, i) => ({ id: i, key: it.key }));
  if (variant === 'key_keys')
    return items.map((it, i) => ({ id: i, key: it.key, alt: it.keys ? it.keys.join(' ') : '' }));
  return items.map((it, i) => ({
    id: i,
    key: it.key,
    name: it.name,
    n_lines: it.n_lines,
    years: it.years,
  }));
}

function miniOptions(variant: Variant): ConstructorParameters<typeof MiniSearch>[0] {
  const tokenize = variant === 'ngram_full' ? (t: string) => tokenizeNgram(t) : (t: string) => tokenizeSegmenter(t);
  if (variant === 'key_only')
    return { fields: ['key'], storeFields: [], idField: 'id', tokenize, processTerm: lower };
  if (variant === 'key_keys')
    return { fields: ['key', 'alt'], storeFields: [], idField: 'id', tokenize, processTerm: lower };
  return {
    fields: ['key', 'name'],
    storeFields: ['key', 'name', 'n_lines'],
    idField: 'id',
    tokenize,
    processTerm: lower,
  };
}

async function buildIndex(variant: Variant): Promise<Json> {
  const before = await gcHeap();
  const t0 = performance.now();
  const docs = buildDocs(variant);
  const tDocs = performance.now() - t0;
  const t1 = performance.now();
  mini = new MiniSearch(miniOptions(variant));
  mini.addAll(docs);
  const tIndex = performance.now() - t1;
  const after = await gcHeap();
  return {
    variant,
    ms_build_docs: tDocs,
    ms_index: tIndex,
    ms_total: performance.now() - t0,
    docs: docs.length,
    heap_before: before,
    heap_after: after,
    heap_delta: (after.used as number) - (before.used as number),
  };
}

/** prebuilt index (ทางเลือก T-208): serialize → gzip → วัดขนาด + เวลา loadJSON */
async function serializeIndex(): Promise<Json> {
  const t0 = performance.now();
  const json = JSON.stringify(mini);
  const tSer = performance.now() - t0;
  const t1 = performance.now();
  const cs = new CompressionStream('gzip');
  const gz = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
  const tGz = performance.now() - t1;
  const t2 = performance.now();
  const reloaded = MiniSearch.loadJSON(json, miniOptions('full'));
  const tLoad = performance.now() - t2;
  const probe = reloaded.search('เครื่องปรับอากาศ', { prefix: true }).length;
  return {
    ms_serialize: tSer,
    ms_gzip: tGz,
    ms_loadJSON: tLoad,
    bytes_json: json.length,
    bytes_gz: gz.byteLength,
    probe_hits: probe,
  };
}

const QUERIES = ['แอร์ 18000 บีทียู', 'รถบรรทุกดีเซล 1 ตัน', 'ฝาย', 'วิทยุสื่อสาร', 'กล้องวงจรปิด'];

function runQueries(opts: Json = {}): Json {
  const results: Json[] = [];
  for (const q of QUERIES) {
    const t = performance.now();
    const r = mini!.search(q, { prefix: true, fuzzy: 0.2, combineWith: 'OR', ...opts });
    const ms = performance.now() - t;
    results.push({
      q,
      ms,
      hits: r.length,
      top5: r.slice(0, 5).map((x) => {
        const item = catalog!.items[x.id as number];
        return {
          key: item.key.slice(0, 70),
          n_lines: item.n_lines,
          years: item.years?.length,
          score: Math.round((x.score as number) * 100) / 100,
        };
      }),
    });
  }
  return { results, total_ms: results.reduce((a, b) => a + (b.ms as number), 0) };
}

function segmenterProbe(): Json {
  const s = getSegmenter();
  const sample = catalog ? catalog.items.slice(0, 1000).map((i) => i.key) : [];
  const t = performance.now();
  let tokens = 0;
  for (const x of sample) tokens += tokenizeSegmenter(x).length;
  const ms = performance.now() - t;
  const t2 = performance.now();
  let tokens2 = 0;
  for (const x of sample) tokens2 += tokenizeNgram(x).length;
  const ms2 = performance.now() - t2;
  return {
    available: !!s,
    resolved: s ? (s.resolvedOptions?.() as unknown as Json) : null,
    example: s ? tokenizeSegmenter('เครื่องปรับอากาศแบบแยกส่วนชนิดติดผนัง ขนาด 18000 บีทียู') : null,
    example_ngram: tokenizeNgram('เครื่องปรับอากาศแบบแยกส่วน'),
    ms_1000_keys_segmenter: ms,
    tokens_segmenter: tokens,
    ms_1000_keys_ngram: ms2,
    tokens_ngram: tokens2,
  };
}

/** ทดสอบ folding กับข้อความจาก PDF จริง (ส านักงาน ฯลฯ) */
function foldingTest(corpus: { id: number; text: string }[]): Json {
  const mk = (fold: boolean) => {
    const m = new MiniSearch({
      fields: ['text'],
      storeFields: ['text'],
      idField: 'id',
      tokenize: (t: string) => tokenizeSegmenter(fold ? foldThai(t) : t),
      processTerm: lower,
    });
    m.addAll(corpus);
    return m;
  };
  const probe = (m: MiniSearch, q: string, fold: boolean) =>
    m.search(fold ? foldThai(q) : q, { prefix: true, combineWith: 'AND' }).length;
  const noFold = mk(false);
  const withFold = mk(true);
  const qs = ['สำนักงาน', 'ประจำปี', 'ขั้นต่ำ', 'สำนักงานประกันสังคม'];
  return {
    corpus_docs: corpus.length,
    without_folding: Object.fromEntries(qs.map((q) => [q, probe(noFold, q, false)])),
    with_folding: Object.fromEntries(qs.map((q) => [q, probe(withFold, q, true)])),
    fold_examples: qs.map((q) => ({ q, folded: foldThai(q) })),
    fold_of_broken: ['ส านักงาน', 'ประจ าปี', 'ขั้นต่ า'].map((s) => ({ raw: s, folded: foldThai(s) })),
  };
}

/** โหลด chunk ของ PDF จริง (`docs/<doc_id>.json.gz`) มาใช้เป็น corpus ทดสอบ folding */
async function loadDocCorpus(urls: string[]): Promise<{ id: number; text: string }[]> {
  const corpus: { id: number; text: string }[] = [];
  let id = 0;
  for (const u of urls) {
    const buf = await (await fetch(u)).arrayBuffer();
    const text = await new Response(
      new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    const chunks = JSON.parse(text) as { text: string }[];
    for (const c of chunks) corpus.push({ id: id++, text: c.text ?? '' });
  }
  return corpus;
}

declare global {
  interface Window {
    __s2: {
      loadDocCorpus: typeof loadDocCorpus;
      loadCatalog: typeof loadCatalog;
      buildIndex: typeof buildIndex;
      serializeIndex: typeof serializeIndex;
      runQueries: typeof runQueries;
      segmenterProbe: typeof segmenterProbe;
      foldingTest: typeof foldingTest;
      heap: typeof heap;
      gcHeap: typeof gcHeap;
      ready: boolean;
    };
  }
}

window.__s2 = {
  loadDocCorpus,
  loadCatalog,
  buildIndex,
  serializeIndex,
  runQueries,
  segmenterProbe,
  foldingTest,
  heap,
  gcHeap,
  ready: true,
};
out('s2 loaded');

// ---------- T-208: prebuilt index + catalog ผอม ----------
function indexJson(): string {
  return JSON.stringify(mini);
}

function slimCatalog(): string {
  const items = catalog!.items.map((it) => [it.key, it.name, it.n_lines, it.years, it.shards ?? []]);
  return JSON.stringify({ schema_version: 2, shard_paths: catalog!.shard_paths, items });
}

async function loadPrebuilt(url: string, variant: Variant): Promise<Json> {
  const before = await gcHeap();
  const t0 = performance.now();
  const gzBuf = await (await fetch(url)).arrayBuffer();
  const tFetch = performance.now() - t0;
  const t1 = performance.now();
  const text = await new Response(new Blob([gzBuf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const tGunzip = performance.now() - t1;
  const t2 = performance.now();
  mini = MiniSearch.loadJSON(text, miniOptions(variant));
  const tLoad = performance.now() - t2;
  const after = await gcHeap();
  // ไม่มี catalog ในหน้านี้ → query โดยไม่ map กลับ item
  const results: Json[] = [];
  for (const q of QUERIES) {
    const t = performance.now();
    const r = mini.search(q, { prefix: true, fuzzy: 0.2, combineWith: 'OR' });
    results.push({ q, ms: performance.now() - t, hits: r.length });
  }
  return {
    ms_fetch: tFetch,
    ms_gunzip: tGunzip,
    ms_loadJSON: tLoad,
    ms_total: performance.now() - t0,
    bytes_gz: gzBuf.byteLength,
    chars_json: text.length,
    heap_before: before,
    heap_after: after,
    heap_delta: (after.used as number) - (before.used as number),
    queries: { results, total_ms: results.reduce((a, b) => a + (b.ms as number), 0) },
  };
}

declare global {
  interface Window {
    __s2_indexJson: typeof indexJson;
    __s2_slimCatalog: typeof slimCatalog;
    __s2_loadPrebuilt: typeof loadPrebuilt;
  }
}
window.__s2_indexJson = indexJson;
window.__s2_slimCatalog = slimCatalog;
window.__s2_loadPrebuilt = loadPrebuilt;
