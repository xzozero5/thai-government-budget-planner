/**
 * T-302 — แปลง Zod schema (input ของแต่ละ tool) → JSON Schema สำหรับ `Anthropic.Tool.input_schema`
 *
 * ใช้ `z.toJSONSchema` ที่ bundle มากับ zod v4 เอง (`web/node_modules/zod/v4/core/to-json-schema.*`)
 * — ไม่ติดตั้ง dependency เพิ่ม (ขอบเขตงานห้ามแตะ `package.json`) วิธีตรวจว่า `additionalProperties`
 * จะเป็น `false` อัตโนมัติ: `zod/src/v4/core/json-schema-processors.ts` → `objectProcessor` เขียน
 * `json.additionalProperties = false` ทุกครั้งที่ `io === "output"` (ค่า default ของ `toJSONSchema`)
 * และ object ไม่มี `catchall` — ตรงกับ `z.object()` ธรรมดาที่ทุก schema ในโปรเจกต์นี้ใช้ (ไม่มี schema
 * ไหนเป็น `.passthrough()`/`.catchall()`) จึงไม่ต้องเรียก `z.strictObject()` เอง
 *
 * T-308 (prompt-tuning รอบ 1) — ย่อขนาด JSON Schema ที่ "ส่งให้ API" เท่านั้น (การ validate จริงของเรา
 * ยังใช้ Zod schema ตรง ๆ ผ่าน `spec.inputSchema.safeParse` ใน `toolKit.ts#createTool` เสมอ ไม่เกี่ยวกับ
 * ฟังก์ชันนี้ — เพดาน/กติกาตรวจข้อมูลจึงไม่ได้ถูกลดลงเลย):
 * 1. ตัด `$schema` (meta URL ของ JSON Schema เอง) — API ไม่ต้องใช้
 * 2. ตัด `minimum`/`maximum` ของ `z.number().int()` ที่ไม่ได้ระบุขอบเขตเอง (zod ใส่ default เป็น
 *    ช่วง safe-integer เต็ม `±9007199254740991` เสมอ) ออก เพราะไม่ได้ให้ข้อมูลที่มีประโยชน์ต่อโมเดล
 *    (แทบทุกฟิลด์ปี/หน้า/จำนวนเต็มในโปรเจกต์นี้ไม่ได้ตั้ง `.min()/.max()` เอง จึงเกิดคู่ตัวเลขยาว ๆ นี้
 *    ซ้ำหลายสิบครั้งทั่ว tools ทั้งหมดโดยไม่จำเป็น)
 */
import { z } from 'zod';

/** ค่า min/max default ที่ zod ใส่ให้ `z.number().int()` เมื่อไม่ได้ระบุขอบเขตเอง (safe-integer เต็มช่วง)
 * — ดู `zod/v4/core/json-schema-processors.ts` (numberProcessor: `Number.MIN_SAFE_INTEGER`/
 * `Number.MAX_SAFE_INTEGER`) */
const UNBOUNDED_INT_MIN = Number.MIN_SAFE_INTEGER;
const UNBOUNDED_INT_MAX = Number.MAX_SAFE_INTEGER;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** เดินทั้งต้นไม้ (mutate ตรง ๆ — เรียกครั้งเดียวกับ object ที่เพิ่ง `z.toJSONSchema` สดใหม่เท่านั้น ไม่ใช่
 * schema ที่ share กับที่อื่น) ตัด `minimum`/`maximum` ที่เป็นช่วง safe-integer เต็มออกจากทุก node ที่
 * `type === 'integer'` ไม่ว่าจะอยู่ลึกแค่ไหน (properties/items/$defs/oneOf ฯลฯ) */
function stripUnboundedIntegerRange(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripUnboundedIntegerRange(item);
    return;
  }
  if (!isPlainRecord(node)) return;
  if (
    node['type'] === 'integer' &&
    node['minimum'] === UNBOUNDED_INT_MIN &&
    node['maximum'] === UNBOUNDED_INT_MAX
  ) {
    delete node['minimum'];
    delete node['maximum'];
  }
  for (const value of Object.values(node)) {
    stripUnboundedIntegerRange(value);
  }
}

export function zodToToolInputSchema(schema: z.ZodType): Record<string, unknown> {
  // ป้องกัน throw ถ้ามีใครเผลอใช้ type ที่แปลงไม่ได้ (bigint/date ฯลฯ) ในอนาคต — โปรเจกต์นี้ไม่ใช้
  // อยู่แล้ว แต่ปลอดภัยไว้ก่อนดีกว่าให้ tool ทั้งตัวพังตอน build tools array
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  delete json['$schema'];
  stripUnboundedIntegerRange(json);
  return json;
}
