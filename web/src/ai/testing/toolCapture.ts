/**
 * T-306 — instrumentation ที่ห่อ `run()` ของทุก tool ใน `TOOL_REGISTRY` (`ai/tools/index.ts`) เพื่อเก็บ
 * (input, output) "ดิบ" ของแต่ละครั้งที่ tool ถูกเรียกจริง ก่อนที่ `createTool()` (`ai/tools/toolKit.ts`)
 * จะห่อผลลัพธ์เป็น `tool_result.content` — **ตั้งใจไม่ไปแตะ/parse string ที่ห่อแล้วเลย** เพราะ delimiter/
 * escaping/nonce ของมันกำลังเปลี่ยนไปพร้อมกันใน T-307 (security review) — จุดนี้จับผลลัพธ์ "ดิบ" จาก
 * `ToolRunResult` โดยตรง จึงไม่ขึ้นกับรูปแบบการห่อเลย
 *
 * ใช้ทั้งใน:
 * - `app/dataHarness/aiEvalHarness/dryRunScript.ts` (T-306 dry-run fake client อ่านผลลัพธ์จริงของรอบก่อน
 *   มาประกอบ tool_use ของรอบถัดไป โดยไม่ต้อง mock data facade เอง)
 * - `app/dataHarness/AiEvalHarnessPage.tsx` (ประกอบ transcript ของ eval: input/outputPreview ต่อ tool call)
 *
 * **ใช้ได้เฉพาะไฟล์ `*.test.ts` และ `web/src/app/dataHarness/**`** (เหมือน `ai/testing/fakeAnthropic.ts`)
 * — มัน mutate `run` ของ object singleton ที่ export จาก `ai/tools/index.ts` ตรง ๆ (เจตนา: ให้ agent.ts
 * เรียกผ่าน `TOOL_BY_NAME` ที่อ้าง object เดียวกันได้โดยไม่ต้องแก้ agent.ts) — เหมาะกับหน้า eval harness
 * ที่เป็นแท็บเดี่ยวอายุสั้นเท่านั้น ห้ามใช้ในโค้ด production ที่รันพร้อม session ผู้ใช้จริง
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import { TOOL_REGISTRY } from '@/ai/tools';

export interface CapturedToolCall {
  seq: number;
  name: string;
  input: unknown;
  isError: boolean;
  /** มีเฉพาะ `isError: false` */
  output?: unknown;
  /** มีเฉพาะ `isError: true` — `tool_result.content` ดิบ (ไม่มี delimiter ของ success path) */
  errorContent?: string;
}

/** boundary cast จุดเดียว (เหมือน `fakeAnthropic.ts`): `TOOL_REGISTRY` เป็น array ของ
 * `ToolDefinition<TInput,TOutput>` ที่ TInput/TOutput ต่างกันต่อ tool — ที่นี่ต้องการแค่ mutate `run`
 * แบบ generic ข้าม tool เท่านั้น (ไม่ใช้ TInput/TOutput เฉพาะเจาะจง) runtime shape ตรงกับ
 * `GenericToolLike` เสมอไม่ว่า tool ไหน */
interface GenericToolLike {
  name: string;
  run: (rawInput: unknown, ctx: unknown) => Promise<{ isError: boolean; content: string; output?: unknown }>;
}

let installed = false;
let seqCounter = 0;
const captured: CapturedToolCall[] = [];

/** เรียกครั้งเดียวต่อ page/process (idempotent) — ต้องเรียกก่อน `runAgentTurn`/`tool.run` ครั้งแรก */
export function installToolCapture(): void {
  if (installed) {
    return;
  }
  installed = true;
  const registry = TOOL_REGISTRY as unknown as GenericToolLike[];
  for (const tool of registry) {
    const originalRun = tool.run.bind(tool);
    tool.run = async (rawInput, ctx) => {
      const result = await originalRun(rawInput, ctx);
      seqCounter += 1;
      captured.push(
        result.isError
          ? { seq: seqCounter, name: tool.name, input: rawInput, isError: true, errorContent: result.content }
          : { seq: seqCounter, name: tool.name, input: rawInput, isError: false, output: result.output },
      );
      return result;
    };
  }
}

/** ล้าง log (ไม่ถอดการห่อ — เรียกทุกครั้งก่อนเริ่ม case/test ใหม่) */
export function resetToolCapture(): void {
  captured.length = 0;
}

export function getCapturedToolCalls(): readonly CapturedToolCall[] {
  return captured;
}

/** ผลลัพธ์ล่าสุดที่ "สำเร็จ" ของ tool ชื่อนี้ — ใช้โดย dry-run script ที่ต้องอ่านผลของรอบก่อนหน้า */
export function getLastCapturedOutputByName(name: string): unknown {
  for (let i = captured.length - 1; i >= 0; i -= 1) {
    const rec = captured[i];
    if (rec?.name === name && !rec.isError) {
      return rec.output;
    }
  }
  return undefined;
}

/** ใช้เฉพาะเทสต์ (เทียบกับ fixture builder ของ `fakeAnthropic.ts` เช่น `makeMessage`) — จำลองว่ามี
 * tool call สำเร็จเกิดขึ้นแล้ว โดยไม่ต้องเรียก `installToolCapture()`/รัน tool จริง เหมาะกับเทสต์ของ
 * โค้ดที่ "อ่าน" ผล capture (เช่น `dryRunScript.ts`) แบบแยกจากเทสต์ของกลไก capture เอง */
export function recordSuccessForTest(name: string, input: unknown, output: unknown): void {
  seqCounter += 1;
  captured.push({ seq: seqCounter, name, input, isError: false, output });
}
