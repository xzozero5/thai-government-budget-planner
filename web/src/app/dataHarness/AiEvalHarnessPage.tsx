/**
 * T-306 — หน้า harness สำหรับ eval (`web/tests/eval/run-eval.mjs`) เท่านั้น — เหมือน
 * `DataHarnessPage.tsx` (T-203 §4): ไม่มี UI จริง ไม่มีใน production bundle ปกติ (ตัดด้วย
 * `resolve.alias` ใน `vite.config.ts`/`DataHarnessRoute.stub.tsx` เมื่อไม่ใช่โหมด build
 * `e2e-harness`) แค่ expose ฟังก์ชันไว้ที่ `window.__evalHarness` ให้ Playwright (ผ่าน
 * `web/tests/eval/run-eval.mjs`) เรียกด้วย `page.evaluate`
 *
 * รัน `runAgentTurn` จริง (ai/agent.ts) ต่อเนื่องตาม `prompt_sequence` โดยใช้ data facade จริง
 * (`@/data`) + `buildSystemBlocks` จริง (facets/econ indicators จาก manifest/econ ของ production
 * ที่ build เข้ามาด้วย `--mode e2e-harness`) — client เป็นได้ทั้ง Anthropic จริง (`apiKey` มาจาก
 * argument ของ `page.evaluate` เท่านั้น ไม่มีการอ่าน env ใด ๆ ในไฟล์นี้ — N2) หรือ fake client
 * (`ai/testing/fakeAnthropic`) สำหรับ dry-run
 *
 * **N2/ความปลอดภัย (T-307 review)**: `apiKey`/instance ของ `Anthropic` client เก็บไว้ใน closure
 * ของ `useEffect` นี้เท่านั้น (ตัวแปร module-level ธรรมดา ไม่ผูกกับ React state/ref ที่อาจถูก
 * serialize) — ไม่เคย return ค่า client/key ออกจากฟังก์ชันใดที่ `window.__evalHarness` expose
 * (ทุกอย่างที่ `runCase` คืนเป็น `EvalRunResult`/plain data เท่านั้น ไม่มี object ของ SDK client ปนอยู่
 * เลย เพราะ `Anthropic` instance มี `apiKey` เป็น own enumerable property — H1)
 */
import { type ReactElement, useEffect, useState } from 'react';
import type Anthropic from '@anthropic-ai/sdk';
import { data } from '@/data';
import type { EconIndicatorSeries } from '@/data';
import { DEFAULT_MAX_TOOL_ROUNDS, runAgentTurn, type AgentEvent } from '@/ai/agent';
import { createClient } from '@/ai/client';
import { createInMemoryIllustrationSink } from '@/ai/illustrationSink';
import { isModelId, type EffortLevel, type ModelId } from '@/ai/models';
import { costFromUsage } from '@/ai/pricing';
import { buildSystemBlocks, type ChatMode } from '@/ai/systemPrompt';
import { createFakeAnthropicClient } from '@/ai/testing/fakeAnthropic';
import {
  getCapturedToolCalls,
  installToolCapture,
  resetToolCapture,
} from '@/ai/testing/toolCapture';
import { createToolLog } from '@/ai/toolLog';
import { toApiTools } from '@/ai/tools';
import { buildGenericDryRunScript } from './aiEvalHarness/dryRunScript';
import { matchCaptures } from './aiEvalHarness/matchCaptures';
import { summarizeToolOutput } from './aiEvalHarness/summarizeToolOutput';
import { createCountingToolLog } from './aiEvalHarness/toolLogSummary';
import type {
  EvalCaseSpec,
  EvalHarnessApi,
  EvalHarnessInitOptions,
  EvalPerRequestUsage,
  EvalRunLimits,
  EvalRunResult,
  EvalToolCallRecord,
  EvalToolLogSummary,
  EvalTurnResult,
} from './aiEvalHarness/types';

export type { EvalCaseExpected, EvalCaseSpec, EvalRunResult } from './aiEvalHarness/types';

// ---------------------------------------------------------------------------
// econ indicators ที่มีจริงใน `public/data/econ/indicators.json` ของ production (ยืนยันจริง — ดู
// รายงานปิดงาน T-306) — `buildSystemBlocks` ต้องการ "เฉพาะที่มีค่าจริง" (ดู docstring ของ
// `BuildSystemBlocksInput.econIndicators` ใน `ai/systemPrompt.ts`) จึงกรอง series ที่ทุกจุดเป็น null ทิ้ง
// ---------------------------------------------------------------------------
const KNOWN_ECON_INDICATORS = [
  'cmi_cement',
  'cmi_concrete',
  'cmi_electrical_plumbing',
  'cmi_other',
  'cmi_paint',
  'cmi_sanitary',
  'cmi_steel',
  'cmi_tiles',
  'cmi_wood',
  'construction_material_index',
  'cpi_headline_index',
  'gdp_growth_pct',
  'government_budget_total_mthb',
  'inflation_pct',
  'usd_thb_avg',
] as const;

/** สรุปข้อจำกัดของชุดข้อมูล (ADR-004/ADR-005/CLAUDE.md N4/T-114) — เนื้อหาเดียวกับที่ Phase 4 จะประกอบ
 * ให้ `buildSystemBlocks` จริงในที่สุด (ยังไม่มี wiring การผลิตข้อความชุดนี้จาก manifest อัตโนมัติ —
 * รายงานเป็นช่องว่างใน T-306) */
const DATASET_NOTES_TH: string[] = [
  'ปีงบประมาณ 2562 ของชุดข้อมูล PBO ไม่ครบทุกกระทรวง (ไฟล์ต้นทางส่งออกไม่สมบูรณ์ ~79% ของยอดรวมทั้งปี) — ดู ADR-004',
  'ข้อมูลของ อบต. ราชาเทวะ ถอดด้วยมือจากเอกสาร PDF ที่ไม่มี text layer (upstream_ocr) อาจมีตัวเลขคลาดเคลื่อนจากต้นฉบับ — ดู ADR-005',
  'PDF ที่ไม่มี text layer ระบบไม่ได้ทำ OCR จึงอ่านเนื้อหาไม่ได้ (ลงทะเบียนไว้เป็น metadata ใน sources.json เท่านั้น)',
  'search_catalog ครอบคลุมเฉพาะบางส่วนของบรรทัดงบทั้งหมด (ไม่ใช่ทุกรายการ) — รายการที่ไม่พบใน catalog ให้ลอง query_budget_lines ด้วย keyword ก่อนสรุปว่าไม่มีข้อมูล',
];

const THAI_MONTHS_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

function formatTodayBe(): string {
  const now = new Date();
  const month = THAI_MONTHS_TH[now.getMonth()];
  const yearBe = now.getFullYear() + 543;
  return `${String(now.getDate())} ${month ?? ''} ${String(yearBe)}`;
}

function isEffortLevel(value: string | undefined): value is EffortLevel {
  return (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  );
}

async function buildSystemPromptInput(mode: ChatMode): Promise<Anthropic.TextBlockParam[]> {
  const facets = await data.facets();
  const seriesList = await Promise.all(KNOWN_ECON_INDICATORS.map((k) => data.getEconSeries(k)));
  const econIndicators = seriesList.filter(
    (s): s is EconIndicatorSeries => s !== null && s.points.length > 0,
  );
  return buildSystemBlocks({
    facets,
    econIndicators,
    datasetNotes: DATASET_NOTES_TH,
    coverageNotes: [],
    mode,
    todayBe: formatTodayBe(),
  });
}

// ---------------------------------------------------------------------------
// instrumentClient — จับ usage ของทุก request จริง (ต่อรอบ ไม่ใช่ต่อ turn) โดยไม่แก้ ai/agent.ts —
// ห่อเฉพาะ `messages.stream()` ซึ่งเป็นเมธอดเดียวที่ agent.ts เรียกจริง (ดู ai/agent.ts) แล้วคืน object
// ใหม่ (ไม่ mutate client เดิม) — boundary cast ผ่าน interface แคบของตัวเอง (เหมือน fakeAnthropic.ts)
// เพื่อไม่ต้องพึ่ง `any` และไม่เก็บ reference ของ `client`/`apiKey`ไว้ที่อื่นนอกจาก closure นี้
// ---------------------------------------------------------------------------

interface MinimalMessageStream {
  [Symbol.asyncIterator](): AsyncIterator<Anthropic.MessageStreamEvent>;
  finalMessage(): Promise<Anthropic.Message>;
}

interface MinimalStreamClient {
  messages: {
    stream: (
      params: Anthropic.MessageCreateParams,
      options?: { signal?: AbortSignal; maxRetries?: number },
    ) => MinimalMessageStream;
  };
}

function instrumentClient(
  client: Anthropic,
  onRequestUsage: (model: string, usage: Anthropic.Usage) => void,
): Anthropic {
  const real = client as unknown as MinimalStreamClient;
  const wrapped: MinimalStreamClient = {
    messages: {
      stream(params, options) {
        const stream = real.messages.stream(params, options);
        return {
          [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
          async finalMessage() {
            const message = await stream.finalMessage();
            onRequestUsage(params.model, message.usage);
            return message;
          },
        };
      },
    },
  };
  return wrapped as unknown as Anthropic;
}

// ---------------------------------------------------------------------------
// runCase
// ---------------------------------------------------------------------------

function emptyToolLogSummary(): EvalToolLogSummary {
  return {
    sourceIdCount: 0,
    docIdCount: 0,
    econValueCount: 0,
    webUrlCount: 0,
    trendRefCount: 0,
    illustrationCount: 0,
    proposalAttemptCount: 0,
  };
}

interface HarnessState {
  useFakeClient: boolean;
  apiKey?: string;
}

async function runCaseImpl(
  caseSpec: EvalCaseSpec,
  limits: EvalRunLimits,
  state: HarnessState,
): Promise<EvalRunResult> {
  const startedAt = Date.now();
  const isDryRun = state.useFakeClient;
  // ประกาศนอก try: ถ้า case ล้มกลางทาง request ที่จ่ายเงินไปแล้วต้องยังถูกรายงานกลับไปลง ledger
  // (main thread review T-306 — เดิม catch คืน usage ว่าง/ต้นทุน 0 ทำให้ ledger นับเงินขาด)
  const perRequestUsage: EvalPerRequestUsage[] = [];
  let promptStats: EvalRunResult['promptStats'];

  try {
    if (!isModelId(caseSpec.model)) {
      throw new Error(`ไม่รู้จัก model id "${caseSpec.model}" (ai/models.ts#MODEL_IDS)`);
    }
    const model: ModelId = caseSpec.model;
    const effort = isEffortLevel(caseSpec.effort) ? caseSpec.effort : undefined;

    resetToolCapture();

    const rawClient = state.useFakeClient
      ? createFakeAnthropicClient({
          turns: buildGenericDryRunScript(caseSpec.prompt_sequence.length),
        }).client
      : createClient(state.apiKey ?? '');

    // อ้างผ่านตัวแปรที่ mutate ได้ (ไม่ใช่ closure ตายตัวต่อ turn) เพราะ `client` ตัวเดียวถูกใช้ซ้ำทุก
    // turn ของ `prompt_sequence` — อัปเดตค่าที่ต้นลูปแต่ละ turn ด้านล่าง
    const currentTurnIndexBox = { value: 0 };
    const client = instrumentClient(rawClient, (reqModel, usage) => {
      const cost = costFromUsage(reqModel as ModelId, usage);
      perRequestUsage.push({
        turnIndex: currentTurnIndexBox.value,
        model: reqModel,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
        costUsd: cost.totalCostUsd,
      });
    });

    const innerToolLog = createToolLog();
    const { toolLog, summary: toolLogSummaryFn } = createCountingToolLog(innerToolLog);
    const toolContext = { data, toolLog, illustrationSink: createInMemoryIllustrationSink() };

    const system = await buildSystemPromptInput(caseSpec.mode);
    const apiTools = toApiTools(model);
    promptStats = {
      systemChars: system.reduce((sum, block) => sum + block.text.length, 0),
      toolsJsonChars: JSON.stringify(apiTools).length,
      toolCount: apiTools.length,
    };

    let messages: Anthropic.MessageParam[] = [];
    const turns: EvalTurnResult[] = [];
    const toolCalls: EvalToolCallRecord[] = [];
    let runningCostUsd = 0;
    let latestProposal: unknown = null;
    let latestProposalWarnings: string[] = [];
    let finalEndedBecause = '';

    for (let turnIndex = 0; turnIndex < caseSpec.prompt_sequence.length; turnIndex += 1) {
      // ข้อความ follow-up ("ใช้สมมติฐานแล้วสรุปเลย") มีไว้เฉพาะกรณีโมเดลยังไม่ออกข้อเสนอ — ถ้าได้ proposal
      // แล้วไม่ส่งต่อ (ทุก turn ส่งประวัติทั้งหมดซ้ำ = จ่ายเงินเปล่า; main thread review หลังรันจริง case แรก)
      if (turnIndex > 0 && latestProposal !== null) {
        break;
      }
      currentTurnIndexBox.value = turnIndex;
      const userText = caseSpec.prompt_sequence[turnIndex] ?? '';
      messages = [...messages, { role: 'user', content: userText }];

      const assistantTextParts: string[] = [];
      const turnWarnings: string[] = [];
      const captureStartIndex = getCapturedToolCalls().length;

      const onEvent = (event: AgentEvent): void => {
        if (event.type === 'text_delta') {
          assistantTextParts.push(event.text);
        } else if (event.type === 'warning') {
          turnWarnings.push(event.messageTh);
        }
      };

      const result = await runAgentTurn({
        client,
        model,
        ...(effort !== undefined ? { effort } : {}),
        mode: caseSpec.mode,
        system,
        messages,
        toolContext,
        budget: {
          maxToolRounds: limits.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
          ...(limits.maxCostUsdPerTurn !== undefined
            ? { maxCostUsdPerTurn: limits.maxCostUsdPerTurn }
            : {}),
          ...(limits.maxCostUsdPerSession !== undefined
            ? { maxCostUsdPerSession: limits.maxCostUsdPerSession }
            : {}),
          spentUsdSoFar: runningCostUsd,
        },
        enableWebSearch: caseSpec.web_search,
        onEvent,
      });

      messages = result.messages;
      runningCostUsd += result.costUsd;
      finalEndedBecause = result.endedBecause;
      // แหล่งหลักของ proposal คือผลของ agent loop เอง (ไม่พึ่งการจับคู่ capture ด้านล่าง ซึ่งเคยทำ proposal
      // ที่จ่ายเงินแล้วหายไปทั้งก้อน) — ผ่าน JSON เพื่อยืนยันว่าเป็น plain data ก่อนข้าม page.evaluate
      if (result.proposal !== undefined) {
        latestProposal = JSON.parse(JSON.stringify(result.proposal.proposal)) as unknown;
        latestProposalWarnings = [...result.proposal.warnings];
      }

      // จับคู่ capture กับ tool call แบบ FIFO "ต่อชื่อ tool" + กรองด้วย isError — ห้ามเดินด้วย cursor ตัวเดียว:
      // tool ที่รันขนานในรอบเดียวกันถูก capture ตามลำดับที่ "เสร็จ" ไม่ใช่ลำดับที่โมเดลเรียก (รันจริงรอบ 2:
      // query_budget_lines error เสร็จก่อน search_catalog → cursor เพี้ยนทั้ง case และ proposal หาย)
      const matched = matchCaptures(
        result.toolCalls,
        getCapturedToolCalls().slice(captureStartIndex),
      );
      for (const [callIndex, tc] of result.toolCalls.entries()) {
        const cap = matched[callIndex];
        if (cap !== undefined) {
          const record: EvalToolCallRecord = {
            id: tc.id,
            name: tc.name,
            round: tc.round,
            turnIndex,
            isError: tc.isError,
            input: cap.input,
          };
          if (cap.isError) {
            if (cap.errorContent !== undefined) {
              record.errorPreview = cap.errorContent.slice(0, 500);
            }
          } else {
            const preview = summarizeToolOutput(tc.name, cap.output);
            record.outputPreview = preview;
            record.outputChars = JSON.stringify(cap.output ?? null).length;
            if (tc.name === 'emit_proposal') {
              latestProposal = (preview as { proposal?: unknown }).proposal ?? null;
              latestProposalWarnings = (preview as { warnings?: string[] }).warnings ?? [];
            }
          }
          toolCalls.push(record);
        } else {
          toolCalls.push({
            id: tc.id,
            name: tc.name,
            round: tc.round,
            turnIndex,
            isError: tc.isError,
          });
        }
      }

      turns.push({
        turnIndex,
        userText,
        assistantText: assistantTextParts.join(''),
        endedBecause: result.endedBecause,
        stopReason: result.stopReason,
        usageTotals: {
          inputTokens: result.usageTotals.inputTokens,
          outputTokens: result.usageTotals.outputTokens,
          cacheCreationInputTokens: result.usageTotals.cacheCreationInputTokens,
          cacheReadInputTokens: result.usageTotals.cacheReadInputTokens,
          webSearchRequests: result.usageTotals.webSearchRequests,
        },
        costUsd: result.costUsd,
        warnings: turnWarnings,
      });
    }

    return {
      caseId: caseSpec.id,
      model,
      mode: caseSpec.mode,
      turns,
      toolCalls,
      perRequestUsage,
      toolLogSummary: toolLogSummaryFn(),
      proposal: latestProposal,
      proposalWarnings: latestProposalWarnings,
      totalCostUsd: runningCostUsd,
      elapsedMs: Date.now() - startedAt,
      finalEndedBecause,
      ranAt: new Date().toISOString(),
      isDryRun,
      promptStats,
    };
  } catch (err) {
    return {
      caseId: caseSpec.id,
      model: caseSpec.model,
      mode: caseSpec.mode,
      turns: [],
      toolCalls: [],
      perRequestUsage,
      toolLogSummary: emptyToolLogSummary(),
      proposal: null,
      proposalWarnings: [],
      totalCostUsd: perRequestUsage.reduce((sum, r) => sum + r.costUsd, 0),
      elapsedMs: Date.now() - startedAt,
      finalEndedBecause: 'error',
      ranAt: new Date().toISOString(),
      isDryRun,
      fatalError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// React component — เหมือน DataHarnessPage.tsx (T-203 §4): ไม่มี UI จริง แค่ expose window API
// ---------------------------------------------------------------------------

export function AiEvalHarnessPage(): ReactElement {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // เก็บใน closure ของ effect นี้เท่านั้น (ไม่ใช่ React state/ref) — ไม่ถูกเก็บ/ส่งออกไปที่ไหนอีก
    let harnessState: HarnessState = { useFakeClient: false };

    const api: EvalHarnessApi = {
      init(opts: EvalHarnessInitOptions) {
        harnessState = {
          useFakeClient: opts.useFakeClient ?? false,
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        };
        // ต้องติดตั้งก่อนเรียก runCase ครั้งแรกเสมอ (idempotent) — ดู ai/testing/toolCapture.ts
        installToolCapture();
      },
      runCase(caseSpec: EvalCaseSpec, limits?: EvalRunLimits) {
        return runCaseImpl(caseSpec, limits ?? {}, harnessState);
      },
    };
    window.__evalHarness = api;
    setReady(true);
    return () => {
      delete window.__evalHarness;
    };
  }, []);

  return <div data-testid="ai-eval-harness-root" data-ready={ready ? 'true' : 'false'} />;
}
