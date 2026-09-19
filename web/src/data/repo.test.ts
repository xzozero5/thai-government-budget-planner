import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDuckDbForTests, __setDuckDbDepsForTests } from './duckdb';
import { createFakeDuckDbDeps, FakeAsyncDuckDb, type FakeQueryResponse } from './duckdbTestDoubles';
import { resetManifestCache } from './manifest';
import {
  budgetRepo,
  DEFAULT_EXCLUDE_FLAGS,
  DocNotFoundError,
  facets,
  getDoc,
  getLines,
  InvalidShardPathError,
  MAX_SHARDS_TO_SCAN,
  QueryTooBroadError,
  queryLines,
  RepoQueryError,
} from './repo';
import { createFixtureFetch } from './testFixtures';
import type { BudgetLine } from './types';

// ทุก test ในไฟล์นี้อ่านข้อมูลผ่าน fixture fetch (ไม่แตะ network จริง) — ครอบคลุมทั้ง
// manifest.json/sources.json/facets.json (จริง) และ shard parquet (ใช้ตอน fallback mode:'full'
// เท่านั้น เนื้อหาไม่ถูกอ่านจริงเพราะ query ทั้งหมดถูกทดแทนด้วย FakeDuckDbConnection)
beforeEach(() => {
  resetManifestCache();
  resetDuckDbForTests();
  vi.stubGlobal('fetch', createFixtureFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetManifestCache();
  resetDuckDbForTests();
});

function setFakeResponses(responses: FakeQueryResponse[]): FakeAsyncDuckDb {
  const fakeDb = new FakeAsyncDuckDb(responses);
  __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
  return fakeDb;
}

/** สร้างแถว BudgetLine ที่ผ่าน BudgetLineSchema ครบทุก field (ใช้เป็นผลลัพธ์จำลองของจังหวะที่ 2) */
function makeLineRecord(overrides: Partial<Record<keyof BudgetLine, unknown>>): Record<
  string,
  unknown
> {
  const base: Record<string, unknown> = {
    source_id: 'src-1',
    dataset: 'act_2570_draft',
    fiscal_year_be: 2570,
    gov_level: 'central',
    ministry: 'กระทรวงทดสอบ',
    ministry_code: '15000',
    agency: 'กรมทดสอบ',
    agency_code: null,
    province: null,
    local_gov_name: null,
    strategy: null,
    budget_group: null,
    plan: null,
    output_project: null,
    activity: null,
    budget_type: null,
    expense_category: null,
    is_capital: null,
    item_name_raw: 'เครื่องปรับอากาศ ขนาด 18000 บีทียู',
    item_key: 'เครื่องปรับอากาศ',
    item_qty: 1,
    item_unit: 'เครื่อง',
    spec_tokens: [],
    amount_thb: 30000,
    unit_price_thb: 30000,
    revised_thb: null,
    po_thb: null,
    disbursed_thb: null,
    disbursed_incl_po_thb: null,
    reserved_thb: null,
    carryover_thb: null,
    disbursement_rate: null,
    description: null,
    legal_reference: null,
    source_path: 'budget_lines/act2570/15000.parquet',
    source_sheet: 'Sheet1',
    source_row: 10,
    source_page: null,
    source_doc_id: 'd_test',
    quality_flags: [],
  };
  return { ...base, ...overrides };
}

describe('queryLines — shard selection', () => {
  it('ไม่ใส่ filter เลย → shard ทั้งหมดเกิน MAX_SHARDS_TO_SCAN → QueryTooBroadError', async () => {
    setFakeResponses([]);
    await expect(queryLines({})).rejects.toBeInstanceOf(QueryTooBroadError);
  });

  it('ข้อความ error เป็นภาษาไทยและบอกจำนวน shard', async () => {
    setFakeResponses([]);
    let caught: unknown;
    try {
      await queryLines({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QueryTooBroadError);
    const error = caught as QueryTooBroadError;
    expect(error.message).toContain('กว้างเกินไป');
    expect(error.shardCount).toBeGreaterThan(MAX_SHARDS_TO_SCAN);
  });

  it('filter dataset+ministryCodes ให้เหลือ shard เดียว → ไม่ throw', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    const result = await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    expect(result.shardsScanned).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.source_id).toBe('src-1');
    expect(result.totalMatched).toBe(1);
    expect(result.truncated).toBe(false);
    expect(fakeDb.connection.preparedCalls).toHaveLength(2);
  });

  it('shardPaths ที่ไม่อยู่ใน manifest → InvalidShardPathError', async () => {
    setFakeResponses([]);
    await expect(
      queryLines({ shardPaths: ['budget_lines/ไม่มีอยู่จริง.parquet'] }),
    ).rejects.toBeInstanceOf(InvalidShardPathError);
  });

  it('shardPaths ที่ถูกต้อง ใช้แทนการคำนวณจาก dataset/ปี ได้', async () => {
    setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    const result = await queryLines({ shardPaths: ['budget_lines/act2570/15000.parquet'] });
    expect(result.shardsScanned).toBe(1);
  });
});

describe('queryLines — SQL/parameter safety (ห้ามต่อ string ของผู้ใช้ลง SQL text)', () => {
  it('keyword ไม่ปรากฏใน SQL text แต่ปรากฏใน params เท่านั้น', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    const evilKeyword = "เครื่อง'; DROP TABLE x; --";
    await queryLines({
      dataset: 'act_2570_draft',
      ministryCodes: ['15000'],
      keyword: evilKeyword,
    });

    const [phase1] = fakeDb.connection.preparedCalls;
    expect(phase1?.sql).not.toContain(evilKeyword);
    expect(phase1?.sql).toContain("item_name_raw ILIKE ? ESCAPE '\\'");
    expect(phase1?.params).toContain(`%${evilKeyword.replace(/'/g, "'")}%`.replace("'", "'"));
    // ค่าใน params ต้องเป็น pattern ที่ escape อักขระ wildcard ของ LIKE แล้ว ไม่ใช่คำดิบ
    expect(phase1?.params.some((p) => typeof p === 'string' && p.includes(evilKeyword))).toBe(
      true,
    );
  });

  it('agencyContains/minAmount/maxAmount/itemKeys ผูกเป็น parameter ทั้งหมด', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    await queryLines({
      dataset: 'act_2570_draft',
      ministryCodes: ['15000'],
      agencyContains: 'กรมชลประทาน',
      minAmount: 1000,
      maxAmount: 999999,
      itemKeys: ['  เครื่องปรับอากาศ   แบบแยกส่วน  '],
    });
    const [phase1] = fakeDb.connection.preparedCalls;
    expect(phase1?.sql).not.toContain('กรมชลประทาน');
    expect(phase1?.sql).toContain('agency ILIKE ?');
    expect(phase1?.sql).toContain('amount_thb >= ?');
    expect(phase1?.sql).toContain('amount_thb <= ?');
    expect(phase1?.sql).toContain('item_key IN (?)');
    expect(phase1?.params).toContain('%กรมชลประทาน%');
    expect(phase1?.params).toContain(1000);
    expect(phase1?.params).toContain(999999);
    // itemKeys ต้อง normalize ช่องว่างซ้ำ/ตัดหัวท้ายก่อนผูกเป็น param
    expect(phase1?.params).toContain('เครื่องปรับอากาศ แบบแยกส่วน');
  });

  it('shard URL (มาจาก dataUrl เท่านั้น) ถูก embed ตรง ๆ ใน SQL ได้ (ไม่ใช่ user input)', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    const [phase1] = fakeDb.connection.preparedCalls;
    expect(phase1?.sql).toContain('budget_lines/act2570/15000.parquet');
    expect(phase1?.sql).toMatch(/read_parquet\('[^']+'\)/);
  });

  it('ตัดออกเป็น default: corrupt_row, lump_sum_category (excludeFlags ไม่ระบุ)', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    const [phase1] = fakeDb.connection.preparedCalls;
    const excludeCount = (phase1?.sql.match(/NOT list_contains\(quality_flags, \?\)/g) ?? [])
      .length;
    expect(excludeCount).toBe(DEFAULT_EXCLUDE_FLAGS.length);
    for (const flag of DEFAULT_EXCLUDE_FLAGS) {
      expect(phase1?.params).toContain(flag);
    }
  });

  it('excludeFlags: [] → ไม่มี NOT list_contains เลย', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'], excludeFlags: [] });
    const [phase1] = fakeDb.connection.preparedCalls;
    expect(phase1?.sql).not.toContain('list_contains');
  });
});

describe('queryLines — two-phase (ADR-002 ข้อ 4)', () => {
  it('phase 1 เลือกคอลัมน์แคบ (source_id + count window) เท่านั้น, phase 2 ค่อยดึง item_name_raw', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    const [phase1, phase2] = fakeDb.connection.preparedCalls;
    expect(phase1?.sql).toContain('SELECT source_id, count(*) OVER ()');
    expect(phase1?.sql).not.toContain('item_name_raw');
    expect(phase2?.sql).toContain('SELECT *');
    expect(phase2?.sql).toContain('source_id IN (?)');
    expect(phase2?.params).toEqual(['src-1']);
  });

  it('ไม่มีแถวตรงเงื่อนไข → ไม่ยิงจังหวะที่สอง', async () => {
    const fakeDb = setFakeResponses([{ rows: [] }]);
    const result = await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    expect(result.rows).toEqual([]);
    expect(result.totalMatched).toBe(0);
    expect(fakeDb.connection.preparedCalls).toHaveLength(1);
  });

  it('truncated = true เมื่อ totalMatched > จำนวนที่คืนจริง', async () => {
    setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 5 }] },
      { rows: [makeLineRecord({ source_id: 'src-1' })] },
    ]);
    const result = await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    expect(result.totalMatched).toBe(5);
    expect(result.truncated).toBe(true);
  });
});

describe('queryLines — limit cap', () => {
  it('limit เกิน MAX_QUERY_LIMIT ถูกตัดเหลือ 50', async () => {
    const fakeDb = setFakeResponses([{ rows: [] }]);
    await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'], limit: 9999 });
    const [phase1] = fakeDb.connection.preparedCalls;
    expect(phase1?.sql).toContain('LIMIT 50');
  });

  it('ไม่ระบุ limit ใช้ค่าเริ่มต้น 20', async () => {
    const fakeDb = setFakeResponses([{ rows: [] }]);
    await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    const [phase1] = fakeDb.connection.preparedCalls;
    expect(phase1?.sql).toContain('LIMIT 20');
  });
});

describe('queryLines — coverageNotes (ADR-004/005)', () => {
  it('แนบเฉพาะ note ของ dataset/ปีที่ shard ที่เลือกจริงครอบคลุม', async () => {
    setFakeResponses([{ rows: [] }]);
    const result = await queryLines({ dataset: 'pbo_disbursement', fiscalYears: [2567] });
    expect(result.coverageNotes).toHaveLength(1);
    expect(result.coverageNotes[0]?.status).toBe('no_oracle');
    expect(result.coverageNotes[0]?.fiscal_year_be).toBe(2567);
  });

  it('ไม่ปนกับ note ของ dataset อื่น', async () => {
    setFakeResponses([{ rows: [] }]);
    const result = await queryLines({ dataset: 'pbo_disbursement', fiscalYears: [2567] });
    expect(result.coverageNotes.every((n) => n.dataset === 'pbo_disbursement')).toBe(true);
  });

  it('committee_table (ไม่มี fiscal_year_be) ยังได้ note org_unmapped', async () => {
    setFakeResponses([{ rows: [] }]);
    const result = await queryLines({ dataset: 'committee_table' });
    expect(result.coverageNotes.some((n) => n.status === 'org_unmapped')).toBe(true);
  });
});

describe('queryLines — fallback mode:"full" (ADR-002 ข้อ 5)', () => {
  it('mode:"full" register shard buffer ก่อนรัน query', async () => {
    const fakeDb = setFakeResponses([
      { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
      { rows: [makeLineRecord({})] },
    ]);
    const result = await queryLines({
      dataset: 'act_2570_draft',
      ministryCodes: ['15000'],
      mode: 'full',
    });
    expect(result.rows).toHaveLength(1);
    expect(fakeDb.registeredBuffers.size).toBe(1);
  });

  it('range ล้มเหลว → fallback เป็น full แล้วสำเร็จ (ไม่เปลี่ยน SQL)', async () => {
    let attempts = 0;
    const fakeDb = new FakeAsyncDuckDb();
    // patch prepare ให้ prepared call ครั้งแรกของแต่ละ query ล้มเหลว 1 ครั้ง จำลอง host ไม่ตอบ 206
    const originalPrepare = fakeDb.connection.prepare.bind(fakeDb.connection);
    fakeDb.connection.prepare = (sql: string) => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error('เซิร์ฟเวอร์ไม่รองรับ range request (จำลอง)'));
      }
      return originalPrepare(sql);
    };
    __setDuckDbDepsForTests(createFakeDuckDbDeps(fakeDb));
    // เติม response ให้ครบสำหรับรอบ retry (phase1, phase2)
    (
      fakeDb.connection as unknown as { nextPreparedResponse: () => FakeQueryResponse }
    ).nextPreparedResponse = (() => {
      const queue: FakeQueryResponse[] = [
        { rows: [{ source_id: 'src-1', __total_matched: 1 }] },
        { rows: [makeLineRecord({})] },
      ];
      let i = 0;
      return () => queue[i++] ?? { rows: [] };
    })();

    const result = await queryLines({ dataset: 'act_2570_draft', ministryCodes: ['15000'] });
    expect(result.rows).toHaveLength(1);
    expect(fakeDb.registeredBuffers.size).toBe(1);
  });
});

describe('getLines', () => {
  it('shardHints ว่าง → RepoQueryError', async () => {
    setFakeResponses([]);
    await expect(getLines(['src-1'], [])).rejects.toBeInstanceOf(RepoQueryError);
  });

  it('shardHints เกิน MAX_SHARDS_TO_SCAN → QueryTooBroadError', async () => {
    setFakeResponses([]);
    const tooMany = Array.from({ length: MAX_SHARDS_TO_SCAN + 1 }, (_, i) => `fake-${String(i)}`);
    await expect(getLines(['src-1'], tooMany)).rejects.toBeInstanceOf(QueryTooBroadError);
  });

  it('shardHints ที่ไม่อยู่ใน manifest → InvalidShardPathError', async () => {
    setFakeResponses([]);
    await expect(getLines(['src-1'], ['ไม่มีอยู่จริง.parquet'])).rejects.toBeInstanceOf(
      InvalidShardPathError,
    );
  });

  it('คืนแถวเต็มทุกคอลัมน์เมื่อ shardHints ถูกต้อง', async () => {
    setFakeResponses([{ rows: [makeLineRecord({ source_id: 'src-1' })] }]);
    const rows = await getLines(['src-1'], ['budget_lines/act2570/15000.parquet']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.item_name_raw).toBe('เครื่องปรับอากาศ ขนาด 18000 บีทียู');
  });

  it('sourceIds ว่าง → คืน [] โดยไม่ query', async () => {
    const fakeDb = setFakeResponses([]);
    const rows = await getLines([], ['budget_lines/act2570/15000.parquet']);
    expect(rows).toEqual([]);
    expect(fakeDb.connection.preparedCalls).toHaveLength(0);
  });
});

describe('getDoc', () => {
  it('extracted: false → คืน note แทน chunks', async () => {
    vi.stubGlobal(
      'fetch',
      (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('sources.json')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  doc_id: 'd_scan',
                  rel_path: 'x.jpg',
                  kind: 'jpg',
                  bytes: 1,
                  sha1: 'a',
                  pages: null,
                  has_text_layer: null,
                  extracted: false,
                  title_guess: null,
                  collection: 'pbo',
                  meeting_no: null,
                  meeting_date: null,
                  topic: null,
                  agency_guess: null,
                  province: null,
                  gov_level: null,
                  level: null,
                  fiscal_years: [],
                  text_chunks_file: null,
                  n_chunks: null,
                  note: null,
                  duplicates: null,
                },
              ]),
              { status: 200 },
            ),
          );
        }
        return createFixtureFetch()(input);
      },
    );
    const result = await getDoc('d_scan');
    expect(result.chunks).toBeNull();
    expect(result.note).toContain('เอกสารนี้เป็นเอกสารสแกน');
  });

  it('extracted: true + มี text_chunks_file → คืน chunks จริง', async () => {
    const result = await getDoc('d_b2216ce7d082');
    expect(result.chunks).not.toBeNull();
    expect(result.chunks?.length).toBeGreaterThan(0);
  });

  it('doc_id ไม่พบ → DocNotFoundError', async () => {
    await expect(getDoc('d_ไม่มีจริง')).rejects.toBeInstanceOf(DocNotFoundError);
  });
});

describe('facets', () => {
  it('โหลด catalog/facets.json ได้ตาม schema', async () => {
    const result = await facets();
    expect(Array.isArray(result.datasets)).toBe(true);
  });
});

describe('budgetRepo — object รวม (ให้ ai/ mock ง่าย)', () => {
  it('เป็น object ที่มีครบทุกเมธอดตาม BudgetRepo', () => {
    expect(typeof budgetRepo.queryLines).toBe('function');
    expect(typeof budgetRepo.getLines).toBe('function');
    expect(typeof budgetRepo.getNeighborLines).toBe('function');
    expect(typeof budgetRepo.getDoc).toBe('function');
    expect(typeof budgetRepo.facets).toBe('function');
  });
});
