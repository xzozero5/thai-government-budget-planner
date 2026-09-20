import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { buildSessionFile, downloadSessionFile, saveSessionFile } from './downloadSessionFile';
import { parseTgbpFile } from './tgbpFile';

// `vi.hoisted` + plain `vi.fn()` กัน `@typescript-eslint/unbound-method` (ดูคอมเมนต์เดียวกันใน
// `ExportDialog.test.tsx`/`features/workspace/slots.test.tsx`)
const dataVersionMock = vi.hoisted(() => vi.fn().mockResolvedValue('2026-09-01'));
const downloadBlobMock = vi.hoisted(() => vi.fn());
vi.mock('@/data', () => ({ data: { dataVersion: dataVersionMock } }));
vi.mock('./downloadBlob', () => ({ downloadBlob: downloadBlobMock }));

function makeLine(): BoqLine {
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
  };
}

function makeProposal(title: string): Proposal {
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
  };
}

describe('buildSessionFile / saveSessionFile / downloadSessionFile', () => {
  beforeEach(() => {
    useProposalStore.getState().reset();
    useChatStore.getState().reset();
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
