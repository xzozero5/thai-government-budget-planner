/**
 * T-403 — `chatController`: ตัวเชื่อม UI ↔ `runAgentTurn` (04 §D4/§D7) — เดียวที่เรียก `ai/agent.ts`
 * ในแอปจริง (นอกจาก harness ของ eval)
 *
 * รับผิดชอบ: สร้าง `AbortController` ต่อ turn + ลงทะเบียนกับ `keyHolder` (ให้ `clearKey()` abort งาน
 * ค้างได้จริง — T-307 H1), ประกอบ system prompt จริง (`ai/session/systemPrompt.ts`), แปลง
 * `AgentEvent` → `chatStore`, สะสม `spentUsd` ของ `sessionStore` แบบ live จาก event `usage` (ไม่บวกซ้ำ
 * ตอนจบ turn — ตัวเลขสุดท้ายของ event `usage` รอบล่าสุดคือยอดสะสมที่ถูกต้องอยู่แล้ว), และ push
 * เวอร์ชันใหม่เข้า `proposalStore` เมื่อ `result.proposal` มีค่า
 *
 * `ToolLog`/`IllustrationSink` อยู่ตลอดอายุของ controller (ไม่ใช่ต่อ turn) — เข้าถึงได้จาก UI (เช่น
 * citation drawer T-407) ผ่าน `getToolLog()`/`getIllustrationSink()` หรือผ่าน `toolLogStore` ที่
 * `attach()`/`bump()` ให้อัตโนมัติ
 *
 * `createChatController` เป็น factory (รับ dependency override ได้ทั้งหมด) เพื่อให้ทดสอบได้โดยไม่ต้อง
 * เรียก Anthropic API จริง — `sessionChatController` คือ instance เดียวที่แอปจริงใช้ (ค่า default ทุก
 * dependency ผูกกับ `keyHolder`/`@/data`/store จริง)
 */
import type Anthropic from '@anthropic-ai/sdk';
import { data as defaultDataFacade, type DataFacade } from '@/data';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { runAgentTurn, type AgentEvent } from '../agent';
import { createInMemoryIllustrationSink, type IllustrationSink } from '../illustrationSink';
import { createToolLog, type ToolLog } from '../toolLog';
import { generateNonce } from '../tools/toolKit';
import { hasCrossedBudgetWarningThreshold } from './budgetWarning';
import * as keyHolder from './keyHolder';
import { redactSecrets } from './redactSecrets';
import { buildProductionSystemBlocks } from './systemPrompt';
import { sanitizeInjectedText } from './userMessageParts';

export interface ChatControllerDeps {
  dataFacade?: DataFacade;
  toolLog?: ToolLog;
  illustrationSink?: IllustrationSink;
  nonce?: string;
  /** ค่าเริ่มต้น `keyHolder.getClient` — override ได้ในเทสต์เพื่อฉีด fake client */
  getClient?: () => Anthropic | null;
  registerAbortController?: (ac: AbortController) => () => void;
  touchActivity?: () => void;
}

export interface ChatController {
  sendMessage: (text: string) => Promise<void>;
  cancel: () => void;
  /** US-3.2: "ให้ AI ทบทวนจากที่แก้" — `boqLineId` ถ้าระบุจะพูดถึงบรรทัดนั้นเจาะจง */
  requestReview: (boqLineId?: string) => Promise<void>;
  getToolLog: () => ToolLog;
  getIllustrationSink: () => IllustrationSink;
  isRunning: () => boolean;
  /** เริ่ม session ใหม่ทั้งหมด (ล้างประวัติ API/ToolLog/illustrationSink/chatStore/proposalStore) —
   * ยกเลิกงานที่ค้างก่อนเสมอ */
  reset: () => void;
}

// T-602 (NEW-M4) — `boqLineId` มาจาก `BoqLine.id` ซึ่งเป็นสตริงที่โมเดลกำหนดเอง (schema อนุญาตถึง 200
// ตัวอักษร ไม่ได้บังคับรูปแบบ) ต้องผ่าน `sanitizeInjectedText` ก่อนฉีดกลับเข้าข้อความ user role เสมอ
// (กันคำสั่งแฝงข้ามบรรทัด/backtick/วงเล็บมุมที่ปนมากับ id)
function buildReviewPrompt(boqLineId: string | undefined): string {
  if (boqLineId !== undefined) {
    return `ผู้ใช้แก้ไขบรรทัด BOQ (id=${sanitizeInjectedText(boqLineId)}) ในตารางด้วยตนเองแล้ว กรุณาทบทวนข้อเสนอทั้งฉบับอีกครั้งโดยเฉพาะบรรทัดนี้ และปรับ rationale/สมมติฐานที่เกี่ยวข้องให้สอดคล้องกัน`;
  }
  return 'ผู้ใช้แก้ไขตาราง BOQ ด้วยตนเองแล้ว กรุณาทบทวนข้อเสนอทั้งฉบับอีกครั้งให้สอดคล้องกับค่าที่แก้';
}

function describeUnexpectedError(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return redactSecrets(`เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุระหว่างเรียก AI: ${detail}`);
}

export function createChatController(deps: ChatControllerDeps = {}): ChatController {
  const dataFacade = deps.dataFacade ?? defaultDataFacade;
  let toolLog = deps.toolLog ?? createToolLog();
  let illustrationSink = deps.illustrationSink ?? createInMemoryIllustrationSink();
  let nonce = deps.nonce ?? generateNonce();
  const getClient = deps.getClient ?? keyHolder.getClient;
  const registerAbort = deps.registerAbortController ?? keyHolder.registerAbortController;
  const touch = deps.touchActivity ?? keyHolder.touchActivity;

  useToolLogStore.getState().attach(toolLog, illustrationSink);

  let apiHistory: Anthropic.MessageParam[] = [];
  let currentAbortController: AbortController | null = null;
  let webSearchSeq = 0;

  function handleAgentEvent(event: AgentEvent, assistantId: string): void {
    switch (event.type) {
      case 'text_delta':
        useChatStore.getState().appendText(assistantId, event.text);
        break;
      case 'tool_start':
        useChatStore.getState().upsertToolActivity(assistantId, {
          id: event.id,
          name: event.name,
          status: 'running',
        });
        useToolLogStore.getState().bump();
        break;
      case 'tool_result':
        useChatStore.getState().upsertToolActivity(assistantId, {
          id: event.id,
          name: event.name,
          status: event.isError ? 'error' : 'done',
          inputSummary: event.summaryTh,
          // T-410 ข้อ 3 (US-2.2): field มีโครงสร้างเสริมจาก event เดิม — UI mapping เข้า chat.tool.*
          // ทำภายหลังโดย main thread (ยังใช้ inputSummary/summaryTh เดิมได้อยู่)
          summary: event.summary,
        });
        useToolLogStore.getState().bump();
        break;
      case 'server_tool': {
        webSearchSeq += 1;
        useChatStore.getState().upsertToolActivity(assistantId, {
          id: `web_search_${String(webSearchSeq)}`,
          name: 'web_search',
          status: 'done',
          ...(event.query !== undefined ? { inputSummary: event.query } : {}),
        });
        useToolLogStore.getState().bump();
        break;
      }
      case 'usage': {
        useSessionStore.getState().setSpentUsd(event.totalSpentUsd);
        // US-1.1 (T-410 ข้อ 2): ตั้ง flag/timestamp ใน sessionStore ครั้งแรกที่ข้าม 80% ของเพดาน session
        // — toast จริงแสดงโดย UI (features/workspace) ที่ subscribe `budgetWarningAt`
        const { maxCostUsdPerSession } = useSessionStore.getState();
        if (hasCrossedBudgetWarningThreshold(event.totalSpentUsd, maxCostUsdPerSession)) {
          useSessionStore.getState().markBudgetWarningShown();
        }
        break;
      }
      case 'warning':
        useChatStore.getState().addWarning(assistantId, redactSecrets(event.messageTh));
        break;
      case 'round':
      case 'tool_input_progress':
        break;
    }
  }

  async function runTurn(userText: string): Promise<void> {
    if (currentAbortController !== null) {
      // มีงานกำลังทำอยู่แล้ว — ผู้เรียก (UI) ควร disable ปุ่มส่งระหว่างนี้อยู่แล้ว ที่นี่แค่กันพังเงียบ ๆ
      return;
    }
    const client = getClient();
    if (client === null) {
      const errorId = useChatStore.getState().addMessage({ role: 'assistant', status: 'error' });
      useChatStore
        .getState()
        .addWarning(errorId, 'ยังไม่ได้ตั้งค่า API key หรือ key ถูกล้างไปแล้ว กรุณาใส่ key ใหม่ก่อนส่งข้อความ');
      return;
    }

    touch();
    useChatStore.getState().addMessage({ role: 'user', text: userText, status: 'done' });
    apiHistory = [...apiHistory, { role: 'user', content: userText }];
    const assistantId = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    useChatStore.getState().setIsRunning(true);

    const abortController = new AbortController();
    currentAbortController = abortController;
    const unregister = registerAbort(abortController);
    webSearchSeq = 0;

    try {
      const session = useSessionStore.getState();
      const system = await buildProductionSystemBlocks(session.mode, { dataFacade });
      const result = await runAgentTurn({
        client,
        model: session.model,
        effort: session.effort,
        mode: session.mode,
        system,
        messages: apiHistory,
        toolContext: { data: dataFacade, toolLog, illustrationSink, nonce },
        signal: abortController.signal,
        budget: {
          maxCostUsdPerTurn: session.maxCostUsdPerTurn,
          maxCostUsdPerSession: session.maxCostUsdPerSession,
          spentUsdSoFar: session.spentUsd,
        },
        enableWebSearch: session.enableWebSearch,
        onEvent: (event) => {
          handleAgentEvent(event, assistantId);
        },
      });

      apiHistory = result.messages;
      if (result.proposal !== undefined) {
        useProposalStore.getState().pushVersion(result.proposal.proposal, result.proposal.warnings, 'ai');
      }
      const finalStatus =
        result.endedBecause === 'cancelled' ? 'cancelled' : result.endedBecause === 'error' ? 'error' : 'done';
      useChatStore.getState().updateMessageStatus(assistantId, finalStatus);
    } catch (err) {
      useChatStore.getState().addWarning(assistantId, describeUnexpectedError(err));
      useChatStore.getState().updateMessageStatus(assistantId, 'error');
    } finally {
      unregister();
      currentAbortController = null;
      useChatStore.getState().setIsRunning(false);
    }
  }

  return {
    sendMessage: (text) => runTurn(text),
    cancel: () => {
      currentAbortController?.abort();
    },
    requestReview: (boqLineId) => runTurn(buildReviewPrompt(boqLineId)),
    getToolLog: () => toolLog,
    getIllustrationSink: () => illustrationSink,
    isRunning: () => currentAbortController !== null,
    reset: () => {
      currentAbortController?.abort();
      currentAbortController = null;
      apiHistory = [];
      webSearchSeq = 0;
      toolLog = createToolLog();
      illustrationSink = createInMemoryIllustrationSink();
      nonce = deps.nonce ?? generateNonce();
      useToolLogStore.getState().attach(toolLog, illustrationSink);
      useChatStore.getState().reset();
      useProposalStore.getState().reset();
    },
  };
}

/** instance เดียวที่แอปจริงใช้ (ทุก dependency ผูกกับ `keyHolder`/`@/data`/store จริง) */
export const sessionChatController = createChatController();
