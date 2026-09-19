/**
 * T-309 — `emit_illustration`: sanitize SVG ที่ AI สร้าง แล้วเก็บใน `IllustrationSink` (N9)
 *
 * SVG ที่ไม่ผ่าน `sanitizeSvg()` (`lib/svgSanitizer.ts`) → `is_error` พร้อมเหตุผลภาษาไทย (throw แล้วให้
 * `createTool` ห่อเป็น `tool_result.content` ที่ `is_error:true` ให้เอง) จำกัด ≤ 3 ภาพ/proposal —
 * นับจาก `ToolLog.illustrationCount()` (นับรวมทั้ง session ไม่ reset ต่อ proposal เพราะยังไม่มี
 * แนวคิด "proposal ปัจจุบัน" ใน `ai/` — Phase 4/agent loop (T-304) เป็นผู้ตัดสินใจ reset ตอนเริ่ม
 * proposal ใหม่โดยเรียก `toolLog.reset()`/สร้าง ToolLog ใหม่ต่อ proposal ถ้าต้องการเพดานแยกต่อใบ)
 *
 * ห้าม import React ใน `ai/` — เรียก `sanitizeSvg` จาก `lib/svgSanitizer.ts` เป็นข้อยกเว้นเดียวที่
 * อนุญาต (ใช้ DOM API ภายในตัวมันเอง ไม่ใช่ `ai/` ที่แตะ DOM ตรง ๆ)
 */
import { z } from 'zod';
import { sanitizeSvg } from '@/lib/svgSanitizer';
import { createTool, type ToolContext } from './toolKit';

export const MAX_ILLUSTRATIONS_PER_PROPOSAL = 3;

const ILLUSTRATION_KINDS = ['map', 'cross_section', 'isometric', 'diagram'] as const;

export const EmitIllustrationInputSchema = z.object({
  title: z.string().min(1).max(120),
  caption: z.string().min(1).max(400).describe('ต้องบอกว่าเป็นภาพเชิงแผนผัง ไม่ใช่แบบก่อสร้างจริง'),
  kind: z.enum(ILLUSTRATION_KINDS),
  svg: z.string().min(1).max(200_000).describe('SVG ดิบ — viewBox บังคับ, ≤60KB, ห้าม script/style/href ภายนอก'),
});
export type EmitIllustrationInput = z.infer<typeof EmitIllustrationInputSchema>;

export const EmitIllustrationOutputSchema = z.object({
  ok: z.literal(true),
  illustration_id: z.string(),
  warnings: z.array(z.string()),
});
export type EmitIllustrationOutput = z.infer<typeof EmitIllustrationOutputSchema>;

function generateIllustrationId(): string {
  return `illus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ไม่มี await จริง ๆ (sanitizeSvg เป็น sync) — ไม่ใช้ `async` เพื่อไม่ให้ eslint
// (`@typescript-eslint/require-await`) เตือน แต่ `createTool` ต้องการ handler ที่คืน Promise
function handler(input: EmitIllustrationInput, ctx: ToolContext): Promise<EmitIllustrationOutput> {
  if (ctx.toolLog.illustrationCount() >= MAX_ILLUSTRATIONS_PER_PROPOSAL) {
    throw new Error(
      `สร้างภาพประกอบครบ ${String(MAX_ILLUSTRATIONS_PER_PROPOSAL)} ภาพแล้วในบทสนทนานี้ ` +
        'ไม่สามารถสร้างเพิ่มได้ (T-309: จำกัด ≤ 3 ภาพต่อ proposal)',
    );
  }

  const sanitized = sanitizeSvg(input.svg);
  if (!sanitized.ok) {
    throw new Error(`SVG ไม่ผ่านการตรวจสอบความปลอดภัย: ${sanitized.reason}`);
  }

  const illustrationId = generateIllustrationId();
  ctx.toolLog.recordIllustrationId(illustrationId);
  ctx.illustrationSink.add({
    illustrationId,
    title: input.title,
    caption: input.caption,
    kind: input.kind,
    svg: sanitized.svg,
    warnings: sanitized.warnings,
  });

  return Promise.resolve({ ok: true, illustration_id: illustrationId, warnings: sanitized.warnings });
}

export const emitIllustrationTool = createTool({
  name: 'emit_illustration',
  description:
    'ส่งภาพประกอบโครงการ (SVG) เชิงแผนผัง — ใช้เมื่อโครงการมีองค์ประกอบเชิงพื้นที่/โครงสร้าง หรือยอดรวม ' +
    '≥ 10 ล้านบาท (ครุภัณฑ์ล้วน ๆ ไม่ต้อง) สูงสุด 3 ภาพ/proposal ห้ามใส่ตัวเลขเงินในภาพ, ห้าม <style>/script/' +
    'href ภายนอก, ต้องมี viewBox, ใช้ presentation attributes (fill/stroke) แทน CSS',
  inputSchema: EmitIllustrationInputSchema,
  outputSchema: EmitIllustrationOutputSchema,
  handler,
});
