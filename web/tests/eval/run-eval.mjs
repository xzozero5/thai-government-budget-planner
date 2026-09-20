#!/usr/bin/env node
// T-306 — eval runner (เสนอ `npm run eval` — ยังไม่แก้ package.json ตามขอบเขตงาน main thread เป็นคนเพิ่ม)
//
// รันได้ตรง ๆ: `node web/tests/eval/run-eval.mjs [flags]`
//
// flags:
//   --dry-run                     (ค่าเริ่มต้น) fake client, ไม่อ่าน key ใด ๆ
//   --real --confirm-spend        ต้องใส่ทั้งคู่ถึงจะยิง API จริง (อ่าน key จาก web/.env.local)
//   --tier core8|extended|all     ค่าเริ่มต้น core8
//   --case <id>                   รันแค่ 1 case (ข้าม --tier)
//   --max-usd <n>                 ค่าเริ่มต้น 1.80 (เพดานรวมของการรันครั้งนี้)
//   --max-usd-per-case-haiku <n>  ค่าเริ่มต้น 0.12
//   --max-usd-per-case-sonnet <n> ค่าเริ่มต้น 0.35
//
// สถาปัตยกรรม (docs/BACKLOG.md T-306 / main thread ตัดสินใจ 2569-09-20): รันใน browser จริงผ่าน
// Playwright บน build โหมด `e2e-harness` + `vite preview` กับข้อมูลจริง `web/public/data` — Node
// (ไฟล์นี้) ถือ key แล้วส่งเข้า page ตอน runtime ผ่าน `page.evaluate` argument เท่านั้น (เหมือน
// `web/spikes/runner/run-s3-live.mjs`) ไม่มีการ inline เข้า bundle (N2) และไม่เปิด
// trace/video/HAR/screenshot ของ Playwright (ไม่ตั้งค่าพวกนี้เลยในไฟล์นี้ = ปิดอยู่แล้วโดยปริยาย)
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { scoreCase } from './score.mjs';

const EVAL_DIR = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(EVAL_DIR, '..', '..');
const REPO_ROOT = join(WEB_DIR, '..');
const OUT_DIR = join(EVAL_DIR, 'out');
// transcript ของการรันจริง (จ่ายเงินแล้ว) เก็บแยกจาก dry-run และ commit ได้ — dry-run ห้ามเขียนทับ
// (main thread review T-306: เดิมทั้งสองโหมดเขียน `out/<id>.json` ที่เดียวกัน → dry-run ลบหลักฐานที่จ่ายเงินไปแล้วได้)
const REAL_RUNS_DIR = join(EVAL_DIR, 'real-runs');
/** เพดานเวลาต่อ case — เกินนี้ถือว่าค้าง: ปิดหน้า (หยุด request ที่ยังวิ่ง) แล้วหยุดทั้งรอบ */
const CASE_TIMEOUT_MS = 8 * 60_000;
const LEDGER_PATH = join(EVAL_DIR, 'api-spend.json');
const CASES_PATH = join(EVAL_DIR, 'cases.yaml');
const DOCS_REPORT_PATH = join(REPO_ROOT, 'docs', 'eval-report.md');
const DRY_RUN_REPORT_PATH = join(OUT_DIR, 'dry-run-report.md');

// override ได้ด้วย env `TGBP_EVAL_PORT` (เช่นเมื่อพอร์ตปกติถูก process ค้างถือไว้และปิดเองไม่ได้)
const PORT = Number(process.env.TGBP_EVAL_PORT ?? 4175);
// outDir แยกจาก e2e ของ Playwright (`dist-e2e-harness`) — agent/CI ที่รัน e2e ขนานกันจะไม่ rebuild ทับ bundle
// ที่ preview server ของ eval กำลัง serve อยู่กลาง case ที่จ่ายเงินแล้ว
const HARNESS_OUT_DIR = 'dist-eval-harness';
const BASE_URL = `http://localhost:${String(PORT)}/thai-government-budget-planner/`;

// เดียวกับ `.githooks/pre-commit` (T-003) — ใช้ตรวจ output ของ eval เอง (ไม่ใช่ commit)
const KEY_LIKE_RE = /sk-ant-[A-Za-z0-9_-]{8,}/;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    real: false,
    rescore: false,
    confirmSpend: false,
    tier: 'core8',
    case: undefined,
    maxUsd: 1.8,
    maxUsdPerCaseHaiku: 0.12,
    maxUsdPerCaseSonnet: 0.35,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') {
      args.real = false;
    } else if (a === '--real') {
      args.real = true;
    } else if (a === '--rescore') {
      // ให้คะแนน transcript จริงที่มีอยู่แล้วใน real-runs/ ใหม่ด้วยเกณฑ์ปัจจุบัน — ไม่เปิดเบราว์เซอร์, ไม่อ่าน key,
      // ไม่เรียก API (ไม่มีค่าใช้จ่าย) ใช้หลังแก้ score.mjs/cases.yaml
      args.rescore = true;
      args.real = true; // รายงานเป็นของ transcript จริง (modeLabel/REAL_RUNS_DIR)
    } else if (a === '--confirm-spend') {
      args.confirmSpend = true;
    } else if (a === '--tier') {
      i += 1;
      args.tier = argv[i];
    } else if (a === '--case') {
      i += 1;
      args.case = argv[i];
    } else if (a === '--max-usd') {
      i += 1;
      args.maxUsd = Number(argv[i]);
    } else if (a === '--max-usd-per-case-haiku') {
      i += 1;
      args.maxUsdPerCaseHaiku = Number(argv[i]);
    } else if (a === '--max-usd-per-case-sonnet') {
      i += 1;
      args.maxUsdPerCaseSonnet = Number(argv[i]);
    } else {
      console.error(`[eval] ไม่รู้จัก flag: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// ledger (append-only ต่อ request — เขียนทันทีหลังแต่ละ case, ไม่มี key ในนี้)
// ---------------------------------------------------------------------------

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return { entries: [], total_usd: 0 };
  }
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
}

function ledgerTotalUsd() {
  return loadLedger().entries.reduce((sum, e) => sum + e.est_cost_usd, 0);
}

/** เขียนทันทีหลังจบแต่ละ case (ไม่ใช่ท้ายโปรแกรม) — crash กลางทางแล้ว ledger ของ case ก่อนหน้าไม่หาย */
function appendLedgerEntries(entries) {
  if (entries.length === 0) {
    return;
  }
  const ledger = loadLedger();
  ledger.entries.push(...entries);
  ledger.total_usd = Number(ledger.entries.reduce((sum, e) => sum + e.est_cost_usd, 0).toFixed(6));
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// key — อ่านเฉพาะโหมด --real เท่านั้น (N2) ห้าม print/log ค่า
// ---------------------------------------------------------------------------

function readApiKeyFromEnvLocal() {
  const file = join(WEB_DIR, '.env.local');
  const txt = readFileSync(file, 'utf8');
  const match = /^\s*VITE_EVAL_ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m.exec(txt);
  if (!match) {
    throw new Error(
      'ไม่พบ VITE_EVAL_ANTHROPIC_API_KEY ใน web/.env.local (ต้องมีก่อนรันโหมด --real)',
    );
  }
  const key = match[1].replace(/^["']|["']$/g, '');
  if (!key.startsWith('sk-ant-')) {
    throw new Error(
      'รูปแบบ VITE_EVAL_ANTHROPIC_API_KEY ใน web/.env.local ไม่ถูกต้อง (ต้องขึ้นต้นด้วย sk-ant-)',
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// build + preview server ของ build โหมด e2e-harness (เหมือน playwright.config.ts webServer แต่เรียก
// เองตรง ๆ เพราะเป็นสคริปต์ Node แยก ไม่ผ่าน `npx playwright test`)
// ---------------------------------------------------------------------------

// Windows ไม่มี `npx` เป็น executable ตรง ๆ (เป็น `npx.cmd`) — `execFileSync`/`spawn` แบบไม่ผ่าน shell
// จึงหา ENOENT บน Windows; ใช้ `npx.cmd` บน win32 เท่านั้น (ยังคง `npx` เฉย ๆ บน mac/Linux/CI)
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function buildHarnessBundle() {
  console.log('[eval] กำลัง build bundle โหมด e2e-harness...');
  execFileSync(
    NPX_BIN,
    ['vite', 'build', '--mode', 'e2e-harness', '--outDir', HARNESS_OUT_DIR],
    {
      cwd: WEB_DIR,
      stdio: 'inherit',
      // Windows: `.cmd` shim ของ npm ต้องรันผ่าน shell เสมอ (Node child_process ข้อจำกัดที่รู้กันของ
      // Windows — ไม่เกี่ยวกับ user input ใด ๆ ในคำสั่งนี้ จึงไม่มีความเสี่ยง shell injection)
      shell: process.platform === 'win32',
    },
  );
}

function startPreviewServer() {
  return spawn(
    NPX_BIN,
    ['vite', 'preview', '--outDir', HARNESS_OUT_DIR, '--port', String(PORT), '--strictPort'],
    { cwd: WEB_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
  );
}

async function waitForServerReady(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch {
      // ยังไม่ขึ้น — ลองใหม่
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`preview server ไม่ตอบสนองภายใน ${String(timeoutMs)} ms`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function perCaseCapUsd(caseSpec, args) {
  return caseSpec.model.includes('sonnet') || caseSpec.model.includes('opus')
    ? args.maxUsdPerCaseSonnet
    : args.maxUsdPerCaseHaiku;
}

function listFilesRecursive(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** T-307 (security review): grep ผลลัพธ์ทั้งหมดของ eval (transcript เต็มใน out/, ledger, report) ว่า
 * ไม่มีสตริงรูปคล้าย Anthropic API key หลงเหลือ — ใช้ pattern เดียวกับ `.githooks/pre-commit` */
function scanOutputsForKeyLeaks(reportPath) {
  const files = [...listFilesRecursive(OUT_DIR), ...listFilesRecursive(REAL_RUNS_DIR)];
  if (existsSync(LEDGER_PATH)) {
    files.push(LEDGER_PATH);
  }
  if (existsSync(reportPath)) {
    files.push(reportPath);
  }
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (KEY_LIKE_RE.test(text)) {
      hits.push(file);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function formatCell(value) {
  return value === undefined || value === null ? '-' : String(value);
}

function writeReport(rows, args, commitHash) {
  const lines = [];
  const modeLabel = args.real
    ? 'REAL RUN (เรียก API จริง)'
    : 'DRY-RUN (fake client — ไม่มีการเรียก Anthropic API จริงเลย)';
  lines.push(`# T-306 Eval Report — ${modeLabel}`);
  lines.push('');
  lines.push(`- วันที่: ${new Date().toISOString()}`);
  lines.push(`- Tier ที่รัน: ${args.tier}${args.case !== undefined ? ` (case=${args.case})` : ''}`);
  lines.push(
    `- Judge: **rule-based** (ADR-006 ข้อ 10 / docs/07-TESTING.md §4) — ไม่ใช่ LLM-as-judge รอบนี้`,
  );
  lines.push(`- commit: ${commitHash ?? '[UNVERIFIED — ไม่พบ git ระหว่างรัน]'}`);
  lines.push('');
  lines.push(
    '| case | model | สถานะ | auto_pass | turns | tool calls | citation precision | cost (USD) | cache hit % |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');

  let totalCostUsd = 0;
  const notRun = [];
  for (const row of rows) {
    if (row.status !== 'run') {
      notRun.push(row);
      lines.push(`| ${row.caseId} | ${row.model} | ${row.status} | - | - | - | - | - | - |`);
      continue;
    }
    const t = row.transcript;
    totalCostUsd += t.totalCostUsd ?? 0;
    lines.push(
      `| ${row.caseId} | ${row.model} | run | ${row.score.auto_pass ? 'PASS' : 'FAIL'} | ${String(t.turns.length)} | ${String(t.toolCalls.length)} | ${row.score.citation.precision.toFixed(2)} | ${t.totalCostUsd.toFixed(4)} | ${formatCell(row.score.cache.cacheHitRatePct)} |`,
    );
  }

  lines.push('');
  lines.push(
    `**รวมค่าใช้จ่ายของ case ที่มีผลรันในรายงานนี้: ${totalCostUsd.toFixed(4)} USD** ` +
      '(โหมดจริงรวม transcript ของรอบก่อนใน `web/tests/eval/real-runs/` ด้วย — ยอดสะสมจริงดูที่ ledger)',
  );
  lines.push('');

  if (notRun.length > 0) {
    lines.push('## รายการ `not_run (budget)`');
    for (const row of notRun) {
      lines.push(`- ${row.caseId} (${row.model}) — ${row.status}`);
    }
    lines.push('');
  }

  lines.push('## เหตุผลที่ตก (เฉพาะ case ที่ auto_pass=false)');
  let anyFail = false;
  for (const row of rows) {
    if (row.status === 'run' && !row.score.auto_pass) {
      anyFail = true;
      lines.push(`### ${row.caseId}`);
      for (const check of row.score.checks.filter((c) => !c.pass)) {
        lines.push(`- **${check.name}**: ${check.reason}`);
      }
      lines.push('');
    }
  }
  if (!anyFail) {
    lines.push('(ไม่มี — ทุก case ที่รันจริงผ่านเกณฑ์ rule-based ทั้งหมด)');
    lines.push('');
  }

  lines.push('## หมายเหตุ');
  if (!args.real) {
    lines.push(
      '- นี่คือ **dry-run** ด้วย fake client ที่มีสคริปต์คงที่ ' +
        '(`web/src/app/dataHarness/aiEvalHarness/dryRunScript.ts`) เรียก `search_catalog` → ' +
        '`query_budget_lines` → `emit_proposal` กับข้อมูล production จริง แต่ **ไม่ได้ตอบโจทย์เนื้อหา ' +
        'ของแต่ละ case จริง** — `auto_pass=false`/คะแนนต่ำเกือบทุก case ในรายงานนี้เป็นเรื่องที่คาดหวัง ' +
        'ไม่ใช่บั๊ก วัตถุประสงค์ของรอบนี้คือพิสูจน์ว่า harness/data facade/agent loop/scoring/report ' +
        'ต่อกันได้ครบวงจรจริงเท่านั้น (T-306 จังหวะที่ 1) — ห้ามใช้ผลของรายงานนี้ตัดสินคุณภาพ prompt',
    );
  } else {
    lines.push(
      '- รันจริงด้วย Anthropic API — ดูค่าใช้จ่ายสะสมทั้งหมดที่ `web/tests/eval/api-spend.json`',
    );
  }
  lines.push('');

  const outPath = args.real ? DOCS_REPORT_PATH : DRY_RUN_REPORT_PATH;
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`[eval] เขียนรายงานที่ ${outPath}`);
  return outPath;
}

function getCommitHash() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/** บน Windows `spawn(..., {shell:true})` ได้ pid ของ cmd.exe — `child.kill()` ฆ่าแค่ shell แต่ node ของ
 * `vite preview` รอด (พบ preview ค้างถือพอร์ตข้ามรอบ 2 ครั้งแล้ว) → ปิดทั้ง process tree ของ child ตัวเอง */
function stopPreviewServer(preview) {
  if (process.platform === 'win32' && preview.pid !== undefined) {
    try {
      execFileSync('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // ตกไปใช้ kill() ปกติด้านล่าง
    }
  }
  preview.kill();
}

// ---------------------------------------------------------------------------
// --rescore: ให้คะแนน transcript จริงเดิมใหม่ (ไม่มีค่าใช้จ่าย)
// ---------------------------------------------------------------------------

function rescoreOnly(args) {
  const allCases = parseYaml(readFileSync(CASES_PATH, 'utf8'));
  const rows = allCases.map((c) => {
    const transcriptPath = join(REAL_RUNS_DIR, `${c.id}.json`);
    if (existsSync(transcriptPath)) {
      const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
      if (transcript.isDryRun === false) {
        const score = scoreCase(c, transcript, { costCapUsd: perCaseCapUsd(c, args) });
        console.log(`[eval] rescore ${c.id}: auto_pass=${String(score.auto_pass)}`);
        return { caseId: c.id, model: c.model, status: 'run', transcript, score };
      }
    }
    return { caseId: c.id, model: c.model, status: 'not_run (budget)' };
  });
  const reportPath = writeReport(rows, { ...args, tier: `${args.tier} (rescore — ไม่ได้เรียก API ใหม่)` }, getCommitHash());
  const leaks = scanOutputsForKeyLeaks(reportPath);
  if (leaks.length > 0) {
    console.error('[eval] SECURITY FAIL — พบสตริงคล้าย Anthropic API key ใน output ของ eval:', leaks);
    process.exitCode = 1;
    return;
  }
  console.log('[eval] rescore เสร็จ — ไม่มีการเรียก API');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REAL_RUNS_DIR, { recursive: true });

  if (args.rescore) {
    rescoreOnly(args);
    return;
  }

  if (args.real && !args.confirmSpend) {
    console.error(
      '[eval] โหมด --real ต้องใส่ --confirm-spend ด้วยเสมอ (กันการยิง API จริงโดยไม่ตั้งใจ) — ยกเลิก',
    );
    process.exit(1);
  }

  const allCases = parseYaml(readFileSync(CASES_PATH, 'utf8'));
  const selected =
    args.case !== undefined
      ? allCases.filter((c) => c.id === args.case)
      : allCases.filter((c) => args.tier === 'all' || c.run_tier === args.tier);
  if (selected.length === 0) {
    console.error('[eval] ไม่มี case ที่ตรงเงื่อนไข --tier/--case — ยกเลิก');
    process.exit(1);
  }
  const notSelected = allCases.filter((c) => !selected.includes(c));

  let apiKey;
  if (args.real) {
    apiKey = readApiKeyFromEnvLocal(); // ไม่ print/log ค่า key เด็ดขาด
    const potentialMaxUsd = Math.min(
      args.maxUsd,
      selected.reduce((sum, c) => sum + perCaseCapUsd(c, args), 0),
    );
    console.log(
      `[eval] โหมด REAL — จะใช้สูงสุด ${potentialMaxUsd.toFixed(2)} USD ในรอบนี้ ` +
        `(เพดานรวม ${args.maxUsd.toFixed(2)} USD, ${String(selected.length)} case, ` +
        `เพดานต่อ case: haiku=${args.maxUsdPerCaseHaiku} / sonnet=${args.maxUsdPerCaseSonnet})`,
    );
  } else {
    console.log(
      '[eval] โหมด DRY-RUN (fake client) — ไม่เรียก Anthropic API จริง, ไม่อ่าน web/.env.local',
    );
  }

  // กัน preview server ค้างจากการรันครั้งก่อน (เคยพบ dry-run ค้างถือ port ไว้หลายชั่วโมง): ถ้ามีใครตอบที่ port นี้
  // อยู่แล้ว `--strictPort` ของเราจะล้มเงียบ ๆ และ eval จะไปยิงกับ bundle เก่าของ server ค้าง → ยกเลิกก่อนใช้เงิน
  const portAlreadyServing = await fetch(BASE_URL).then(
    () => true,
    () => false,
  );
  if (portAlreadyServing) {
    console.error(
      `[eval] มี server อื่นตอบอยู่ที่ ${BASE_URL} แล้ว (อาจเป็น preview ค้างจากรอบก่อน) — ปิด process นั้นก่อนแล้วรันใหม่`,
    );
    process.exit(1);
  }

  buildHarnessBundle();
  const preview = startPreviewServer();
  const rows = [];
  let aborted = false;

  try {
    await waitForServerReady(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    // ไม่เปิด trace/video/HAR/screenshot เลย (ไม่ตั้งค่าเหล่านี้ = ปิดอยู่แล้วโดยปริยายของ Playwright)
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}#/__ai-eval`);
    await page.waitForSelector('[data-testid="ai-eval-harness-root"][data-ready="true"]', {
      state: 'attached',
    });

    await page.evaluate(
      ([key, useFakeClient]) => {
        window.__evalHarness.init({ apiKey: key, useFakeClient });
      },
      [apiKey ?? '', !args.real],
    );

    // (ง) รันทีละ case ตามลำดับ ไม่ขนาน — (จ) ไม่ retry case ที่ error
    for (const caseSpec of selected) {
      const cap = perCaseCapUsd(caseSpec, args);
      const spentSoFar = ledgerTotalUsd();
      if (args.real && spentSoFar + cap > args.maxUsd) {
        console.log(
          `[eval] ${caseSpec.id}: ledger สะสม ${spentSoFar.toFixed(4)} + เพดาน case ${cap.toFixed(4)} ` +
            `> งบรวม ${args.maxUsd.toFixed(4)} USD → not_run (budget)`,
        );
        rows.push({ caseId: caseSpec.id, model: caseSpec.model, status: 'not_run (budget)' });
        continue;
      }

      console.log(`[eval] กำลังรัน case "${caseSpec.id}" (${caseSpec.model})...`);
      const limits = { maxToolRounds: 8, maxCostUsdPerTurn: cap, maxCostUsdPerSession: cap };

      let transcript;
      // true = ไม่รู้ว่า case นี้จ่ายเงินไปเท่าไร (page.evaluate พัง/ค้าง → ไม่ได้ usage กลับมา)
      let spendUnknown = false;
      let timeoutHandle;
      try {
        transcript = await Promise.race([
          page.evaluate(
            ([spec, lim]) => window.__evalHarness.runCase(spec, lim),
            [caseSpec, limits],
          ),
          new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`case ค้างเกิน ${String(CASE_TIMEOUT_MS / 1000)} วินาที`));
            }, CASE_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        spendUnknown = true;
        transcript = {
          caseId: caseSpec.id,
          model: caseSpec.model,
          mode: caseSpec.mode,
          turns: [],
          toolCalls: [],
          perRequestUsage: [],
          toolLogSummary: {},
          proposal: null,
          proposalWarnings: [],
          totalCostUsd: 0,
          elapsedMs: 0,
          finalEndedBecause: 'error',
          ranAt: new Date().toISOString(),
          isDryRun: !args.real,
          fatalError: err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timeoutHandle);
      }

      // (ข) ledger append-only — เขียนทันทีหลัง case นี้ (ก่อนอ่านไฟล์อื่นใด ๆ ต่อ) ไม่มี key ในนี้
      if (args.real) {
        if (spendUnknown) {
          // ไม่รู้ยอดจริง → ลง ledger แบบอนุรักษ์เท่าเพดานของ case (agent loop หยุดยิงเมื่อถึงเพดานนี้
          // จึงเป็นขอบบนที่สมเหตุสมผล) แล้วให้คนไปเทียบกับ Console ของ Anthropic ภายหลัง
          appendLedgerEntries([
            {
              at: new Date().toISOString(),
              case: caseSpec.id,
              model: caseSpec.model,
              turn_index: -1,
              input_tokens: 0,
              output_tokens: 0,
              cache_read: 0,
              cache_creation: 0,
              web_search_requests: 0,
              est_cost_usd: cap,
              conservative_unknown_spend: true,
            },
          ]);
        }
        appendLedgerEntries(
          (transcript.perRequestUsage ?? []).map((r) => ({
            at: new Date().toISOString(),
            case: caseSpec.id,
            model: r.model,
            turn_index: r.turnIndex,
            input_tokens: r.inputTokens,
            output_tokens: r.outputTokens,
            cache_read: r.cacheReadInputTokens,
            cache_creation: r.cacheCreationInputTokens,
            web_search_requests: r.webSearchRequests,
            est_cost_usd: Number(r.costUsd.toFixed(6)),
          })),
        );
      }

      writeFileSync(
        join(args.real ? REAL_RUNS_DIR : OUT_DIR, `${caseSpec.id}.json`),
        JSON.stringify(transcript, null, 2),
        'utf8',
      );

      const score = scoreCase(caseSpec, transcript, { costCapUsd: cap });
      rows.push({ caseId: caseSpec.id, model: caseSpec.model, status: 'run', transcript, score });
      console.log(
        `[eval]   auto_pass=${String(score.auto_pass)} cost=${transcript.totalCostUsd.toFixed(4)} USD ` +
          `turns=${String(transcript.turns.length)} endedBecause=${transcript.finalEndedBecause}`,
      );

      // โหมดจริง: case ที่ error ระดับ harness (ไม่ใช่แค่ตก rubric) → หยุดทั้งรอบทันที ไม่ยิง case ถัดไป
      // จนกว่าคนจะดูสาเหตุ — งบมีจำกัด (docs/api-budget.md) ห้ามเผาเงินซ้ำกับความผิดพลาดเดิม
      if (args.real && (spendUnknown || transcript.fatalError !== undefined)) {
        console.error(
          `[eval] ${caseSpec.id}: error ระดับ harness (${String(transcript.fatalError)}) → หยุดรอบนี้ ` +
            'case ที่เหลือเป็น not_run (aborted)',
        );
        aborted = true;
        if (spendUnknown) {
          await page.close().catch(() => undefined); // ตัด request ที่อาจยังวิ่งอยู่
        }
        break;
      }
    }

    if (aborted) {
      const done = new Set(rows.map((r) => r.caseId));
      for (const c of selected.filter((s) => !done.has(s.id))) {
        rows.push({ caseId: c.id, model: c.model, status: 'not_run (aborted)' });
      }
    }

    for (const c of notSelected) {
      // โหมดจริง: case ที่เคยรันจริงไว้ในรอบก่อน (จ่ายเงินแล้ว) ให้นำ transcript เดิมมาให้คะแนนใหม่ในรายงาน
      // ไม่ต้องยิงซ้ำ — ทำให้รันทีละ case/ทีละกลุ่มแล้วรายงานยังครบ
      const earlierPath = join(REAL_RUNS_DIR, `${c.id}.json`);
      if (args.real && existsSync(earlierPath)) {
        const earlier = JSON.parse(readFileSync(earlierPath, 'utf8'));
        if (earlier.isDryRun === false) {
          const score = scoreCase(c, earlier, { costCapUsd: perCaseCapUsd(c, args) });
          rows.push({ caseId: c.id, model: c.model, status: 'run', transcript: earlier, score });
          continue;
        }
      }
      rows.push({ caseId: c.id, model: c.model, status: 'not_run (budget)' });
    }

    await browser.close();
  } finally {
    stopPreviewServer(preview);
  }

  const caseOrder = new Map(allCases.map((c, i) => [c.id, i]));
  rows.sort((a, b) => (caseOrder.get(a.caseId) ?? 0) - (caseOrder.get(b.caseId) ?? 0));
  const reportPath = writeReport(rows, args, getCommitHash());

  const leaks = scanOutputsForKeyLeaks(reportPath);
  if (leaks.length > 0) {
    console.error('[eval] SECURITY FAIL — พบสตริงคล้าย Anthropic API key ใน output ของ eval:');
    for (const f of leaks) {
      console.error(`  - ${f}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[eval] เสร็จสิ้น — ตรวจแล้วไม่พบสตริงคล้าย API key ใน out/, ledger, report');
}

main().catch((err) => {
  console.error('[eval] ล้มเหลว:', err);
  process.exitCode = 1;
});
