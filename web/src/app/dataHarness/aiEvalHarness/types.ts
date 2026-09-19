/**
 * T-306 — types ที่ใช้ร่วมกันระหว่าง `AiEvalHarnessPage.tsx` (ฝั่ง browser) และ
 * `web/tests/eval/{run-eval,score}.mjs` (ฝั่ง Node ผ่าน `page.evaluate`) — ทุก field ต้องเป็น
 * JSON-serializable ล้วน (ไม่มี class instance/Map/Set/function) เพราะข้าม process boundary จริง
 *
 * `EvalCaseSpec`/`EvalCaseExpected` ตรงกับโครงของ `web/tests/eval/cases.yaml` ทุก field (runner แปลง
 * YAML → object ธรรมดาด้วยไลบรารี `yaml` ก่อนส่งเข้า `page.evaluate`)
 */

export interface EvalCaseExpected {
  min_boq_lines: number;
  must_have_basis: string[];
  must_cite_dataset: string[];
  must_call_tools: string[];
  must_not_call_tools?: string[];
  must_not_claim: string[];
  must_mention: string[];
  max_grand_total_thb?: number;
  min_grand_total_thb?: number;
  require_no_proposal?: boolean;
  max_confidence?: 'high' | 'medium' | 'low';
}

export interface EvalCaseSpec {
  id: string;
  title: string;
  mode: 'audit' | 'draft';
  prompt_sequence: string[];
  web_search: boolean;
  expected: EvalCaseExpected;
  run_tier: 'core8' | 'extended';
  model: string;
  effort?: string;
}

export interface EvalHarnessInitOptions {
  /** ไม่ใส่/ไม่จำเป็นเมื่อ `useFakeClient: true` — ห้าม log/persist ค่านี้ที่ใดทั้งสิ้น (N2) */
  apiKey?: string;
  /** true = ใช้ `ai/testing/fakeAnthropic` (dry-run, ไม่เรียก API จริง) — ค่าเริ่มต้น false */
  useFakeClient?: boolean;
}

export interface EvalRunLimits {
  maxToolRounds?: number;
  maxCostUsdPerTurn?: number;
  maxCostUsdPerSession?: number;
}

export interface EvalPerRequestUsage {
  turnIndex: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
  costUsd: number;
}

export interface EvalToolCallRecord {
  id: string;
  name: string;
  round: number;
  turnIndex: number;
  isError: boolean;
  /** `undefined` เมื่อจับคู่กับ capture ไม่ได้ (เช่น โมเดลเรียกชื่อ tool ที่ไม่มีจริง) */
  input?: unknown;
  /** สรุปผลลัพธ์แบบย่อ (≤ 50 แถว/ตัดสตริงยาวแล้วจาก tool เอง) — `undefined` เมื่อ isError */
  outputPreview?: Record<string, unknown>;
  /** ข้อความ error แบบย่อ — มีเฉพาะ isError */
  errorPreview?: string;
  /** ขนาด (ตัวอักษร) ของ `JSON.stringify(output ดิบ)` — ใช้หา tool ที่กิน token มากผิดปกติ */
  outputChars?: number;
}

export interface EvalTurnResult {
  turnIndex: number;
  userText: string;
  assistantText: string;
  endedBecause: string;
  stopReason: string | null;
  usageTotals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    webSearchRequests: number;
  };
  costUsd: number;
  warnings: string[];
}

export interface EvalToolLogSummary {
  sourceIdCount: number;
  docIdCount: number;
  econValueCount: number;
  webUrlCount: number;
  trendRefCount: number;
  illustrationCount: number;
  proposalAttemptCount: number;
}

export interface EvalRunResult {
  caseId: string;
  model: string;
  mode: 'audit' | 'draft';
  turns: EvalTurnResult[];
  toolCalls: EvalToolCallRecord[];
  perRequestUsage: EvalPerRequestUsage[];
  toolLogSummary: EvalToolLogSummary;
  /** proposal ที่ normalize แล้วของ `emit_proposal` ล่าสุดที่สำเร็จ (ทั้ง case ไม่ใช่แค่ turn สุดท้าย) —
   * `unknown` ครอบคลุม `null` อยู่แล้ว แต่เขียนแยกไว้ตั้งใจให้อ่านเจตนา ("ไม่มี proposal") ง่ายกว่า */
  proposal: unknown;
  proposalWarnings: string[];
  totalCostUsd: number;
  elapsedMs: number;
  finalEndedBecause: string;
  ranAt: string;
  /** true เมื่อรันด้วย fake client (dry-run) — `score.mjs`/report ต้องรู้เพื่อไม่ตีความ auto_pass จริงจัง */
  isDryRun: boolean;
  /** ขนาด (ตัวอักษร) ของ prefix ที่ส่งทุก request — ใช้ติดตามต้นทุน token คงที่ต่อ session */
  promptStats?: { systemChars: number; toolsJsonChars: number; toolCount: number };
  /** ข้อผิดพลาดระดับ case (เช่น model id ไม่ถูกต้อง, เกิด exception ที่ไม่คาดคิด) — เมื่อมีค่านี้ field
   * อื่น ๆ ข้างบนอาจไม่ครบ (best-effort) */
  fatalError?: string;
}

export interface EvalHarnessApi {
  init: (opts: EvalHarnessInitOptions) => void;
  runCase: (caseSpec: EvalCaseSpec, limits?: EvalRunLimits) => Promise<EvalRunResult>;
}

declare global {
  interface Window {
    __evalHarness?: EvalHarnessApi;
  }
}
