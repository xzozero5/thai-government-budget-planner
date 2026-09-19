#!/usr/bin/env node
// T-306 — Guard N2: ยืนยันว่า production build (`vite build` แบบไม่ส่ง --mode ใด ๆ) ไม่มีโค้ดที่อ้าง
// `import.meta.env.VITE_EVAL_ANTHROPIC_API_KEY` เลย
//
// หลักการ: Vite inline ค่า `VITE_*` ทุกตัวที่ "มีค่า" ตอน build ลง bundle เป็น string literal เสมอ
// (เฉพาะจุดที่โค้ดอ้าง `import.meta.env.VITE_EVAL_ANTHROPIC_API_KEY` ตรง ๆ เท่านั้น) — ถ้าไม่มีโค้ดใด
// อ้างตัวแปรนี้เลย (ตามที่ตั้งใจ: ai/eval runner อ่าน key ฝั่ง Node เท่านั้น ไม่ผ่าน import.meta.env)
// ค่าที่ตั้งไว้ตอน build จะไม่ปรากฏใน output แม้ env จะมีค่าอยู่จริงก็ตาม — สคริปต์นี้ตั้งค่า marker ปลอม
// แล้วยืนยันว่าไม่หลุดไปที่ไหน
//
// รันแยกจาก `npm test` โดยตั้งใจ (ต้อง build จริง 1 รอบ — ช้ากว่า test ปกติมาก เพราะ copy
// `web/public/data/**` ~180 MB เข้า outDir ด้วย) — main thread/CI เรียกเป็น step แยก:
//   node web/tests/eval/guard-n2.mjs
//
// ห้ามใช้สตริงรูป `sk-ant-…` เป็น marker (ตาม pre-commit hook ของ T-003 ที่ block รูปแบบนี้)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = fileURLToPath(new URL('../..', import.meta.url));
const MARKER = 'fake-marker-value-for-test-N2-guard-2569';
// Windows ไม่มี `npx` เป็น executable ตรง ๆ (เป็น `npx.cmd`) — ดูคอมเมนต์เดียวกันใน run-eval.mjs
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// เฉพาะไฟล์ text-based ที่ Vite ประมวลผลจริง (env inlining เกิดได้เฉพาะที่นี่) — ไม่ต้อง scan
// `web/public/data/**`/`duckdb-ext/**` ที่ Vite แค่ copy ทั้งก้อนโดยไม่แตะเนื้อหา (เร็วขึ้นมาก)
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.map', '.json']);

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const outDir = mkdtempSync(join(tmpdir(), 'tgbp-n2-guard-'));
  console.log(`[guard-n2] build production ไป ${outDir} (env VITE_EVAL_ANTHROPIC_API_KEY=<marker ปลอม>)`);
  try {
    execFileSync(NPX_BIN, ['vite', 'build', '--outDir', outDir], {
      cwd: WEB_DIR,
      stdio: 'inherit',
      env: { ...process.env, VITE_EVAL_ANTHROPIC_API_KEY: MARKER },
      // Windows: `.cmd` shim ของ npm ต้องรันผ่าน shell เสมอ — ดูคอมเมนต์เดียวกันใน run-eval.mjs
      shell: process.platform === 'win32',
    });

    const files = listFilesRecursive(outDir).filter((f) => TEXT_EXTENSIONS.has(extname(f)));
    console.log(
      `[guard-n2] ตรวจ ${String(files.length)} ไฟล์ text-based (ข้าม public/data ที่ copy ตรง ๆ)`,
    );

    const hits = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (text.includes(MARKER)) {
        hits.push(file);
      }
    }

    if (hits.length > 0) {
      console.error(
        '[guard-n2] FAIL — พบ marker ของ VITE_EVAL_ANTHROPIC_API_KEY หลุดเข้า production bundle:',
      );
      for (const f of hits) {
        console.error(`  - ${f}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      '[guard-n2] PASS — ไม่มีโค้ดใดอ้าง import.meta.env.VITE_EVAL_ANTHROPIC_API_KEY ใน production bundle (N2 ผ่าน)',
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main();
