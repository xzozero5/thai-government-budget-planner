import { createDataFacade } from '@/data';
import { describe, expect, it } from 'vitest';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { emitIllustrationTool, MAX_ILLUSTRATIONS_PER_PROPOSAL } from './emitIllustration';
import type { ToolContext } from './toolKit';

const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="10" height="10" fill="#000000" /></svg>';
const INVALID_SVG_NO_VIEWBOX = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>';
const DANGEROUS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="1" height="1" /></svg>';

function makeCtx(): { ctx: ToolContext; toolLog: ReturnType<typeof createToolLog> } {
  const toolLog = createToolLog();
  return { ctx: { data: createDataFacade(), toolLog, illustrationSink: createInMemoryIllustrationSink() }, toolLog };
}

describe('emitIllustrationTool', () => {
  it('SVG ที่ผ่านการตรวจสอบ → ok:true พร้อม illustration_id และเก็บใน IllustrationSink', async () => {
    const { ctx, toolLog } = makeCtx();
    const result = await emitIllustrationTool.run(
      { title: 'ผังถนน', caption: 'ภาพเชิงแผนผัง ไม่ใช่แบบก่อสร้างจริง', kind: 'map', svg: VALID_SVG },
      ctx,
    );
    expect(result.isError).toBe(false);
    if (!result.isError) {
      expect(result.output.ok).toBe(true);
      expect(result.output.illustration_id.length).toBeGreaterThan(0);
      expect(ctx.illustrationSink.count()).toBe(1);
    }
    expect(toolLog.illustrationCount()).toBe(1);
  });

  it('SVG ที่ไม่มี viewBox → is_error พร้อมเหตุผล', async () => {
    const { ctx } = makeCtx();
    const result = await emitIllustrationTool.run(
      { title: 't', caption: 'c', kind: 'diagram', svg: INVALID_SVG_NO_VIEWBOX },
      ctx,
    );
    expect(result.isError).toBe(true);
    if (result.isError) {
      expect(result.content).toContain('viewBox');
    }
  });

  it('SVG ที่มี <script> ถูก sanitize (ไม่ error) แต่ยังแสดงส่วนที่ปลอดภัยได้', async () => {
    const { ctx } = makeCtx();
    const result = await emitIllustrationTool.run(
      { title: 't', caption: 'c', kind: 'diagram', svg: DANGEROUS_SVG },
      ctx,
    );
    expect(result.isError).toBe(false);
    if (!result.isError) {
      const stored = ctx.illustrationSink.get(result.output.illustration_id);
      expect(stored?.svg).not.toContain('<script');
    }
  });

  it(`จำกัด ${String(MAX_ILLUSTRATIONS_PER_PROPOSAL)} ภาพ/session — เกินแล้ว is_error`, async () => {
    const { ctx } = makeCtx();
    for (let i = 0; i < MAX_ILLUSTRATIONS_PER_PROPOSAL; i += 1) {
      const result = await emitIllustrationTool.run(
        { title: `t${String(i)}`, caption: 'c', kind: 'diagram', svg: VALID_SVG },
        ctx,
      );
      expect(result.isError).toBe(false);
    }
    const overLimit = await emitIllustrationTool.run(
      { title: 'เกิน', caption: 'c', kind: 'diagram', svg: VALID_SVG },
      ctx,
    );
    expect(overLimit.isError).toBe(true);
    if (overLimit.isError) {
      expect(overLimit.content).toContain('3');
    }
  });

  it('input ผิด schema → is_error', async () => {
    const { ctx } = makeCtx();
    const result = await emitIllustrationTool.run({ title: '', caption: '', kind: 'unknown', svg: '' }, ctx);
    expect(result.isError).toBe(true);
  });
});
