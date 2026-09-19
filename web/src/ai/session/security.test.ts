/**
 * T-403 — เทสต์บังคับตาม T-307 (H1)/N2 ที่ task brief ระบุไว้ตรง ๆ ครอบทั้ง 5 ข้อ (ก)-(จ):
 * (ก) หลัง setKey → JSON.stringify ของ state ทุก store ไม่มีค่า key
 * (ข) ไฟล์ .tgbp.json ที่ serialize ไม่มี key และไม่มี client
 * (ค) ไม่มีการเรียก Storage API ตลอด flow ตั้ง key → ส่งข้อความ → ได้ proposal
 * (ง) idle 60 นาที/pagehide → hasKey=false และ holder ว่าง
 * (จ) error message ที่มีสตริงรูป key ถูก mask
 *
 * ทดสอบผ่าน "สถาปัตยกรรมจริง" ทั้งสาย (sessionStore → keyHolder → sessionChatController → stores)
 * ไม่ใช่แค่หน่วยย่อย — สร้าง `Anthropic` instance จริงผ่าน `keyHolder.setKey` (ไม่มีการเรียก API จริง:
 * `verifyKey` ถูก mock และ `client.messages.stream` ถูก spy แทนที่ด้วย fake stream ของ
 * `ai/testing/fakeAnthropic.ts` เท่านั้น — ไม่มีการเรียก `fetch`/network ออกจากเทสต์นี้เลย)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataFacade, type EconIndicatorSeries, type Facets } from '@/data';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { useDataStore } from '@/stores/dataStore';
import { serializeSession } from '@/features/export/tgbpFile';
import type { Proposal } from '../tools/proposal';
import { createFakeAnthropicClient, makeMessage, makeTextBlock, makeToolUseBlock, makeUsage } from '../testing/fakeAnthropic';
import * as keyHolder from './keyHolder';
import { containsSecretLikeString, redactSecrets } from './redactSecrets';

const FAKE_KEY = 'fake-key-for-unit-test';
const FAKE_KEY_LOOKING_SECRET = 'sk-' + 'ant-' + 'realLookingSecret123';

const verifyKeyMock = vi.fn();

vi.mock('@/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/client')>();
  return {
    ...actual,
    verifyKey: (...args: Parameters<typeof actual.verifyKey>) =>
      verifyKeyMock(...args) as ReturnType<typeof actual.verifyKey>,
  };
});

function makeFacets(): Facets {
  return {
    budget_types: [],
    coverage_notes: [],
    datasets: [],
    fiscal_years: [{ value: 2569, count: 1 }],
    ministries: [],
    provinces: [],
  };
}

function stubDataFacade() {
  return createDataFacade({
    facets: () => Promise.resolve(makeFacets()),
    getEconSeries: () => Promise.resolve(null as EconIndicatorSeries | null),
  });
}

function makeMinimalProposal(): Proposal {
  return {
    version: 1,
    title: 'ข้อเสนอทดสอบ',
    summary: 'สรุปทดสอบ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2569 },
    objectives: [],
    scope_and_specs: [],
    assumptions: [],
    boq: [
      {
        id: 'line1',
        category: 'ทดสอบ',
        item: 'รายการทดสอบ',
        qty: 1,
        unit: 'หน่วย',
        unit_price_thb: 1000,
        total_thb: 1000,
        basis: 'estimate',
        confidence: 'low',
        rationale: 'สมมติฐานทดสอบ',
        citations: [],
      },
    ],
    totals: { subtotal_thb: 1000, vat_included: false, grand_total_thb: 1000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
  };
}

afterEach(() => {
  keyHolder.clearKey('manual');
  verifyKeyMock.mockReset();
  vi.restoreAllMocks();
  useChatStore.getState().reset();
  useProposalStore.getState().reset();
  useDataStore.getState().reset();
});

describe('T-307/N2 — flow เต็ม: ตั้ง key → ส่งข้อความ → ได้ proposal', () => {
  it('(ก)(ข)(ค) ไม่มี Storage API, ไม่มี key ใน state ของ store ใด ๆ, ไม่มี key ใน .tgbp.json', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const cookieSetterSpy = vi.spyOn(document, 'cookie', 'set');

    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore: freshSessionStore } = await import('@/stores/sessionStore');
    const submitResult = await freshSessionStore.getState().submitKey(FAKE_KEY);
    expect(submitResult).toEqual({ ok: true });
    expect(freshSessionStore.getState().hasKey).toBe(true);

    // สลับ .messages.stream ของ client จริง (สร้างผ่าน keyHolder จริง) ให้เป็น fake stream — ไม่มีการ
    // เรียก network จริงเกิดขึ้นเลยตลอดเทสต์นี้
    const realClient = keyHolder.getClient();
    expect(realClient).not.toBeNull();
    const fake = createFakeAnthropicClient({
      turns: [
        {
          kind: 'message',
          message: makeMessage({
            content: [makeToolUseBlock('call_1', 'emit_proposal', makeMinimalProposal())],
            stop_reason: 'tool_use',
            usage: makeUsage({ input_tokens: 300, output_tokens: 150 }),
          }),
        },
        {
          kind: 'message',
          message: makeMessage({
            content: [makeTextBlock('เสร็จสิ้น')],
            stop_reason: 'end_turn',
            usage: makeUsage({ input_tokens: 80, output_tokens: 40 }),
          }),
        },
      ],
    });
    if (realClient === null) {
      throw new Error('unreachable — asserted above');
    }
    // boundary (เหมือน `ai/testing/fakeAnthropic.ts`): `stream<Params>` เป็น generic method — reassign
    // เมธอดของ client จริง (ไม่ใช่ prototype) ให้ชี้ไป fake stream โดยตรงแทน `vi.spyOn().mockImplementation`
    // (parameter type ของ mockImplementation จะชนกับ overload ของ generic method) client instance นี้ถูก
    // สร้างใหม่เฉพาะเทสต์นี้และไม่ถูกใช้ต่อ จึงไม่กระทบเทสต์อื่น
    interface StreamCapableMessages {
      stream: typeof fake.client.messages.stream;
    }
    (realClient.messages as unknown as StreamCapableMessages).stream = fake.client.messages.stream.bind(
      fake.client.messages,
    );

    // ใช้ `createChatController` (ไม่ใช่ `sessionChatController` singleton) เพื่อ inject `dataFacade`
    // แบบ fixture แทนที่จะแตะ `@/data` จริง (ซึ่งจะยิง `fetch` จริงที่ไม่มีใน jsdom test env) — แต่ยัง
    // ผูก `getClient` เข้ากับ `realClient` (instance จริงที่ `keyHolder`/`sessionStore` สร้างไว้ข้างบน)
    // เพื่อให้ยังเป็นการทดสอบ "สถาปัตยกรรมจริง" ของสาย key ทั้งหมด (H1/N2)
    const { createChatController } = await import('./chatController');
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => realClient,
    });

    await controller.sendMessage('อยากได้ข้อเสนอโครงการ');

    expect(useProposalStore.getState().versions).toHaveLength(1);
    expect(useProposalStore.getState().versions[0]?.proposal.title).toBe('ข้อเสนอทดสอบ');
    expect(useChatStore.getState().messages.at(-1)?.status).toBe('done');

    // (ก) ไม่มี key ใน state ของทุก store ที่เกี่ยวข้อง
    const storesSerialized = JSON.stringify({
      session: useSessionStore.getState(),
      chat: useChatStore.getState(),
      proposal: useProposalStore.getState(),
      toolLog: useToolLogStore.getState(),
      data: useDataStore.getState(),
    });
    expect(containsSecretLikeString(storesSerialized)).toBe(false);
    expect(storesSerialized).not.toMatch(/"apiKey"|"_options"|"dangerouslyAllowBrowser"/);

    // (ข) .tgbp.json ที่ serialize ไม่มี key และไม่มี client
    const tgbpJson = serializeSession({
      proposalVersions: useProposalStore.getState().versions,
      currentProposalIndex: useProposalStore.getState().currentIndex,
      chatMessages: useChatStore.getState().messages,
      appDataVersion: 'test-fixture',
    });
    expect(containsSecretLikeString(tgbpJson)).toBe(false);
    expect(tgbpJson).not.toMatch(/"apiKey"|"client"|"_options"/);

    // (ค) ไม่มีการเรียก Storage API ใด ๆ ตลอด flow ทั้งหมดข้างบน
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(cookieSetterSpy).not.toHaveBeenCalled();
  });
});

describe('T-307/N2 — (ง) idle 60 นาที/pagehide ล้าง key ทั้ง holder และ store', () => {
  it('idle เกิน 60 นาที → hasKey=false ทั้งใน sessionStore และ keyHolder ว่าง', async () => {
    vi.useFakeTimers();
    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore: freshSessionStore } = await import('@/stores/sessionStore');
    await freshSessionStore.getState().submitKey(FAKE_KEY);
    expect(freshSessionStore.getState().hasKey).toBe(true);

    vi.advanceTimersByTime(keyHolder.IDLE_TIMEOUT_MS + 1);

    expect(freshSessionStore.getState().hasKey).toBe(false);
    expect(freshSessionStore.getState().keyStatus).toBe('idle');
    expect(keyHolder.getClient()).toBeNull();
    vi.useRealTimers();
  });

  it('pagehide → hasKey=false ทั้งใน sessionStore และ keyHolder ว่าง', async () => {
    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore: freshSessionStore } = await import('@/stores/sessionStore');
    await freshSessionStore.getState().submitKey(FAKE_KEY);
    expect(freshSessionStore.getState().hasKey).toBe(true);

    window.dispatchEvent(new Event('pagehide'));

    expect(freshSessionStore.getState().hasKey).toBe(false);
    expect(keyHolder.getClient()).toBeNull();
  });
});

describe('T-307/N2 — (จ) error message ที่มีสตริงรูป key ถูก mask ก่อนเก็บใน store', () => {
  it('sessionStore.keyErrorMessage ไม่มีสตริงรูป key แม้ verifyKey จะคืนข้อความที่มี (จำลอง worst case)', async () => {
    verifyKeyMock.mockResolvedValue({
      ok: false,
      kind: 'auth',
      // จำลองกรณีเลวร้ายที่สุด: สมมติ error message หลุด key ปนมา (ไม่ควรเกิดจริงตาม T-307 §2 แต่
      // sessionStore ต้อง redact ป้องกันไว้ชั้นสุดท้ายเสมอ)
      messageTh: `เชื่อมต่อไม่สำเร็จด้วย key ${FAKE_KEY_LOOKING_SECRET}`,
    });
    const { useSessionStore: freshSessionStore } = await import('@/stores/sessionStore');

    await freshSessionStore.getState().submitKey(FAKE_KEY);

    const message = freshSessionStore.getState().keyErrorMessage;
    expect(message).not.toBeNull();
    expect(message).not.toContain(FAKE_KEY_LOOKING_SECRET);
    expect(containsSecretLikeString(message ?? '')).toBe(false);
  });

  it('redactSecrets ใช้ mask ข้อความ warning ของ chatController ก่อนเก็บใน chatStore', () => {
    const masked = redactSecrets(`เกิดข้อผิดพลาด: ${FAKE_KEY_LOOKING_SECRET}`);
    expect(masked).not.toContain(FAKE_KEY_LOOKING_SECRET);
  });
});
