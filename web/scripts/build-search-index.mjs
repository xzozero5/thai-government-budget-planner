#!/usr/bin/env node
/**
 * T-208 — สร้าง `catalog/items-slim.json.gz` + `catalog/search-index.json.gz` จาก
 * `catalog/items.json.gz` (schema v2, `docs/03-DATA-PIPELINE.md` §3.4)
 *
 * ใช้ tokenizer/fold/MiniSearch options **ชุดเดียวกับ browser เป๊ะ** โดย import
 * `web/src/data/search.ts` ตรง ๆ (ไม่ copy logic มาไว้ที่นี่) — ปัญหาคือไฟล์นี้เป็น plain Node ESM
 * (`.mjs`) รันด้วย Node ปกติ (ไม่ผ่าน Vite) จึง `import` ไฟล์ `.ts` ตรง ๆ ไม่ได้
 *
 * ทางที่เลือก (ประเมินแล้วว่าเสถียรสุดในบรรดาตัวเลือกที่มี โดยไม่เพิ่ม dependency ใหม่):
 *   ใช้ `esbuild` (มีอยู่แล้วเป็น dependency ของ `vite` ใน devDependencies — resolve ได้จาก
 *   `web/node_modules/esbuild` โดยไม่ต้องเพิ่มลง package.json) **bundle** `src/data/search.ts`
 *   (`packages: 'external'` กัน `zod`/`minisearch` ถูก inline — ให้ Node resolve เองตามปกติ) แล้ว
 *   เขียนผลลัพธ์เป็นไฟล์ `.mjs` ชั่วคราว **ไว้ใต้ `web/` เอง** (ไม่ใช่ os temp dir) เพราะ Node ESM
 *   resolve bare specifier (`zod`, `minisearch`) โดยไล่หา `node_modules` จากตำแหน่งไฟล์ที่ import
 *   ขึ้นไป — ถ้าไฟล์ชั่วคราวอยู่นอก `web/` จะหา `web/node_modules` ไม่เจอ แล้ว `import()` ไฟล์นั้น
 *   จากนั้นลบทิ้งทันที (ไม่ commit อะไรค้าง)
 *
 *   ทางเลือกอื่นที่พิจารณาแล้วตัดทิ้ง:
 *   - `node --experimental-strip-types`: Node 22.15.1 (เครื่อง dev ปัจจุบัน) รองรับ แต่เป็น flag
 *     experimental ที่ต้องเปิดเอง (ต่างจาก Node ≥ 23.6 ที่เปิดให้โดย default) — ผูก CI/เครื่อง dev อื่น
 *     กับ flag เฉพาะเวอร์ชันนี้เสี่ยงกว่า และไม่รองรับ syntax TS บางแบบ (enum ฯลฯ) ถ้าโค้ดเปลี่ยนในอนาคต
 *   - เขียน logic ซ้ำเป็น `.mjs` ต่างหาก: เสี่ยง tokenizer ระหว่าง build กับ browser เพี้ยนจากกัน
 *     (เหตุผลหลักที่ T-208 กำชับให้ import โค้ดเดียวกัน — `docs/BACKLOG.md`)
 *
 * ใช้: `node scripts/build-search-index.mjs [--data-dir <path>] [--fixtures]`
 *   --data-dir <path>  โฟลเดอร์ข้อมูล (default: web/public/data)
 *   --fixtures         shortcut ของ --data-dir web/tests/fixtures/data
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dataDir: undefined, fixtures: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixtures') {
      args.fixtures = true;
    } else if (arg === '--data-dir') {
      i += 1;
      args.dataDir = argv[i];
    } else if (arg.startsWith('--data-dir=')) {
      args.dataDir = arg.slice('--data-dir='.length);
    } else {
      throw new Error(`ไม่รู้จัก argument: ${arg}`);
    }
  }
  return args;
}

function resolveDataDir(args) {
  if (args.dataDir !== undefined) {
    return path.resolve(process.cwd(), args.dataDir);
  }
  if (args.fixtures) {
    return path.join(WEB_DIR, 'tests', 'fixtures', 'data');
  }
  return path.join(WEB_DIR, 'public', 'data');
}

function printHelp() {
  console.log(
    [
      'ใช้: node scripts/build-search-index.mjs [--data-dir <path>] [--fixtures]',
      '',
      '  --data-dir <path>  โฟลเดอร์ข้อมูล (default: web/public/data)',
      '  --fixtures         shortcut ของ --data-dir web/tests/fixtures/data',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// bundle + import web/src/data/search.ts ผ่าน esbuild (ดูเหตุผลด้านบนไฟล์)
// ---------------------------------------------------------------------------

async function loadSearchModule() {
  const entry = path.join(WEB_DIR, 'src', 'data', 'search.ts');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external', // 'zod'/'minisearch' ให้ Node resolve เองจาก web/node_modules
    write: false,
    logLevel: 'silent',
  });
  const outputFile = result.outputFiles[0];
  if (!outputFile) {
    throw new Error('esbuild ไม่ได้สร้าง output ของ src/data/search.ts');
  }

  // ไฟล์ชั่วคราวต้องอยู่ใต้ web/ เพื่อให้ Node resolve bare specifier ('zod', 'minisearch') เจอ
  // web/node_modules (ดูคำอธิบายยาวที่หัวไฟล์)
  const tmpDir = path.join(WEB_DIR, 'node_modules', '.tgbp-build-search-index-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `search.${String(process.pid)}.${randomUUID()}.mjs`);
  writeFileSync(tmpFile, outputFile.text, 'utf8');
  try {
    return await import(pathToFileURL(tmpFile).href);
  } finally {
    // ลบเฉพาะไฟล์ของ process นี้ — ห้ามลบทั้ง tmpDir (โฟลเดอร์ใช้ร่วมกัน): main thread พบ race จริง
    // เมื่อสคริปต์ถูกรันพร้อมกัน 2 process (vitest workers / tgbp publish + sample) ตัวหนึ่งลบไฟล์ของ
    // อีกตัวก่อนถึง import() → ล้มแบบ flaky
    rmSync(tmpFile, { force: true });
  }
}

// ---------------------------------------------------------------------------
// gzip แบบ deterministic — `zlib.gzipSync` ของ Node ไม่เขียน mtime ลง header เอง (ตรวจแล้ว: byte
// mtime field เป็น 0 เสมอ ไม่ว่าจะรันกี่รอบ) แค่ fix `level` ให้คงที่ก็พอสำหรับ byte เท่ากันทุกรอบ
// ---------------------------------------------------------------------------

function writeGzDeterministic(outPath, jsonString) {
  const gz = gzipSync(Buffer.from(jsonString, 'utf8'), { level: 9 });
  writeFileSync(outPath, gz);
  return gz;
}

function sha256Of(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function reportFile(outPath, gzBuf) {
  console.log(`${outPath}\tbytes=${String(gzBuf.length)}\tsha256=${sha256Of(gzBuf)}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const dataDir = resolveDataDir(args);
  console.log(`[build-search-index] data dir: ${dataDir}`);

  const searchModule = await loadSearchModule();
  const {
    catalogMiniSearchOptions,
    TOKENIZER_VERSION,
    CatalogFileSchema,
    CatalogSlimFileSchema,
    SearchIndexFileSchema,
  } = searchModule;

  const manifestPath = path.join(dataDir, 'manifest.json');
  const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dataVersion = manifestRaw.data_version;
  if (typeof dataVersion !== 'string' || dataVersion.length === 0) {
    throw new Error(`${manifestPath} ไม่มี data_version ที่ใช้ได้`);
  }

  const catalogGzPath = path.join(dataDir, 'catalog', 'items.json.gz');
  const catalogRaw = JSON.parse(gunzipSync(readFileSync(catalogGzPath)).toString('utf8'));
  const catalogParsed = CatalogFileSchema.safeParse(catalogRaw);
  if (!catalogParsed.success) {
    throw new Error(`${catalogGzPath} ไม่ตรง CatalogFileSchema: ${catalogParsed.error.message}`);
  }
  const catalog = catalogParsed.data;
  console.log(
    `[build-search-index] อ่าน ${catalogGzPath}: ${String(catalog.items.length)} items, data_version=${dataVersion}`,
  );

  // --- catalog/items-slim.json.gz ---
  const slimItems = catalog.items.map((item, i) => {
    /** @type {Record<string, unknown>} */
    const slim = {
      i,
      key: item.key,
      name: item.name,
      n_lines: item.n_lines,
      years: item.years,
      has_unit_price: item.unit_price !== undefined,
    };
    if (item.low_specificity === true) {
      slim.low_specificity = true;
    }
    if (item.trend !== undefined) {
      slim.trend = item.trend;
    }
    return slim;
  });
  const slimFile = { schema_version: 1, data_version: dataVersion, items: slimItems };
  const slimParsed = CatalogSlimFileSchema.safeParse(slimFile);
  if (!slimParsed.success) {
    throw new Error(
      `slim output ที่สร้างเองไม่ตรง CatalogSlimFileSchema: ${slimParsed.error.message}`,
    );
  }

  // --- catalog/search-index.json.gz (MiniSearch key_only prebuilt) ---
  const { default: MiniSearch } = await import('minisearch');
  const mini = new MiniSearch(catalogMiniSearchOptions());
  mini.addAll(catalog.items.map((item, i) => ({ id: i, key: item.key })));
  const indexFile = {
    schema_version: 1,
    data_version: dataVersion,
    tokenizer_version: TOKENIZER_VERSION,
    variant: 'key_only',
    fields: ['key'],
    minisearch: mini.toJSON(),
  };
  const indexParsed = SearchIndexFileSchema.safeParse(indexFile);
  if (!indexParsed.success) {
    throw new Error(
      `search-index output ที่สร้างเองไม่ตรง SearchIndexFileSchema: ${indexParsed.error.message}`,
    );
  }

  // --- เขียนไฟล์ ---
  const slimOutPath = path.join(dataDir, 'catalog', 'items-slim.json.gz');
  const indexOutPath = path.join(dataDir, 'catalog', 'search-index.json.gz');
  const slimGz = writeGzDeterministic(slimOutPath, JSON.stringify(slimFile));
  const indexGz = writeGzDeterministic(indexOutPath, JSON.stringify(indexFile));

  reportFile(slimOutPath, slimGz);
  reportFile(indexOutPath, indexGz);
}

// รัน `main()` เฉพาะตอนถูกเรียกเป็น CLI ตรง ๆ (`node scripts/build-search-index.mjs`) — ให้ import
// เป็นโมดูล (เช่นจาก unit test ของ `parseArgs`/`resolveDataDir`) โดยไม่มี side effect ได้ด้วย
const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainModule) {
  await main();
}

export { parseArgs, resolveDataDir, WEB_DIR };
