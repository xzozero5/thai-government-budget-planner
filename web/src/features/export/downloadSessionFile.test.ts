import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '@/ai/illustrationSink';
import { createToolLog } from '@/ai/toolLog';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { buildSessionFile, downloadSessionFile, saveSessionFile } from './downloadSessionFile';
import { parseTgbpFile } from './tgbpFile';

// `vi.hoisted` + plain `vi.fn()` กัน `@typescript-eslint/unbound-method` (ดูคอมเมนต์เดียวกันใน
// `ExportDialog.test.tsx`/`features/workspace/slots.test.tsx`)
const dataVersionMock = vi.hoisted(() => vi.fn().mockResolvedValue('2026-09-01'));
const downloadBlobMock = vi.hoisted(() => vi.fn());
vi.mock('@/data', () => ({ data: { dataVersion: dataVersionMock } }));
vi.mock('./downloadBlob', () => ({ downloadBlob: downloadBlobMock }));

function makeLine(overrides: Partial<BoqLine> = {}): BoqLine {
  return {
    id: 'line1',
    category: 'ครุภัณฑ์',
    item: 'เครื่องปรับอากาศ',
    qty: 1,
    unit: 'เครื่อง',
    unit_price_thb: 20000,
    total_thb: 20000,
    basis: 'historical',
    confidence: 'high',
    rationale: 'อ้างอิงราคาจากงบปี 2567',
    citations: [{ kind: 'budget_line', source_id: 'src_1' }],
    ...overrides,
  };
}

function makeProposal(title: string, overrides: Partial<Proposal> = {}): Proposal {
  return {
    version: 1,
    title,
    summary: 'สรุปทดสอบ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2569 },
    objectives: [],
    scope_and_specs: [],
    assumptions: [],
    boq: [makeLine()],
    totals: { subtotal_thb: 20000, vat_included: false, grand_total_thb: 20000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

describe('buildSessionFile / saveSessionFile / downloadSessionFile', () => {
  beforeEach(() => {
    useProposalStore.getState().reset();
    useChatStore.getState().reset();
    useToolLogStore.getState().reset();
    dataVersionMock.mockClear();
    dataVersionMock.mockResolvedValue('2026-09-01');
    downloadBlobMock.mockClear();
  });

  it('buildSessionFile: JSON ที่ได้ parse กลับได้ด้วย parseTgbpFile (round-trip)', async () => {
    useProposalStore.getState().pushVersion(makeProposal('โครงการทดสอบ Save'), [], 'ai');
    useChatStore.getState().addMessage({ role: 'user', text: 'สวัสดี' });

    const { fileName, json } = await buildSessionFile();

    expect(fileName).toBe('โครงการทดสอบ Save.tgbp.json');
    const result = parseTgbpFile(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.app_data_version).toBe('2026-09-01');
      expect(result.file.proposalVersions).toHaveLength(1);
      expect(result.file.chat).toHaveLength(1);
    }
  });

  it('buildSessionFile: ไม่มี key/client หลุดเข้าไฟล์แม้ session มี hasKey อยู่', async () => {
    useProposalStore.getState().pushVersion(makeProposal('โครงการ N2'), [], 'ai');
    const fakeKey = ['sk', 'ant', 'abcd1234EFGH'].join('-');

    const { json } = await buildSessionFile();
    expect(json).not.toContain(fakeKey);
    expect(json).not.toMatch(/"apiKey"|"x-api-key"|"authorization"|"headers"/i);
  });

  it('ไม่มี proposal เลย → ใช้ชื่อไฟล์สำรอง', async () => {
    const { fileName } = await buildSessionFile();
    expect(fileName).toBe('ข้อเสนอโครงการ.tgbp.json');
  });

  it('saveSessionFile: สำเร็จ → เรียก downloadBlob และคืน ok:true', async () => {
    useProposalStore.getState().pushVersion(makeProposal('โครงการ A'), [], 'ai');
    const result = await saveSessionFile();
    expect(result).toEqual({ ok: true, fileName: 'โครงการ A.tgbp.json' });
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
  });

  it('saveSessionFile: dataVersion โยน error → คืน ok:false พร้อมเหตุผล ไม่เรียก downloadBlob', async () => {
    dataVersionMock.mockRejectedValueOnce(new Error('โหลด manifest ไม่สำเร็จ'));
    const result = await saveSessionFile();
    expect(result).toEqual({ ok: false, error: 'โหลด manifest ไม่สำเร็จ' });
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it('downloadSessionFile: fire-and-forget เรียก saveSessionFile แล้วดาวน์โหลดจริง', async () => {
    useProposalStore.getState().pushVersion(makeProposal('โครงการ B'), [], 'ai');
    downloadSessionFile();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
  });
});

describe('buildSessionFile — sourceShards (แก้บั๊ก citation ที่ถูกต้องจริงแสดง "อ้างอิงไม่พบ" บน /load)', () => {
  beforeEach(() => {
    useProposalStore.getState().reset();
    useChatStore.getState().reset();
    useToolLogStore.getState().reset();
    dataVersionMock.mockClear();
    dataVersionMock.mockResolvedValue('2026-09-01');
  });

  it('ไม่มี ToolLog เลย (ไม่เคยคุยกับ AI) → sourceShards ไม่ถูกเขียนลงไฟล์', async () => {
    useProposalStore.getState().pushVersion(makeProposal('โครงการไม่มี ToolLog'), [], 'ai');
    const { json } = await buildSessionFile();
    expect(json).not.toContain('sourceShards');
  });

  it('มี ToolLog ที่เคยเห็น shard ของ source ที่ถูกอ้างจริง → sourceShards มี id นั้น', async () => {
    const toolLog = createToolLog();
    toolLog.recordSourceShard('src_1', 'budget_lines/pbo/2568/1.parquet');
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(makeProposal('โครงการมี ToolLog'), [], 'ai');

    const { json } = await buildSessionFile();
    const result = parseTgbpFile(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.sourceShards).toEqual({ src_1: 'budget_lines/pbo/2568/1.parquet' });
    }
  });

  it('เก็บเฉพาะ source ที่ถูกอ้างจริงในบทเสนอ (ไม่รวม source อื่นที่ ToolLog เคยเห็นแต่ไม่ได้ถูกอ้าง)', async () => {
    const toolLog = createToolLog();
    toolLog.recordSourceShard('src_1', 'budget_lines/pbo/2568/1.parquet');
    toolLog.recordSourceShard('src_unused', 'budget_lines/pbo/2568/9.parquet');
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(makeProposal('โครงการ'), [], 'ai');

    const { json } = await buildSessionFile();
    const result = parseTgbpFile(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.sourceShards).toEqual({ src_1: 'budget_lines/pbo/2568/1.parquet' });
    }
  });

  it('รวม source ที่ถูกอ้างจากทุกเวอร์ชัน ไม่ใช่แค่เวอร์ชันปัจจุบัน', async () => {
    const toolLog = createToolLog();
    toolLog.recordSourceShard('src_1', 'budget_lines/pbo/2568/1.parquet');
    toolLog.recordSourceShard('src_2', 'budget_lines/pbo/2566/2.parquet');
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());

    useProposalStore.getState().pushVersion(makeProposal('เวอร์ชัน 1', { boq: [makeLine()] }), [], 'ai');
    useProposalStore
      .getState()
      .pushVersion(
        makeProposal('เวอร์ชัน 2', {
          boq: [makeLine({ id: 'line2', citations: [{ kind: 'budget_line', source_id: 'src_2' }] })],
        }),
        [],
        'ai',
      );

    const { json } = await buildSessionFile();
    const result = parseTgbpFile(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.sourceShards).toEqual({
        src_1: 'budget_lines/pbo/2568/1.parquet',
        src_2: 'budget_lines/pbo/2566/2.parquet',
      });
    }
  });

  it('มี ToolLog แต่ source ที่ถูกอ้างไม่เคยถูกบันทึก shard เลย → sourceShards ว่าง (ไม่เขียนลงไฟล์)', async () => {
    const toolLog = createToolLog();
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(makeProposal('โครงการ'), [], 'ai');

    const { json } = await buildSessionFile();
    expect(json).not.toContain('sourceShards');
  });
});
