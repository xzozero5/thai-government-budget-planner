// T-306 — unit test ของ score.mjs (pure) ด้วย transcript ปลอมล้วน (ไม่แตะ browser/API จริง)
import { describe, expect, it } from 'vitest';
import { cacheHitInfo, citationIntegrity, scoreCase } from './score.mjs';

function baseCase(overrides = {}) {
  return {
    id: 'case-1',
    expected: {
      min_boq_lines: 1,
      must_have_basis: [],
      must_cite_dataset: [],
      must_call_tools: [],
      must_not_claim: [],
      must_mention: [],
    },
    ...overrides,
  };
}

function baseTranscript(overrides = {}) {
  return {
    turns: [{ assistantText: 'สวัสดีครับ' }],
    toolCalls: [],
    perRequestUsage: [{ turnIndex: 0, cacheReadInputTokens: 0 }],
    proposal: null,
    totalCostUsd: 0.01,
    ...overrides,
  };
}

describe('scoreCase', () => {
  it('ผ่านทุกเงื่อนไขเมื่อ proposal ครบ + tool call ครบ + ไม่มีข้อความต้องห้าม', () => {
    const caseSpec = baseCase({
      expected: {
        min_boq_lines: 1,
        must_have_basis: ['historical'],
        must_cite_dataset: ['pbo_disbursement'],
        must_call_tools: ['search_catalog', 'query_budget_lines', 'emit_proposal'],
        must_not_claim: ['ปี ?2540.{0,80}บาท'],
        must_mention: ['18,?000'],
      },
    });
    const transcript = baseTranscript({
      turns: [{ assistantText: 'ราคาเครื่องปรับอากาศ 18,000 บีทียู ประมาณนี้' }],
      toolCalls: [
        { name: 'search_catalog', isError: false, outputPreview: { total: 1 } },
        {
          name: 'query_budget_lines',
          isError: false,
          outputPreview: { datasets: ['pbo_disbursement'] },
        },
        {
          name: 'emit_proposal',
          isError: false,
          input: { boq: [{ citations: [{ kind: 'budget_line', source_id: 'a' }] }] },
        },
      ],
      proposal: {
        boq: [
          {
            basis: 'historical',
            confidence: 'medium',
            rationale: 'อ้างอิงจากข้อมูลจริง',
            citations: [{ kind: 'budget_line', source_id: 'a' }],
          },
        ],
        totals: { grand_total_thb: 100000 },
      },
    });

    const result = scoreCase(caseSpec, transcript);
    expect(result.auto_pass).toBe(true);
    expect(result.checks.every((c) => c.pass)).toBe(true);
    expect(result.citation).toEqual({ claimed: 1, resolved: 1, hallucinated: 0, precision: 1 });
  });

  it('require_no_proposal=true: มี proposal จริง → fail', () => {
    const caseSpec = baseCase({ expected: { ...baseCase().expected, require_no_proposal: true } });
    const transcript = baseTranscript({ proposal: { boq: [{ basis: 'estimate', confidence: 'low', rationale: 'x', citations: [] }] } });
    const result = scoreCase(caseSpec, transcript);
    expect(result.auto_pass).toBe(false);
    expect(result.checks.find((c) => c.name === 'require_no_proposal').pass).toBe(false);
  });

  it('require_no_proposal=true: ไม่มี proposal → pass', () => {
    const caseSpec = baseCase({ expected: { ...baseCase().expected, require_no_proposal: true } });
    const transcript = baseTranscript({ proposal: null });
    const result = scoreCase(caseSpec, transcript);
    expect(result.checks.find((c) => c.name === 'require_no_proposal').pass).toBe(true);
  });

  it('must_not_call_tools: เรียก emit_proposal ทั้งที่ห้าม → fail', () => {
    const caseSpec = baseCase({
      expected: { ...baseCase().expected, min_boq_lines: 0, must_not_call_tools: ['emit_proposal'] },
    });
    const transcript = baseTranscript({ toolCalls: [{ name: 'emit_proposal', isError: false }] });
    const result = scoreCase(caseSpec, transcript);
    expect(result.checks.find((c) => c.name === 'must_not_call_tools').pass).toBe(false);
  });

  it('must_not_claim: ข้อความมีรูปแบบต้องห้าม → fail', () => {
    const caseSpec = baseCase({
      expected: { ...baseCase().expected, min_boq_lines: 0, must_not_claim: ['2540.{0,60}[0-9]{3,}\\s*บาท'] },
    });
    const transcript = baseTranscript({
      turns: [{ assistantText: 'ในปี 2540 ราคาคอมพิวเตอร์อยู่ที่ 25000 บาท แน่นอน' }],
    });
    const result = scoreCase(caseSpec, transcript);
    expect(result.checks.find((c) => c.name === 'must_not_claim').pass).toBe(false);
  });

  it('must_mention: ไม่พบข้อความที่ต้องกล่าวถึง → fail', () => {
    const caseSpec = baseCase({
      expected: { ...baseCase().expected, min_boq_lines: 0, must_mention: ['ไม่มีข้อมูล'] },
    });
    const transcript = baseTranscript({ turns: [{ assistantText: 'สวัสดีครับ ยินดีให้บริการ' }] });
    const result = scoreCase(caseSpec, transcript);
    expect(result.checks.find((c) => c.name === 'must_mention').pass).toBe(false);
  });

  it('max_confidence: มีบรรทัด confidence สูงเกินเพดาน → fail', () => {
    const caseSpec = baseCase({
      expected: { ...baseCase().expected, min_boq_lines: 0, max_confidence: 'medium' },
    });
    const transcript = baseTranscript({
      proposal: {
        boq: [{ basis: 'historical', confidence: 'high', rationale: 'x', citations: [] }],
        totals: { grand_total_thb: 1 },
      },
    });
    const result = scoreCase(caseSpec, transcript);
    expect(result.checks.find((c) => c.name === 'max_confidence').pass).toBe(false);
  });

  it('grand_total_range: เกินเพดานบน → fail', () => {
    const caseSpec = baseCase({
      expected: { ...baseCase().expected, min_boq_lines: 0, max_grand_total_thb: 1000 },
    });
    const transcript = baseTranscript({
      proposal: { boq: [], totals: { grand_total_thb: 5000 } },
    });
    const result = scoreCase(caseSpec, transcript);
    expect(result.checks.find((c) => c.name === 'grand_total_range').pass).toBe(false);
  });

  it('citation integrity: นับ hallucinated citation จาก input ดิบ vs proposal ที่ normalize แล้ว', () => {
    const transcript = baseTranscript({
      toolCalls: [
        {
          name: 'emit_proposal',
          isError: false,
          input: {
            boq: [{ citations: [{ kind: 'budget_line', source_id: 'a' }, { kind: 'budget_line', source_id: 'b' }] }],
          },
        },
      ],
      proposal: { boq: [{ citations: [{ kind: 'budget_line', source_id: 'a' }] }] },
    });
    expect(citationIntegrity(transcript)).toEqual({ claimed: 2, resolved: 1, hallucinated: 1, precision: 0.5 });
  });

  it('cache hit info: นับเฉพาะ request ตั้งแต่ตัวที่ 2 ของ case', () => {
    const transcript = baseTranscript({
      perRequestUsage: [
        { turnIndex: 0, cacheReadInputTokens: 0 },
        { turnIndex: 0, cacheReadInputTokens: 500 },
        { turnIndex: 1, cacheReadInputTokens: 0 },
      ],
    });
    expect(cacheHitInfo(transcript)).toEqual({ requestsAfterFirst: 2, cacheHits: 1, cacheHitRatePct: 50 });
  });

  it('cost_within_cap: เกินเพดานต่อ case → fail', () => {
    const caseSpec = baseCase({ expected: { ...baseCase().expected, min_boq_lines: 0 } });
    const transcript = baseTranscript({ totalCostUsd: 0.2 });
    const result = scoreCase(caseSpec, transcript, { costCapUsd: 0.12 });
    expect(result.checks.find((c) => c.name === 'cost_within_cap').pass).toBe(false);
  });

  it('fatalError: คืน auto_pass=false ทันทีโดยไม่ throw', () => {
    const caseSpec = baseCase();
    const transcript = { fatalError: 'ไม่รู้จัก model id', perRequestUsage: [] };
    const result = scoreCase(caseSpec, transcript);
    expect(result.auto_pass).toBe(false);
    expect(result.checks[0].name).toBe('no_fatal_error');
  });

  it('tool_rounds_within_budget: turn เดียวมี request เกิน 8 → fail', () => {
    const caseSpec = baseCase({ expected: { ...baseCase().expected, min_boq_lines: 0 } });
    const transcript = baseTranscript({
      perRequestUsage: Array.from({ length: 9 }, () => ({ turnIndex: 0, cacheReadInputTokens: 0 })),
    });
    const result = scoreCase(caseSpec, transcript);
    expect(result.checks.find((c) => c.name === 'tool_rounds_within_budget').pass).toBe(false);
  });
});
