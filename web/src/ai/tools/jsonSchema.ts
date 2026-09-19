/**
 * T-302 — แปลง Zod schema (input ของแต่ละ tool) → JSON Schema สำหรับ `Anthropic.Tool.input_schema`
 *
 * ใช้ `z.toJSONSchema` ที่ bundle มากับ zod v4 เอง (`web/node_modules/zod/v4/core/to-json-schema.*`)
 * — ไม่ติดตั้ง dependency เพิ่ม (ขอบเขตงานห้ามแตะ `package.json`) วิธีตรวจว่า `additionalProperties`
 * จะเป็น `false` อัตโนมัติ: `zod/src/v4/core/json-schema-processors.ts` → `objectProcessor` เขียน
 * `json.additionalProperties = false` ทุกครั้งที่ `io === "output"` (ค่า default ของ `toJSONSchema`)
 * และ object ไม่มี `catchall` — ตรงกับ `z.object()` ธรรมดาที่ทุก schema ในโปรเจกต์นี้ใช้ (ไม่มี schema
 * ไหนเป็น `.passthrough()`/`.catchall()`) จึงไม่ต้องเรียก `z.strictObject()` เอง
 */
import { z } from 'zod';

export function zodToToolInputSchema(schema: z.ZodType): Record<string, unknown> {
  // ป้องกัน throw ถ้ามีใครเผลอใช้ type ที่แปลงไม่ได้ (bigint/date ฯลฯ) ในอนาคต — โปรเจกต์นี้ไม่ใช้
  // อยู่แล้ว แต่ปลอดภัยไว้ก่อนดีกว่าให้ tool ทั้งตัวพังตอน build tools array
  return z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' });
}
