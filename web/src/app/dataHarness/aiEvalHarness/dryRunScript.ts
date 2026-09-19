/**
 * T-306 — สคริปต์ dry-run ของ fake client: เรียก `search_catalog` → `query_budget_lines` →
 * `emit_proposal` จริงกับข้อมูล production (ผ่าน `ToolContext.data` จริง ไม่ mock) เพื่อพิสูจน์ว่า
 * harness/data facade/agent loop/scoring/report "ต่อกันได้" ตามเงื่อนไขจบของ T-306 ข้อ 2 — **ไม่ได้ตั้งใจ
 * ให้ตอบโจทย์ของ case ใด ๆ อย่างถูกต้อง** (เนื้อหาคงที่ไม่ขึ้นกับ `caseSpec`) การวัดคุณภาพ prompt จริงเกิด
 * ในรอบ `--real` (จังหวะที่ 2) เท่านั้น
 *
 * ใช้ `ScriptedTurn.kind: 'dynamic'` (T-306 ส่วนขยายของ `ai/testing/fakeAnthropic.ts`) เพื่ออ่านผลลัพธ์
 * จริงของ tool ก่อนหน้า (item_key จาก search_catalog, source_id จาก query_budget_lines) แล้วประกอบ
 * tool_use ของรอบถัดไปให้ citation integrity (N3) ผ่านจริงเมื่อมีแถวให้จริง — ไม่ hardcode source_id
 *
 * **สำคัญ**: อ่านผลลัพธ์ของรอบก่อนผ่าน `ai/testing/toolCapture.ts#getLastCapturedOutputByName` (ค่า
 * "ดิบ" ก่อนห่อเป็น `tool_result.content`) — **ไม่ parse** `tool_result.content`/`params.messages` เอง
 * ด้วย regex เพราะ delimiter/escaping/nonce ของการห่อกำลังเปลี่ยนไปพร้อมกัน (T-307 security review);
 * `AiEvalHarnessPage.tsx` ต้องเรียก `installToolCapture()` ก่อน `runAgentTurn` ครั้งแรกเสมอ มิฉะนั้น
 * `getLastCapturedOutputByName` จะคืน `undefined` ตลอด (ยัง fallback เป็น keyword search ได้ ไม่ throw)
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Proposal } from '@/ai/tools/proposal';
import type { QueryBudgetLinesOutput } from '@/ai/tools/queryBudgetLines';
import type { SearchCatalogOutput } from '@/ai/tools/searchCatalog';
import {
  makeMessage,
  makeTextBlock,
  makeToolUseBlock,
  makeUsage,
  type ScriptedTurn,
} from '@/ai/testing/fakeAnthropic';
import { getLastCapturedOutputByName } from '@/ai/testing/toolCapture';

/** คำค้นที่ยืนยันแล้วว่าเจอผลจริงจำนวนมากใน production catalog (docs/decisions/SPIKES.md §S2 ผล 4:
 * "แอร์ 18000 บีทียู" 8,491 hits) — ใช้คำสั้นกว่านี้ให้ recall กว้างขึ้นอีก ไม่ผูกกับ caseSpec ใด ๆ */
const DRY_RUN_SEARCH_QUERY = 'เครื่องปรับอากาศ';

const TOOL_USE_ID = {
  searchCatalog: 'toolu_dryrun_search_catalog',
  queryBudgetLines: 'toolu_dryrun_query_budget_lines',
  emitProposal: 'toolu_dryrun_emit_proposal',
} as const;

function dryRunUsage(): Anthropic.Usage {
  return makeUsage({ input_tokens: 500, output_tokens: 120 });
}

/** รอบ 1: ขอให้เรียก `search_catalog` เสมอ (deterministic — ไม่ผูกกับเนื้อหา case) */
function buildSearchCatalogTurn(): ScriptedTurn {
  return {
    kind: 'message',
    message: makeMessage({
      content: [
        makeTextBlock('(dry-run) กำลังค้นข้อมูลในอดีตที่เกี่ยวข้องก่อน'),
        makeToolUseBlock(TOOL_USE_ID.searchCatalog, 'search_catalog', {
          query: DRY_RUN_SEARCH_QUERY,
          limit: 5,
        }),
      ],
      stop_reason: 'tool_use',
      usage: dryRunUsage(),
    }),
  };
}

/** รอบ 2: อ่านผล `search_catalog` จริง แล้วเรียก `query_budget_lines` ด้วย item_key ที่เจอจริง (หรือ
 * keyword fallback ถ้าไม่เจอเลย — ยังคงพิสูจน์ tool call จริงได้เหมือนกัน) */
function buildQueryBudgetLinesTurn(): ScriptedTurn {
  return {
    kind: 'dynamic',
    build: () => {
      const searchOutput = getLastCapturedOutputByName('search_catalog') as
        SearchCatalogOutput | undefined;
      const firstKey = searchOutput?.items[0]?.key;
      const input =
        firstKey !== undefined
          ? { item_key: firstKey, fiscal_years: [2566, 2567, 2568], limit: 5 }
          : { keywords: [DRY_RUN_SEARCH_QUERY], fiscal_years: [2566, 2567, 2568], limit: 5 };
      return makeMessage({
        content: [
          makeTextBlock('(dry-run) พบรายการที่เกี่ยวข้อง กำลังดูบรรทัดงบจริง'),
          makeToolUseBlock(TOOL_USE_ID.queryBudgetLines, 'query_budget_lines', input),
        ],
        stop_reason: 'tool_use',
        usage: dryRunUsage(),
      });
    },
  };
}

const DRY_RUN_PROPOSAL_BASE: Omit<Proposal, 'boq' | 'totals'> = {
  version: 1,
  title: '(dry-run) ข้อเสนอทดสอบระบบ — ไม่ใช่ผลลัพธ์จริงของโจทย์ eval',
  summary:
    'ข้อเสนอนี้สร้างโดยสคริปต์ dry-run ของ T-306 เพื่อพิสูจน์ว่า harness ต่อกับ agent loop/data facade ' +
    'จริงได้ครบวงจร ไม่ได้มาจากการให้เหตุผลของโมเดลจริง',
  mode: 'draft',
  requester_context: { fiscal_year_be: 2569 },
  objectives: ['พิสูจน์ว่า emit_proposal ทำงานร่วมกับข้อมูล production จริงได้ (dry-run)'],
  scope_and_specs: [],
  assumptions: [{ text: 'dry-run — ไม่มีการตั้งสมมติฐานเชิงเนื้อหาจริง', impact: 'low' }],
  comparables: [],
  risks: [],
  open_questions: [],
  citations_web: [],
  illustrations: [],
  stat_cards: [],
};

/** รอบ 3: อ่านผล `query_budget_lines` จริง แล้วประกอบ `emit_proposal` — ถ้ามีแถวจริงให้ citation ชี้ไปยัง
 * `source_id` จริง (พิสูจน์ citation integrity ผ่านของจริง) ถ้าไม่มีแถวเลยก็ยังส่ง proposal แบบ estimate
 * ไม่มี citation ได้ (schema ไม่บังคับว่าต้องมี citation อย่างน้อย 1 อัน) */
function buildEmitProposalTurn(): ScriptedTurn {
  return {
    kind: 'dynamic',
    build: () => {
      const queryOutput = getLastCapturedOutputByName('query_budget_lines') as
        QueryBudgetLinesOutput | undefined;
      const firstRow = queryOutput?.rows[0];

      const unitPriceThb = firstRow?.unit_price_thb ?? firstRow?.amount_thb ?? 1000;
      const proposal: Proposal = {
        ...DRY_RUN_PROPOSAL_BASE,
        boq: [
          {
            id: 'line-1',
            category: 'dry-run',
            item: firstRow?.item_name_raw ?? DRY_RUN_SEARCH_QUERY,
            qty: 1,
            unit: 'รายการ',
            unit_price_thb: unitPriceThb,
            total_thb: unitPriceThb,
            basis: firstRow !== undefined ? 'historical' : 'estimate',
            confidence: firstRow !== undefined ? 'medium' : 'low',
            rationale: '(dry-run) อ้างอิงผลลัพธ์จริงจาก query_budget_lines ของรอบทดสอบนี้',
            citations:
              firstRow !== undefined
                ? [{ kind: 'budget_line', source_id: firstRow.source_id }]
                : [],
          },
        ],
        totals: {
          subtotal_thb: unitPriceThb,
          vat_included: true,
          grand_total_thb: unitPriceThb,
        },
      };
      return makeMessage({
        content: [makeToolUseBlock(TOOL_USE_ID.emitProposal, 'emit_proposal', proposal)],
        stop_reason: 'tool_use',
        usage: dryRunUsage(),
      });
    },
  };
}

function buildEndTurn(textTh: string): ScriptedTurn {
  return {
    kind: 'message',
    message: makeMessage({
      content: [makeTextBlock(textTh)],
      stop_reason: 'end_turn',
      usage: dryRunUsage(),
    }),
  };
}

/**
 * สร้างสคริปต์ทั้งหมดของ 1 case — 1 รายการต่อ 1 ครั้งที่ `client.messages.stream()` จะถูกเรียกจริง
 * (นับรวมทุก user turn ใน `prompt_sequence`) เรียงตามลำดับ: user turn แรกใช้ 4 รอบ (search_catalog →
 * query_budget_lines → emit_proposal → end_turn), user turn ที่เหลือ (ถ้ามี) ใช้ end_turn ทันที 1 รอบ
 * (พิสูจน์ว่า `runAgentTurn` ต่อเนื่องข้าม turn ได้ถูกต้อง ไม่ต้องเรียก tool ซ้ำ)
 */
export function buildGenericDryRunScript(promptTurnCount: number): ScriptedTurn[] {
  const turns: ScriptedTurn[] = [
    buildSearchCatalogTurn(),
    buildQueryBudgetLinesTurn(),
    buildEmitProposalTurn(),
    buildEndTurn('(dry-run) สรุปข้อเสนอทดสอบเรียบร้อยแล้ว'),
  ];
  for (let i = 1; i < promptTurnCount; i += 1) {
    turns.push(
      buildEndTurn('(dry-run) รับทราบคำยืนยันแล้ว — ไม่มีการเรียกเครื่องมือเพิ่มในรอบนี้'),
    );
  }
  return turns;
}
