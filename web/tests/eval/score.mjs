// T-306 — scoring แบบ rule-based (ADR-006 ข้อ 10 / 07-TESTING.md §4: ไม่ใช้ LLM-as-judge รอบนี้)
//
// pure module: รับ `caseSpec` (จาก cases.yaml, แปลงเป็น object แล้ว) + `transcript`
// (`EvalRunResult` จาก `AiEvalHarnessPage.tsx` ผ่าน `page.evaluate` — plain JSON เสมอ) → คืนผลตรวจ
// รายข้อ + `auto_pass` รวม ไม่มี I/O ใด ๆ ในไฟล์นี้ (unit test ได้ด้วย transcript ปลอมล้วน)
//
// หมายเหตุสำคัญ: เนื้อหาของ dry-run transcript (สคริปต์คงที่จาก
// `web/src/app/dataHarness/aiEvalHarness/dryRunScript.ts`) แทบไม่มีทางผ่านเกณฑ์เนื้อหา (must_mention/
// must_have_basis/ฯลฯ) เพราะไม่ได้ตอบโจทย์ของ case จริง — `auto_pass=false` ในโหมด dry-run เป็นเรื่อง
// คาดหวัง ไม่ใช่บั๊ก (ดู `docs/eval-report.md`/`out/dry-run-report.md` หัวข้อคำเตือน)

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function toRegex(pattern) {
  return new RegExp(pattern, 'u');
}

function collectText(transcript) {
  const assistantText = (transcript.turns ?? []).map((t) => t.assistantText ?? '').join('\n');
  const proposalText = transcript.proposal != null ? JSON.stringify(transcript.proposal) : '';
  return `${assistantText}\n${proposalText}`;
}

function pushCheck(checks, name, pass, reason) {
  checks.push({ name, pass, reason });
}

function checkMinBoqLinesOrNoProposal(caseSpec, transcript, checks) {
  const expected = caseSpec.expected;
  const boq = transcript.proposal?.boq ?? [];
  if (expected.require_no_proposal === true) {
    const pass = transcript.proposal == null;
    pushCheck(
      checks,
      'require_no_proposal',
      pass,
      pass
        ? 'ไม่มี proposal ตามที่คาดหวัง'
        : 'พบ proposal ทั้งที่โจทย์นี้ควรตอบว่าไม่มีข้อมูลพอโดยไม่สร้างข้อเสนอ',
    );
    return;
  }
  if ((expected.min_boq_lines ?? 0) > 0) {
    const pass = boq.length >= expected.min_boq_lines;
    pushCheck(
      checks,
      'min_boq_lines',
      pass,
      `boq.length=${String(boq.length)} (ต้องการ >= ${String(expected.min_boq_lines)})`,
    );
  }
}

const VALID_BASIS = new Set(['historical', 'market', 'estimate']);

function checkBoqBasisAndRationale(transcript, checks) {
  const boq = transcript.proposal?.boq ?? [];
  if (boq.length === 0) {
    return;
  }
  const bad = boq.filter(
    (line) => !VALID_BASIS.has(line.basis) || typeof line.rationale !== 'string' || line.rationale.trim() === '',
  );
  pushCheck(
    checks,
    'boq_basis_rationale',
    bad.length === 0,
    bad.length === 0 ? 'ทุกบรรทัดมี basis + rationale ที่ถูกต้อง' : `${String(bad.length)} บรรทัดขาด basis/rationale ที่ถูกต้อง`,
  );
}

function checkMustHaveBasis(caseSpec, transcript, checks) {
  const expected = caseSpec.expected.must_have_basis ?? [];
  if (expected.length === 0) {
    return;
  }
  const boq = transcript.proposal?.boq ?? [];
  const seen = new Set(boq.map((line) => line.basis));
  const missing = expected.filter((b) => !seen.has(b));
  pushCheck(
    checks,
    'must_have_basis',
    missing.length === 0,
    missing.length === 0 ? 'พบ basis ที่ต้องการครบ' : `ไม่พบ basis: ${missing.join(', ')}`,
  );
}

function collectDatasetsFromToolCalls(transcript) {
  const datasets = new Set();
  for (const tc of transcript.toolCalls ?? []) {
    const preview = tc.outputPreview;
    if (preview && Array.isArray(preview.datasets)) {
      for (const d of preview.datasets) {
        datasets.add(d);
      }
    }
  }
  return datasets;
}

function checkMustCiteDataset(caseSpec, transcript, checks) {
  const expected = caseSpec.expected.must_cite_dataset ?? [];
  if (expected.length === 0) {
    return;
  }
  const datasets = collectDatasetsFromToolCalls(transcript);
  const pass = expected.some((d) => datasets.has(d));
  pushCheck(
    checks,
    'must_cite_dataset',
    pass,
    pass
      ? `พบ dataset ที่คาดไว้อย่างน้อยหนึ่งชนิด (พบจริง: ${[...datasets].join(', ') || '-'})`
      : `ไม่พบ dataset ที่คาดไว้ (${expected.join(', ')}) ในผลลัพธ์ tool ใด ๆ ของ case นี้ (พบจริง: ${[...datasets].join(', ') || 'ไม่มีเลย'})`,
  );
}

function calledToolNames(transcript) {
  return new Set((transcript.toolCalls ?? []).map((tc) => tc.name));
}

function checkMustCallTools(caseSpec, transcript, checks) {
  const expected = caseSpec.expected.must_call_tools ?? [];
  if (expected.length === 0) {
    return;
  }
  const called = calledToolNames(transcript);
  const missing = expected.filter((name) => !called.has(name));
  pushCheck(
    checks,
    'must_call_tools',
    missing.length === 0,
    missing.length === 0 ? 'เรียกครบทุก tool ที่กำหนด' : `ไม่ได้เรียก: ${missing.join(', ')}`,
  );
}

function checkMustNotCallTools(caseSpec, transcript, checks) {
  const expected = caseSpec.expected.must_not_call_tools ?? [];
  if (expected.length === 0) {
    return;
  }
  const called = calledToolNames(transcript);
  const violated = expected.filter((name) => called.has(name));
  pushCheck(
    checks,
    'must_not_call_tools',
    violated.length === 0,
    violated.length === 0 ? 'ไม่เรียก tool ต้องห้าม' : `เรียก tool ต้องห้าม: ${violated.join(', ')}`,
  );
}

function checkMustNotClaim(caseSpec, transcript, checks) {
  const patterns = caseSpec.expected.must_not_claim ?? [];
  if (patterns.length === 0) {
    return;
  }
  const text = collectText(transcript);
  const matched = patterns.filter((p) => toRegex(p).test(text));
  pushCheck(
    checks,
    'must_not_claim',
    matched.length === 0,
    matched.length === 0 ? 'ไม่พบข้อความต้องห้าม' : `พบข้อความต้องห้ามตรงกับ: ${matched.join(' | ')}`,
  );
}

function checkMustMention(caseSpec, transcript, checks) {
  const patterns = caseSpec.expected.must_mention ?? [];
  if (patterns.length === 0) {
    return;
  }
  const text = collectText(transcript);
  const missing = patterns.filter((p) => !toRegex(p).test(text));
  pushCheck(
    checks,
    'must_mention',
    missing.length === 0,
    missing.length === 0 ? 'พบข้อความที่ต้องกล่าวถึงครบ' : `ไม่พบรูปแบบ: ${missing.join(' | ')}`,
  );
}

function checkGrandTotalRange(caseSpec, transcript, checks) {
  const expected = caseSpec.expected;
  if (expected.max_grand_total_thb === undefined && expected.min_grand_total_thb === undefined) {
    return;
  }
  const grand = transcript.proposal?.totals?.grand_total_thb;
  if (typeof grand !== 'number') {
    pushCheck(checks, 'grand_total_range', false, 'ไม่มี proposal.totals.grand_total_thb ให้ตรวจ');
    return;
  }
  const okMax = expected.max_grand_total_thb === undefined || grand <= expected.max_grand_total_thb;
  const okMin = expected.min_grand_total_thb === undefined || grand >= expected.min_grand_total_thb;
  pushCheck(
    checks,
    'grand_total_range',
    okMax && okMin,
    `grand_total_thb=${String(grand)} (ช่วงที่กำหนด: ${String(expected.min_grand_total_thb ?? '-')} .. ${String(expected.max_grand_total_thb ?? '-')})`,
  );
}

function checkMaxConfidence(caseSpec, transcript, checks) {
  const cap = caseSpec.expected.max_confidence;
  if (!cap) {
    return;
  }
  const boq = transcript.proposal?.boq ?? [];
  const over = boq.filter((line) => (CONFIDENCE_RANK[line.confidence] ?? 0) > CONFIDENCE_RANK[cap]);
  pushCheck(
    checks,
    'max_confidence',
    over.length === 0,
    over.length === 0 ? `confidence ทุกบรรทัด <= ${cap}` : `${String(over.length)} บรรทัด confidence เกิน ${cap}`,
  );
}

/** 07-TESTING.md §4 / T-306 ข้อ 4: จำนวนรอบ tool ต่อ turn <= 8 (ดู `ai/agent.ts#DEFAULT_MAX_TOOL_ROUNDS`
 * และเพดานที่ runner ส่งเข้า `budget.maxToolRounds`) — นับจาก `perRequestUsage` ที่แท็ก turnIndex ไว้ */
function checkToolRoundsWithinBudget(transcript, checks) {
  const perTurnCount = new Map();
  for (const r of transcript.perRequestUsage ?? []) {
    perTurnCount.set(r.turnIndex, (perTurnCount.get(r.turnIndex) ?? 0) + 1);
  }
  const overBudget = [...perTurnCount.entries()].filter(([, n]) => n > 8);
  pushCheck(
    checks,
    'tool_rounds_within_budget',
    overBudget.length === 0,
    overBudget.length === 0
      ? 'ทุก user turn ใช้ <= 8 รอบ'
      : `turn ${overBudget.map(([t]) => String(t)).join(', ')} เกิน 8 รอบ`,
  );
}

function checkCostWithinCap(transcript, costCapUsd, checks) {
  if (costCapUsd === undefined) {
    return;
  }
  const pass = transcript.totalCostUsd <= costCapUsd;
  pushCheck(
    checks,
    'cost_within_cap',
    pass,
    `totalCostUsd=${transcript.totalCostUsd.toFixed(4)} USD (เพดานต่อ case: ${costCapUsd.toFixed(4)} USD)`,
  );
}

function countCitations(obj) {
  if (obj == null) {
    return 0;
  }
  let n = 0;
  for (const line of obj.boq ?? []) {
    n += (line.citations ?? []).length;
  }
  for (const f of obj.audit_findings ?? []) {
    n += (f.citations ?? []).length;
  }
  n += (obj.citations_web ?? []).length;
  return n;
}

/** citation integrity (04 §D4/N3): เทียบจำนวน citation ที่โมเดล "อ้าง" (input ดิบของ emit_proposal
 * ก่อน validator ตัด/ลดระดับ) กับที่ "เหลือรอด" (transcript.proposal ที่ normalize แล้ว) —
 * precision = resolved/claimed (1 เมื่อไม่มีการอ้างอิงเลย ไม่ถือว่าผิดเพราะไม่มีอะไรให้ hallucinate) */
export function citationIntegrity(transcript) {
  const emitCall = (transcript.toolCalls ?? []).find((tc) => tc.name === 'emit_proposal' && !tc.isError);
  const claimed = countCitations(emitCall?.input);
  const resolved = countCitations(transcript.proposal);
  const hallucinated = Math.max(0, claimed - resolved);
  const precision = claimed > 0 ? resolved / claimed : 1;
  return { claimed, resolved, hallucinated, precision };
}

/** ADR-006 ข้อ 7: รายงานเป็นข้อมูล ไม่ fail บน Haiku ถ้า prefix ต่ำกว่าขั้นต่ำ cache — วัดจาก request
 * ตั้งแต่ตัวที่ 2 ของ case เป็นต้นไป (ตัวแรกไม่มีทาง cache hit เพราะเป็นการเขียน cache ครั้งแรกเสมอ) */
export function cacheHitInfo(transcript) {
  const requests = transcript.perRequestUsage ?? [];
  const afterFirst = requests.slice(1);
  const hits = afterFirst.filter((r) => r.cacheReadInputTokens > 0).length;
  return {
    requestsAfterFirst: afterFirst.length,
    cacheHits: hits,
    cacheHitRatePct: afterFirst.length > 0 ? Math.round((hits / afterFirst.length) * 100) : null,
  };
}

/**
 * ตรวจ 1 case → `{case_id, auto_pass, checks[], citation, cache}` — ไม่ throw แม้ transcript ผิดรูป
 * (เช่นมี `fatalError` จาก harness) เพื่อให้ runner รายงานผลของทุก case ได้เสมอ
 */
export function scoreCase(caseSpec, transcript, opts = {}) {
  const checks = [];

  if (transcript.fatalError) {
    pushCheck(checks, 'no_fatal_error', false, transcript.fatalError);
    return {
      case_id: caseSpec.id,
      auto_pass: false,
      checks,
      citation: citationIntegrity(transcript),
      cache: cacheHitInfo(transcript),
    };
  }

  checkMinBoqLinesOrNoProposal(caseSpec, transcript, checks);
  checkBoqBasisAndRationale(transcript, checks);
  checkMustHaveBasis(caseSpec, transcript, checks);
  checkMustCiteDataset(caseSpec, transcript, checks);
  checkMustCallTools(caseSpec, transcript, checks);
  checkMustNotCallTools(caseSpec, transcript, checks);
  checkMustNotClaim(caseSpec, transcript, checks);
  checkMustMention(caseSpec, transcript, checks);
  checkGrandTotalRange(caseSpec, transcript, checks);
  checkMaxConfidence(caseSpec, transcript, checks);
  checkToolRoundsWithinBudget(transcript, checks);
  checkCostWithinCap(transcript, opts.costCapUsd, checks);

  return {
    case_id: caseSpec.id,
    auto_pass: checks.every((c) => c.pass),
    checks,
    citation: citationIntegrity(transcript),
    cache: cacheHitInfo(transcript),
  };
}
