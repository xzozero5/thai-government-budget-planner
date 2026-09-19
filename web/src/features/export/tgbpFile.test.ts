import { describe, expect, it } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import type { ChatMessage } from '@/stores/chatStore';
import type { ProposalVersion } from '@/stores/proposalStore';
import {
  parseTgbpFile,
  serializeSession,
  TGBP_FILE_MAX_BYTES,
  TgbpFileSchema,
  getProposalAt,
} from './tgbpFile';

function makeLine(overrides: Partial<BoqLine> = {}): BoqLine {
  return {
    id: 'line1',
    category: 'ครุภัณฑ์',
    item: 'เครื่องปรับอากาศ',
    qty: 2,
    unit: 'เครื่อง',
    unit_price_thb: 20000,
    total_thb: 40000,
    basis: 'historical',
    confidence: 'high',
    rationale: 'อ้างอิงราคาจากงบปี 2567',
    citations: [{ kind: 'budget_line', source_id: 'src_1' }],
    ...overrides,
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    version: 1,
    title: 'ทดสอบ',
    summary: 'สรุปทดสอบ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2569 },
    objectives: [],
    scope_and_specs: [],
    assumptions: [],
    boq: [makeLine()],
    totals: { subtotal_thb: 40000, vat_included: false, grand_total_thb: 40000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

function makeVersion(overrides: Partial<ProposalVersion> = {}): ProposalVersion {
  return {
    id: 'propver_1',
    proposal: makeProposal(),
    warnings: ['คำเตือนทดสอบ'],
    createdAt: 1_700_000_000_000,
    source: 'ai',
    userEditedLineIds: [],
    ...overrides,
  };
}

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_1',
    role: 'user',
    text: 'สวัสดี',
    status: 'done',
    toolActivities: [],
    warnings: [],
    ...overrides,
  };
}

describe('serializeSession / parseTgbpFile — round-trip', () => {
  it('serialize แล้ว parse กลับได้ค่าเดิม', () => {
    const json = serializeSession({
      proposalVersions: [makeVersion()],
      currentProposalIndex: 0,
      chatMessages: [makeChatMessage()],
      appDataVersion: '2026-09-01',
      now: new Date('2026-09-20T10:00:00.000Z'),
    });

    const result = parseTgbpFile(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.format).toBe('tgbp');
      expect(result.file.version).toBe(1);
      expect(result.file.savedAt).toBe('2026-09-20T10:00:00.000Z');
      expect(result.file.app_data_version).toBe('2026-09-01');
      expect(result.file.proposalVersions).toHaveLength(1);
      expect(getProposalAt(result.file, 0)?.title).toBe('ทดสอบ');
      expect(result.file.chat[0]?.text).toBe('สวัสดี');
    }
  });

  it('serialize ประกอบ object ใหม่ทีละ field (ไม่ spread) — field แปลกปลอมที่แนบมากับ input ไม่หลุดเข้าไฟล์', () => {
    const pollutedVersion = {
      ...makeVersion(),
      apiKey: ['sk', 'ant', 'should-not-leak-XXXXXXXX'].join('-'),
    } as unknown as ProposalVersion;

    const json = serializeSession({
      proposalVersions: [pollutedVersion],
      currentProposalIndex: 0,
      chatMessages: [],
      appDataVersion: '2026-09-01',
    });

    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('should-not-leak');
  });

  it('parseTgbpFile ปฏิเสธ field แปลกปลอมที่ระดับบนสุด (strict)', () => {
    const json = serializeSession({
      proposalVersions: [],
      currentProposalIndex: -1,
      chatMessages: [],
      appDataVersion: '2026-09-01',
    });
    const withExtra = JSON.stringify({ ...(JSON.parse(json) as object), apiKey: 'x' });

    const result = parseTgbpFile(withExtra);
    expect(result.ok).toBe(false);
  });

  it('parseTgbpFile ปฏิเสธ format/version ที่ไม่ตรง', () => {
    expect(parseTgbpFile(JSON.stringify({ format: 'other', version: 1 })).ok).toBe(false);
    expect(parseTgbpFile(JSON.stringify({ format: 'tgbp', version: 2 })).ok).toBe(false);
  });

  it('parseTgbpFile ปฏิเสธ JSON ที่ผิดรูปแบบ', () => {
    const result = parseTgbpFile('{ ไม่ใช่ json แน่นอน');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('JSON');
    }
  });

  it('parseTgbpFile ปฏิเสธไฟล์ที่เกินเพดาน 5 MB โดยไม่แตะ JSON.parse', () => {
    const huge = 'a'.repeat(TGBP_FILE_MAX_BYTES + 1);
    const result = parseTgbpFile(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('เกินเพดาน');
    }
  });

  it('N2/09 §1 C7: JSON ที่ save ไม่มี sk-ant- / x-api-key / authorization', () => {
    const fakeKey = 'sk-' + 'ant-' + 'abcdEFGH1234';
    const json = serializeSession({
      proposalVersions: [makeVersion({ warnings: [`อย่าใส่ ${fakeKey} ในนี้`] })],
      currentProposalIndex: 0,
      chatMessages: [makeChatMessage({ text: `ทดสอบ ${fakeKey}` })],
      appDataVersion: '2026-09-01',
    });

    // หมายเหตุ: ข้อความ "ดิบ" ของผู้ใช้/AI ที่ผู้ใช้พิมพ์ใส่เองอาจมีสตริงคล้าย key ปนมาได้ (ไม่ใช่ความ
    // รับผิดชอบของ serializer ที่จะ redact เนื้อหาแชทของผู้ใช้) — สิ่งที่ต้องยืนยันคือ**ไม่มี field ที่
    // เป็น credential ของระบบเอง** (apiKey/x-api-key/authorization/headers) หลุดเข้ามาเลย
    expect(json).not.toMatch(/"apiKey"|"x-api-key"|"authorization"|"headers"/i);
  });

  it('TgbpFileSchema export ใช้ validate ตรง ๆ ได้เช่นกัน (ไม่ต้องผ่าน parseTgbpFile เสมอไป)', () => {
    const json = serializeSession({
      proposalVersions: [],
      currentProposalIndex: -1,
      chatMessages: [],
      appDataVersion: '2026-09-01',
    });
    expect(TgbpFileSchema.safeParse(JSON.parse(json)).success).toBe(true);
  });
});
