/**
 * T-308 (prompt-tuning รอบ 1, งาน B2) — `computeImpliedUnitPriceHint`: pure function หา "ฐานร่วม"
 * (ตัวหารร่วมที่เป็นไปได้ว่าเป็นราคาต่อหน่วย) ของชุด `amount_thb` ที่ `query_budget_lines` คืนมา เมื่อ
 * แถวส่วนใหญ่เป็น `price_basis="amount_per_line"` (ยอดต่อบรรทัดงบ ไม่ใช่ราคาต่อหน่วย — ดูคอมเมนต์หัวไฟล์
 * `queryBudgetLines.ts`) เพื่อลดโอกาสที่โมเดลจะเอายอดต่อบรรทัดไปตั้งเป็นราคาต่อหน่วยตรง ๆ (เคสจริงที่พบ:
 * แอร์ 18000 บีทียู ปี 2568 — ยอด 279,000/223,200/139,500 = 27,900×10/8/5 และ 335,000/134,000/
 * 100,500/67,000/33,500 = 33,500×10/4/3/2/1)
 *
 * หลักการ (เอกสารประกอบการตัดสินใจ — ไม่มีสเปกภายนอกที่ตายตัวกว่านี้ จึงออกแบบเองโดยยึดหลัก "ไม่มั่นใจ
 * แล้วไม่คืน" เป็นหลัก N3):
 * 1. ต้องมีอย่างน้อย `MIN_ROWS` แถว (ค่าเดียว/แถวเดียวไม่มีทางพิสูจน์ว่าเป็น "ฐานร่วม" ได้ — คืน `null`)
 * 2. หา GCD ของ "ทุกแถว" ก่อน (support = 100%) — ถ้า GCD นั้นผ่านเกณฑ์ทั้งหมดด้านล่าง ใช้เลย
 * 3. ถ้าไม่ผ่าน ลองตัดแถว "ส่วนน้อย" ออกทีละ 1 ถึง `MAX_DROPPED_ROWS` แถว (ทุก combination ที่เป็นไปได้)
 *    แล้วหา GCD ของแถวที่เหลือ ยอมรับได้ตราบใดที่ยังเหลือ ≥ `MIN_SUPPORT_RATIO` (60%) ของแถวทั้งหมด —
 *    ใช้ GCD ของ "เซตย่อยที่เป็นไปได้จริง" เท่านั้น (ไม่ไล่ตัวหารของ GCD เต็มเซตลงไปเรื่อย ๆ) เพราะการไล่
 *    ตัวหารของเลขกลม ๆ (เช่น GCD(100000,200000,500000)=100000) จะลงไปเจอ "ฐานร่วมเล็กเกินจริง" ที่ยัง
 *    หารลงตัวพอดีโดยบังเอิญ (เช่น 25,000) ทั้งที่ไม่มีความหมายอะไรเป็นพิเศษ — ตัดปัญหานี้ด้วยการใช้ GCD ของ
 *    เซตย่อยจริงเท่านั้น (เซตย่อยของเลขกลมยังคง GCD กลมเท่าเดิมเสมอ จึงถูกกรองด้วยกฎข้อ 5 ต่อไป)
 * 4. ฐาน (GCD) ต้อง ≥ 1% ของค่ามัธยฐานของทุกแถว (กันฐานเล็กเกินจริงเทียบกับขนาดข้อมูลจริง) และตัวคูณ
 *    (amount / ฐาน) ของทุกแถวที่นับเป็น support ต้องอยู่ในช่วง 1..200 (จำนวนที่ซื้อจริงไม่ควรเกินนี้)
 *    พร้อมต้องมีตัวคูณที่ต่างกันอย่างน้อย 2 ค่า (ถ้าทุกแถวมีตัวคูณเท่ากันหมด ไม่มีหลักฐานว่าเป็น "ตัวคูณ"
 *    จริง ๆ อาจแค่บังเอิญยอดเท่ากัน)
 * 5. ปฏิเสธฐานที่ "กลมเกินไป" — ฐาน ≥ 10,000 แต่มีเลขนัยสำคัญ (ตัด 0 ท้ายออกแล้ว) ≤ 1 หลัก (เช่น 100,000/
 *    50,000/20,000/10,000) ถือว่าน่าจะเป็นยอดงบกลม ๆ ที่บังเอิญมีตัวหารร่วม ไม่ใช่ราคาต่อหน่วยจริง — ฐาน
 *    ที่ผ่านเกณฑ์อื่นเช่น 27,900/33,500 (เลขนัยสำคัญ 3 หลัก) ไม่ถูกกระทบ
 */

export interface ImpliedUnitPriceHint {
  value_thb: number;
  support_rows: number;
  total_rows: number;
  method_th: string;
  label: 'estimate';
}

const MIN_ROWS = 3;
const MIN_SUPPORT_RATIO = 0.6;
const MIN_DISTINCT_MULTIPLIERS = 2;
const MAX_MULTIPLIER = 200;
const MIN_BASE_RATIO_OF_MEDIAN = 0.01;
const ROUND_NUMBER_MIN_BASE = 10_000;
const ROUND_NUMBER_MAX_SIGFIGS = 1;
/** จำกัดจำนวนแถวที่ยอมตัดออกตอนหา GCD ของเซตย่อย (ดูข้อ 3 ในคอมเมนต์หัวไฟล์) — ค่านี้เล็กพอที่จำนวน
 * combination (n เลือก k) ยังคำนวณไหวเสมอสำหรับ n ≤ 50 (เพดานผลลัพธ์ tool ตาม toolKit.ts) */
const MAX_DROPPED_ROWS = 3;

function gcdTwo(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

function gcdAll(values: readonly number[]): number {
  return values.reduce((acc, v) => gcdTwo(acc, v));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid];
  const prevValue = sorted[mid - 1];
  if (midValue === undefined) return 0;
  return sorted.length % 2 === 0 && prevValue !== undefined ? (prevValue + midValue) / 2 : midValue;
}

/** จำนวนเลขนัยสำคัญของจำนวนเต็มบวก หลังตัดเลข 0 ท้ายออก (100000 → "1" → 1, 27900 → "279" → 3) */
function significantDigitCount(value: number): number {
  const stripped = Math.trunc(Math.abs(value)).toString().replace(/0+$/, '');
  return stripped.length === 0 ? 1 : stripped.length;
}

function isTooRound(base: number): boolean {
  return base >= ROUND_NUMBER_MIN_BASE && significantDigitCount(base) <= ROUND_NUMBER_MAX_SIGFIGS;
}

interface CandidateCheck {
  ok: boolean;
  distinctMultiplierCount: number;
}

/** ตรวจว่า `base` ใช้เป็นฐานร่วมของ `subset` ได้จริงไหม (ตัวคูณทุกตัว 1..200 และมีตัวคูณต่างกัน ≥2 ค่า) —
 * เรียกหลังยืนยันแล้วว่า `base = gcdAll(subset)` เสมอ (ตัวคูณทุกตัวจึงเป็นจำนวนเต็มโดยอัตโนมัติ) */
function checkCandidate(subset: readonly number[], base: number): CandidateCheck {
  if (base <= 0) return { ok: false, distinctMultiplierCount: 0 };
  const multipliers = new Set<number>();
  for (const amount of subset) {
    const multiplier = amount / base;
    if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > MAX_MULTIPLIER) {
      return { ok: false, distinctMultiplierCount: 0 };
    }
    multipliers.add(multiplier);
  }
  return { ok: true, distinctMultiplierCount: multipliers.size };
}

/** ดัชนีของทุก combination ขนาด `size` จาก `0..n-1` (เรียงแบบ deterministic เสมอ — n ≤ 50 และ
 * `size ≤ MAX_DROPPED_ROWS` จึงจำนวน combination จำกัดเสมอ ไม่มีความเสี่ยง blow up) */
function* combinations(n: number, size: number): Generator<number[]> {
  if (size === 0) {
    yield [];
    return;
  }
  const indices = Array.from({ length: size }, (_, i) => i);
  for (;;) {
    yield [...indices];
    let i = size - 1;
    while (i >= 0 && indices[i] === n - size + i) i -= 1;
    if (i < 0) return;
    const current = indices[i];
    if (current === undefined) return;
    indices[i] = current + 1;
    for (let j = i + 1; j < size; j += 1) {
      const prev = indices[j - 1];
      if (prev === undefined) return;
      indices[j] = prev + 1;
    }
  }
}

/**
 * หาฐานร่วม (implied unit price) ของ `amounts` — คืน `null` เมื่อไม่มั่นใจ (N3: ห้ามเดา) ดูหลักการเต็มที่
 * คอมเมนต์หัวไฟล์ ผู้เรียก (`queryBudgetLines.ts`) ส่งเฉพาะ `amount_thb` ของแถวที่ `price_basis ===
 * "amount_per_line"` เข้ามาเท่านั้น (ฟังก์ชันนี้เองไม่ตัดสินใจเรื่อง price_basis)
 */
export function computeImpliedUnitPriceHint(
  amounts: readonly (number | null | undefined)[],
): ImpliedUnitPriceHint | null {
  const positive = amounts.filter(
    (a): a is number => typeof a === 'number' && Number.isFinite(a) && a > 0,
  );
  const totalRows = positive.length;
  if (totalRows < MIN_ROWS) return null;

  const med = median(positive);
  const minBase = med * MIN_BASE_RATIO_OF_MEDIAN;
  // main thread review: support ขั้นต่ำ 3 แถว (= MIN_ROWS) — GCD ของ 2 แถวเป็นหลักฐานอ่อนเกินไป
  // (เคสโจมตี [279000, 223200, 139499] เคยได้ 55,800 จาก 2 แถว ทั้งที่ฐานจริงคือ 27,900)
  const minSupport = Math.max(Math.ceil(totalRows * MIN_SUPPORT_RATIO), MIN_ROWS);
  const maxDropped = Math.min(MAX_DROPPED_ROWS, totalRows - minSupport);

  for (let dropped = 0; dropped <= maxDropped; dropped += 1) {
    const keepSize = totalRows - dropped;
    let best: { base: number; distinctMultiplierCount: number } | null = null;
    for (const dropIdx of combinations(totalRows, dropped)) {
      const dropSet = new Set(dropIdx);
      const subset = positive.filter((_, i) => !dropSet.has(i));
      const base = gcdAll(subset);
      if (base < minBase || isTooRound(base)) continue;
      const check = checkCandidate(subset, base);
      if (!check.ok || check.distinctMultiplierCount < MIN_DISTINCT_MULTIPLIERS) continue;
      if (best === null || base > best.base) {
        best = { base, distinctMultiplierCount: check.distinctMultiplierCount };
      }
    }
    if (best !== null) {
      return {
        value_thb: best.base,
        support_rows: keepSize,
        total_rows: totalRows,
        method_th:
          `พบว่า ${String(keepSize)} จาก ${String(totalRows)} แถวหารด้วย ${best.base.toLocaleString('th-TH')} ` +
          'บาทลงตัวเป็นจำนวนเต็ม (คนละตัวคูณกัน) จึงประมาณว่าอาจเป็นราคาต่อหน่วยร่วมของรายการนี้ — ยังไม่ยืนยัน',
        label: 'estimate',
      };
    }
  }
  return null;
}
