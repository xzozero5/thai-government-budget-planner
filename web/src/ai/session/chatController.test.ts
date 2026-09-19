import { beforeEach, describe, expect, it } from 'vitest';
import { createDataFacade, type EconIndicatorSeries, type Facets } from '@/data';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import type { Proposal } from '../tools/proposal';
import {
  createFakeAnthropicClient,
  makeMessage,
  makeTextBlock,
  makeToolUseBlock,
  makeUsage,
  type ScriptedTurn,
} from '../testing/fakeAnthropic';
import { createInMemoryIllustrationSink } from '../illustrationSink';
import { createToolLog } from '../toolLog';
import { createChatController } from './chatController';

const noop = (): void => undefined;
const noRegisterAbort = (): (() => void) => noop;

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

function makeMinimalProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    version: 1,
    title: 'ทดสอบ',
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
    ...overrides,
  };
}

function proposalTurns(): ScriptedTurn[] {
  return [
    {
      kind: 'message',
      message: makeMessage({
        content: [makeToolUseBlock('call_1', 'emit_proposal', makeMinimalProposal())],
        stop_reason: 'tool_use',
        usage: makeUsage({ input_tokens: 500, output_tokens: 200 }),
      }),
    },
    {
      kind: 'message',
      message: makeMessage({
        content: [makeTextBlock('เสร็จสิ้น')],
        stop_reason: 'end_turn',
        usage: makeUsage({ input_tokens: 100, output_tokens: 50 }),
      }),
    },
  ];
}

beforeEach(() => {
  useChatStore.getState().reset();
  useProposalStore.getState().reset();
  useToolLogStore.getState().reset();
});

describe('createChatController — sendMessage', () => {
  it('เพิ่มข้อความ user + assistant, จบด้วย status=done, และ push เวอร์ชัน proposal เมื่อ AI emit_proposal', async () => {
    const fake = createFakeAnthropicClient({ turns: proposalTurns() });
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => fake.client,
      registerAbortController: noRegisterAbort,
      touchActivity: noop,
    });

    await controller.sendMessage('อยากได้ข้อเสนอ');

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', text: 'อยากได้ข้อเสนอ', status: 'done' });
    expect(messages[1]).toMatchObject({ role: 'assistant', status: 'done' });
    expect(messages[1]?.text).toContain('เสร็จสิ้น');
    expect(useChatStore.getState().isRunning).toBe(false);

    const versions = useProposalStore.getState().versions;
    expect(versions).toHaveLength(1);
    expect(versions[0]?.source).toBe('ai');
    expect(versions[0]?.proposal.title).toBe('ทดสอบ');

    expect(fake.callCount()).toBe(2);
  });

  it('บันทึก tool activity ของ emit_proposal ลงในข้อความ assistant', async () => {
    const fake = createFakeAnthropicClient({ turns: proposalTurns() });
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => fake.client,
      registerAbortController: noRegisterAbort,
      touchActivity: noop,
    });

    await controller.sendMessage('อยากได้ข้อเสนอ');

    const assistantMessage = useChatStore.getState().messages[1];
    expect(assistantMessage?.toolActivities).toEqual([
      expect.objectContaining({ id: 'call_1', name: 'emit_proposal', status: 'done' }),
    ]);
  });

  it('ไม่มี client (key ถูกล้าง/ยังไม่ตั้ง) → เพิ่มข้อความ error โดยไม่เรียก stream เลย', async () => {
    const fake = createFakeAnthropicClient({ turns: proposalTurns() });
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => null,
      registerAbortController: noRegisterAbort,
      touchActivity: noop,
    });

    await controller.sendMessage('ข้อความ');

    expect(fake.callCount()).toBe(0);
    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('error');
    expect(messages[0]?.warnings[0]).toContain('API key');
  });

  it('requestReview ส่งข้อความที่พูดถึงบรรทัด BOQ ที่ระบุ', async () => {
    const fake = createFakeAnthropicClient({
      turns: [
        {
          kind: 'message',
          message: makeMessage({ content: [makeTextBlock('รับทราบ')], stop_reason: 'end_turn' }),
        },
      ],
    });
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => fake.client,
      registerAbortController: noRegisterAbort,
      touchActivity: noop,
    });

    await controller.requestReview('line1');

    const userMessage = useChatStore.getState().messages[0];
    expect(userMessage?.text).toContain('line1');
    expect(userMessage?.text).toContain('ทบทวน');
  });

  it('cancel() ก่อนที่จะเรียก AI จริง → จบด้วย status=cancelled โดยไม่ยิง request', async () => {
    const fake = createFakeAnthropicClient({ turns: proposalTurns() });
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => fake.client,
      registerAbortController: noRegisterAbort,
      touchActivity: noop,
    });

    const promise = controller.sendMessage('ยกเลิกทันที');
    controller.cancel();
    await promise;

    const assistantMessage = useChatStore.getState().messages[1];
    expect(assistantMessage?.status).toBe('cancelled');
    expect(useChatStore.getState().isRunning).toBe(false);
  });

  it('เรียกซ้อนขณะกำลังทำงานอยู่ → เพิกเฉย (ไม่เพิ่มข้อความซ้ำ)', async () => {
    const fake = createFakeAnthropicClient({ turns: proposalTurns() });
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => fake.client,
      registerAbortController: noRegisterAbort,
      touchActivity: noop,
    });

    const first = controller.sendMessage('ข้อความแรก');
    await controller.sendMessage('ข้อความซ้อน');
    await first;

    const userMessages = useChatStore.getState().messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.text).toBe('ข้อความแรก');
  });
});

describe('createChatController — ToolLog/IllustrationSink getter + toolLogStore', () => {
  it('getToolLog/getIllustrationSink คืน instance เดียวกันตลอดอายุ controller', () => {
    const toolLog = createToolLog();
    const illustrationSink = createInMemoryIllustrationSink();
    const controller = createChatController({ toolLog, illustrationSink });

    expect(controller.getToolLog()).toBe(toolLog);
    expect(controller.getIllustrationSink()).toBe(illustrationSink);
    expect(useToolLogStore.getState().toolLog).toBe(toolLog);
  });

  it('reset() สร้าง ToolLog/IllustrationSink ใหม่และล้าง chatStore/proposalStore', async () => {
    const fake = createFakeAnthropicClient({ turns: proposalTurns() });
    const controller = createChatController({
      dataFacade: stubDataFacade(),
      getClient: () => fake.client,
      registerAbortController: noRegisterAbort,
      touchActivity: noop,
    });
    await controller.sendMessage('ข้อความ');
    const oldToolLog = controller.getToolLog();
    expect(useChatStore.getState().messages.length).toBeGreaterThan(0);
    expect(useProposalStore.getState().versions.length).toBeGreaterThan(0);

    controller.reset();

    expect(controller.getToolLog()).not.toBe(oldToolLog);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useProposalStore.getState().versions).toEqual([]);
  });
});
