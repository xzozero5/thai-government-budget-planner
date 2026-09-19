/// <reference types="node" />
/**
 * Test-only helper — จำลอง `fetch` ที่อ่านไฟล์จาก `web/tests/fixtures/data/` แทนการยิง network
 * จริง (T-202 ข้อ 3: inject `fetchImpl` ที่อ่านไฟล์จาก fixtures) ไฟล์นี้ไม่ถูก import จากโค้ด
 * แอปจริง (เฉพาะไฟล์ `*.test.ts` ในไดเรกทอรีนี้เท่านั้นที่ import) — อยู่ใน `src/data/` เพื่อให้อยู่
 * ใน tsconfig project เดียวกับโค้ดที่มันทดสอบ (หลีกเลี่ยงการแก้ tsconfig ซึ่งอยู่นอกขอบเขตงานนี้)
 *
 * `tsconfig.app.json` (ห้ามแก้ไขในงานนี้) จำกัด `"types": ["vite/client"]` จึงไม่ได้ ambient
 * type ของ Node มาอัตโนมัติ — ใช้ triple-slash reference ดึง @types/node เฉพาะไฟล์ test-only นี้
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// หมายเหตุ: ตั้งใจไม่ใช้ `import.meta.url` + `new URL(...)` เพราะ Vite/Vitest แปลง
// `import.meta.url` ของไฟล์ทดสอบเป็นค่าที่ไม่ใช่ scheme `file:` เสมอไป (พังบน Windows) — ใช้
// `process.cwd()` แทน (npm scripts ทุกตัวรันจาก `web/` เป็น cwd เสมอ)
export const FIXTURES_DATA_DIR = path.resolve(process.cwd(), 'tests/fixtures/data');

/** ดึง relative path (ใต้ `data/`) ออกจาก URL ที่ `dataUrl()` สร้าง เช่น
 * `/thai-government-budget-planner/data/manifest.json` → `manifest.json` */
export function fixtureRelPathFromUrl(url: string): string {
  const marker = '/data/';
  const idx = url.lastIndexOf(marker);
  if (idx === -1) {
    throw new Error(`[test helper] ไม่พบ "/data/" ใน url: ${url}`);
  }
  return decodeURIComponent(url.slice(idx + marker.length));
}

/** สร้าง fetch implementation ที่อ่านจาก `web/tests/fixtures/data/` (ไม่แตะ network จริง) */
export function createFixtureFetch(): typeof fetch {
  const fixtureFetch = (input: RequestInfo | URL): Promise<Response> => {
    // ไม่ใช้ `.toString()` ตรง ๆ กับ `Request` เพราะไม่ได้ override (ได้ '[object Request]')
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const relPath = fixtureRelPathFromUrl(url);
    const filePath = path.join(FIXTURES_DATA_DIR, relPath);
    if (!existsSync(filePath)) {
      return Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' }));
    }
    const bytes = readFileSync(filePath);
    return Promise.resolve(new Response(bytes, { status: 200 }));
  };
  return fixtureFetch;
}

/** absolute path ของไฟล์ fixture (ไว้อ่านตรง ๆ เช่นด้วย hyparquet) */
export function fixtureFilePath(relPath: string): string {
  return path.join(FIXTURES_DATA_DIR, relPath);
}

/**
 * เดินไฟล์ทั้งหมดใต้ `subDir` (relative ต่อ `data/`) แบบ recursive แล้วคืน relative path
 * (ต่อ `data/`, ใช้ '/' เสมอไม่ว่า OS ไหน) ของไฟล์ที่ลงท้ายด้วย `suffix`
 */
export function listFixtureFiles(subDir: string, suffix: string): string[] {
  const root = fixtureFilePath(subDir);
  const result: string[] = [];
  const walk = (dir: string, relBase: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const rel = relBase.length > 0 ? `${relBase}/${entry}` : entry;
      if (statSync(abs).isDirectory()) {
        walk(abs, rel);
      } else if (entry.endsWith(suffix)) {
        result.push(`${subDir}/${rel}`);
      }
    }
  };
  walk(root, '');
  return result;
}
