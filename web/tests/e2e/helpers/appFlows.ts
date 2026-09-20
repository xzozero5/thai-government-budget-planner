/**
 * T-409 — flow ที่ใช้ซ้ำหลาย spec: เปิด KeyGate แล้วใส่ key ปลอม, ติดตั้ง network/CSP audit ทั้งหน้า
 */
import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { FAKE_API_KEY } from './mockAnthropic';

export { FAKE_API_KEY };

/** เปิดหน้าแรก (`#/`) แล้วกรอก+ยืนยัน key ปลอม — mock ของ `/v1/messages/count_tokens` ต้องถูก
 * `setCountTokensMode` เป็น `{kind:'ok'}` (ค่าเริ่มต้นของ `createAnthropicMock`) ไว้ก่อนเรียกฟังก์ชันนี้ */
export async function submitFakeKeyAndEnterWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('API key ของ Anthropic').fill(FAKE_API_KEY);
  await page.getByRole('button', { name: 'ทดสอบและเริ่ม' }).click();
  await page.waitForURL(/#\/workspace/);
  // ใช้ region ของ `ChatPane` เอง (`a11y.chatRegion`) แทน wrapper ของ `WorkspacePage`
  // (`workspace.chatPane`) เพราะอันหลังไม่ถูก render ในเลย์เอาต์มือถือ (Tabs) — อันนี้เห็นได้ทั้งสองเลย์เอาต์
  await expect(page.getByRole('region', { name: 'บทสนทนากับผู้ช่วย' })).toBeVisible();
}

/** ประวัติแชท (`a11y.chatLog`) — ใช้ scope ข้อความผู้ช่วย/ผู้ใช้เวลา assert ข้อความซ้ำกับที่อื่น (เช่น
 * `aria-live` sr-only announcement ของ `ChatPane` ที่พูดข้อความเดียวกันซ้ำอีกที่ตอนจบ stream) */
export function chatLog(page: Page): Locator {
  return page.getByLabel('ประวัติข้อความ');
}

export interface NetworkAudit {
  /** origin ของทุก request ที่หน้านี้ยิง (same-origin ถูก normalize เป็น literal `'same-origin'`) */
  origins(): string[];
  /** request ที่ origin ไม่ใช่ same-origin และไม่ใช่ `https://api.anthropic.com` */
  foreignOriginRequests(): { url: string; origin: string }[];
  cspViolations(): string[];
  consoleErrors(): string[];
}

/** ติดตั้ง listener ก่อน `page.goto` เสมอ (ไม่งั้นพลาด request ช่วงโหลดแรก) — เก็บทุก request/console/CSP
 * violation ตลอดอายุของ page นี้ เพื่อ audit ตาม 07 §3.3 ข้อ 3 / 09-SECURITY §5 C2/C3
 *
 * เป็น `async` เพราะต้อง `await` การติดตั้ง `exposeFunction`/`addInitScript` ให้เสร็จก่อน caller เรียก
 * `page.goto()` ต่อ (ไม่งั้นชนกันได้ว่า navigation แรกเกิดก่อน binding ถูกผูกเสร็จ) */
export async function installNetworkAudit(page: Page): Promise<NetworkAudit> {
  const requests: { url: string; origin: string }[] = [];
  const csp: string[] = [];
  const consoleErrs: string[] = [];

  page.on('request', (request) => {
    try {
      requests.push({ url: request.url(), origin: new URL(request.url()).origin });
    } catch {
      // URL แปลก ๆ (เช่น blob:/data:) — ไม่ใช่ network egress จริง ข้ามได้
    }
  });

  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrs.push(text);
      if (/content security policy/i.test(text)) {
        csp.push(text);
      }
    }
  });

  // `securitypolicyviolation` DOM event — ครอบคลุมกรณีที่ browser ไม่พิมพ์ error ลง console เสมอไป
  //
  // หมายเหตุ: `tests/e2e/**` ถูก type-check ด้วย `tsconfig.node.json` (lib: ES2023, ไม่มี DOM — เหมือน
  // `data/duckdb-repo.spec.ts`) จึงอ้าง `window`/`document` ตรง ๆ ใน callback ของ `page.evaluate`/
  // `page.addInitScript` (ที่รันในบริบท browser) ไม่ได้ — ใช้ string literal แทน (Playwright evaluate
  // เป็น expression/สคริปต์ดิบก็ได้ ไม่ต้องเป็น TS function เสมอไป) ตามแบบเดียวกับ `workerXhrLog` ใน
  // `web/spikes/runner/lib/harness.mjs` และ `worker.evaluate(...)` ใน `duckdb-repo.spec.ts`
  try {
    await page.exposeFunction('__e2eReportCspViolation', (detail: string) => {
      csp.push(detail);
    });
  } catch {
    /* เรียกซ้ำได้ในบาง test ที่ใช้ page เดียวกันหลาย flow — เพิกเฉย EEXIST */
  }
  await page.addInitScript(`(function () {
    window.addEventListener('securitypolicyviolation', function (e) {
      if (window.__e2eReportCspViolation) {
        window.__e2eReportCspViolation(e.violatedDirective + ': ' + e.blockedURI);
      }
    });
  })();`);

  return {
    origins(): string[] {
      return [...new Set(requests.map((r) => r.origin))];
    },
    foreignOriginRequests(): { url: string; origin: string }[] {
      // `page.url()` อ่านตอนเรียกฟังก์ชันนี้ (หลัง flow จบแล้ว) — same-origin ที่แท้จริงของ preview
      // server (`http://localhost:4173`/`4174` แล้วแต่ project) รู้ได้แน่นอนจากตรงนี้เท่านั้น
      // (ตอนติดตั้ง listener ก่อน `page.goto` ยังไม่มี URL ให้อ่าน)
      let selfOrigin: string;
      try {
        selfOrigin = new URL(page.url()).origin;
      } catch {
        selfOrigin = '';
      }
      return requests.filter((r) => r.origin !== selfOrigin && r.origin !== 'https://api.anthropic.com');
    },
    cspViolations(): string[] {
      return csp;
    },
    consoleErrors(): string[] {
      return consoleErrs;
    },
  };
}

// ---------------------------------------------------------------------------
// Storage audit (07 §3.3 ข้อ 3 / 09-SECURITY §5 C1/C7)
// ---------------------------------------------------------------------------

export interface StorageSnapshot {
  localStorageEntries: [string, string][];
  sessionStorageEntries: [string, string][];
  cookie: string;
  historyState: unknown;
  hash: string;
  /** [dbName, storeName, key, valueAsString][] ของทุกค่าที่อยู่ใน IndexedDB ทุกฐานข้อมูลของ origin นี้ */
  indexedDbDump: [string, string, string, string][];
}

/** สคริปต์ browser-context ดิบ (string — เหตุผลเดียวกับ CSP init script ด้านบน: `tsconfig.node.json`
 * ไม่มี DOM lib ให้ type-check `localStorage`/`document`/`indexedDB` ฯลฯ ตรง ๆ) — คืน `StorageSnapshot`
 * เป็น JSON-serializable ล้วน */
const CAPTURE_STORAGE_SNAPSHOT_SCRIPT = `(async function () {
  var localStorageEntries = [];
  for (var i = 0; i < localStorage.length; i++) {
    var lk = localStorage.key(i);
    if (lk !== null) localStorageEntries.push([lk, localStorage.getItem(lk) || '']);
  }
  var sessionStorageEntries = [];
  for (var j = 0; j < sessionStorage.length; j++) {
    var sk = sessionStorage.key(j);
    if (sk !== null) sessionStorageEntries.push([sk, sessionStorage.getItem(sk) || '']);
  }

  var indexedDbDump = [];
  if (typeof indexedDB.databases === 'function') {
    var dbs = await indexedDB.databases();
    for (const dbInfo of dbs) {
      if (!dbInfo.name) continue;
      await new Promise((resolve) => {
        var openReq = indexedDB.open(dbInfo.name);
        openReq.onsuccess = function () {
          var db = openReq.result;
          var storeNames = Array.from(db.objectStoreNames);
          if (storeNames.length === 0) {
            db.close();
            resolve();
            return;
          }
          var tx = db.transaction(storeNames, 'readonly');
          var pending = storeNames.length;
          for (const storeName of storeNames) {
            var getAllReq = tx.objectStore(storeName).getAll();
            getAllReq.onsuccess = function () {
              for (const value of getAllReq.result) {
                indexedDbDump.push([
                  dbInfo.name,
                  storeName,
                  '*',
                  typeof value === 'string' ? value : JSON.stringify(value),
                ]);
              }
              pending--;
              if (pending === 0) { db.close(); resolve(); }
            };
            getAllReq.onerror = function () {
              pending--;
              if (pending === 0) { db.close(); resolve(); }
            };
          }
        };
        openReq.onerror = function () { resolve(); };
      });
    }
  }

  return {
    localStorageEntries: localStorageEntries,
    sessionStorageEntries: sessionStorageEntries,
    cookie: document.cookie,
    historyState: history.state,
    hash: location.hash,
    indexedDbDump: indexedDbDump,
  };
})();`;

/** เก็บทุกอย่างที่อาจมี key/แชทหลุดค้าง — ใช้ตรวจว่า "ไม่มีสตริง key/ข้อความแชท" (ไม่ใช่ "ต้องว่างสนิท"
 * เพราะ IndexedDB ของ DuckDB-WASM เอง ถ้ามี ก็ไม่ใช่ปัญหาความปลอดภัยตราบใดที่ไม่มี key/แชทอยู่ในนั้น) */
export async function captureStorageSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate<StorageSnapshot>(CAPTURE_STORAGE_SNAPSHOT_SCRIPT);
}

/** ยืนยันว่าไม่มีสตริง `needle` (เช่น fake key) อยู่ใน storage/DOM/URL เลย */
export function assertNoSecretLeak(snapshot: StorageSnapshot, needle: string): void {
  const haystacks: string[] = [
    ...snapshot.localStorageEntries.flat(),
    ...snapshot.sessionStorageEntries.flat(),
    snapshot.cookie,
    snapshot.hash,
    JSON.stringify(snapshot.historyState),
    ...snapshot.indexedDbDump.map((row) => row[3]),
  ];
  for (const value of haystacks) {
    expect(value.includes(needle), `พบสตริงต้องห้ามหลุดอยู่ใน storage/URL: ${value.slice(0, 120)}`).toBe(false);
  }
}
