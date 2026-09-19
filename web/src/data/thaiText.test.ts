import { describe, expect, it } from 'vitest';
import { foldThai, tokenizeThai, tokenizeThaiNgramFallback, TOKENIZER_VERSION } from './thaiText';

describe('TOKENIZER_VERSION', () => {
  it('เป็นสตริงคงที่ ไม่ว่าง (embed ลง search-index wrapper ตอน build)', () => {
    expect(typeof TOKENIZER_VERSION).toBe('string');
    expect(TOKENIZER_VERSION.length).toBeGreaterThan(0);
  });
});

describe('foldThai', () => {
  // เคสจริงจาก docs/02-DATA-INVENTORY.md §B: สระ/วรรณยุกต์หลุดตำแหน่งตอน extract PDF
  it('ตัดช่องว่างระหว่างอักษรไทยที่หลุดจาก PDF ("ส านักงาน" → "สานักงาน")', () => {
    expect(foldThai('ส านักงาน')).toBe('สานักงาน');
  });

  it('"จ านวน" → "จานวน"', () => {
    expect(foldThai('จ านวน')).toBe('จานวน');
  });

  it('"ล านบาท" (ล้านบาท ที่ ้ หายไป) ต้องกลายเป็น "ลานบาท" — ห้ามถูกตีความว่าเป็น "ำ" ที่หายไปแล้วพับเป็น "ลำนบาท"', () => {
    const folded = foldThai('ล านบาท');
    expect(folded).toBe('ลานบาท');
    expect(folded).not.toBe('ลำนบาท');
  });

  it('ข้อความปกติที่ไม่มีช่องว่างหลุดยังคงเดิม (แค่ lower + NFC)', () => {
    expect(foldThai('ล้านบาท')).toBe('ล้านบาท');
  });

  it('พับ ำ (U+0E33) → า', () => {
    expect(foldThai('สำนักงาน')).toBe(foldThai('ส านักงาน'));
    expect(foldThai('สำนักงาน')).toBe('สานักงาน');
  });

  it('พับรูปแตกของ ำ (นิคหิต ํ U+0E4D + สระอา า U+0E32) → า', () => {
    const broken = 'สํานักงาน'; // ส + ํ + า + นักงาน
    expect(foldThai(broken)).toBe('สานักงาน');
  });

  it('lower-case ตัวอักษรละติน', () => {
    expect(foldThai('CCTV กล้องวงจรปิด')).toBe('cctv กล้องวงจรปิด');
  });

  it('แปลงเลขไทยเป็นเลขอารบิก', () => {
    expect(foldThai('๑๘๐๐๐ บีทียู')).toBe('18000 บีทียู');
  });

  it('คงตัวเลข/ทศนิยมไว้ ตัด comma ที่เป็นตัวคั่นหลักพันออก', () => {
    expect(foldThai('ขนาด 18,000 บีทียู')).toBe('ขนาด 18000 บีทียู');
    // ใช้คำที่ไม่มี ำ (เพื่อไม่ปนกับกฎพับ ำ→า ข้อ 5 — ทดสอบแยกไว้แล้วด้านบน)
    expect(foldThai('ระยะทาง 3.5 กิโลเมตร')).toBe('ระยะทาง 3.5 กิโลเมตร');
  });

  it('ตัดวรรคตอนอื่น ๆ ที่ไม่ใช่ตัวเลข', () => {
    expect(foldThai('เครื่องปรับอากาศ (แบบแยกส่วน)')).toBe('เครื่องปรับอากาศ แบบแยกส่วน');
    expect(foldThai('กล้องวงจรปิด, CCTV')).toBe('กล้องวงจรปิด cctv');
  });

  it('deterministic: เรียกซ้ำด้วย input เดิมได้ผลเดิมเสมอ', () => {
    const input = 'เครื่องปรับอากาศ แบบแยกส่วนชนิดติดผนัง ขนาด 18,000 บีทียู (ส านักงาน)';
    expect(foldThai(input)).toBe(foldThai(input));
  });

  it('รวบช่องว่างซ้ำและ trim หัวท้าย (ช่องว่างที่ไม่ได้อยู่ระหว่างอักษรไทยสองฝั่ง)', () => {
    expect(foldThai('  18000   บีทียู  ')).toBe('18000 บีทียู');
  });

  it('ตัดช่องว่างระหว่างอักษรไทยแม้เป็นช่องว่างระหว่างคำปกติ — Thai script ปกติไม่เว้นวรรคระหว่างคำอยู่แล้ว จึงถือว่าเทียบเท่ากันเสมอ (`docs/decisions/SPIKES.md` §S2 ผล 6: ต้องพับแบบสมมาตรไม่มีข้อยกเว้น)', () => {
    expect(foldThai('ฝาย น้ำล้น')).toBe(foldThai('ฝายน้ำล้น'));
  });
});

describe('tokenizeThai', () => {
  it('fold ก่อนตัดคำเสมอ — "แอร์ 18,000  บีทียู" กับ "แอร์ 18000 บีทียู" ให้ token ชุดเดียวกัน', () => {
    expect(tokenizeThai('แอร์ 18,000  บีทียู')).toEqual(tokenizeThai('แอร์ 18000 บีทียู'));
  });

  it('เก็บ token ตัวเลข ("18000") ไว้ครบ ไม่ถูกกรองทิ้งเป็น punctuation', () => {
    const tokens = tokenizeThai('เครื่องปรับอากาศ ขนาด 18000 บีทียู');
    expect(tokens).toContain('18000');
  });

  it('เก็บ token ของหน่วย ("บีทียู" หรือพยางค์ย่อยของมัน) ไว้ครบ ไม่ถูกกรองทิ้งเป็นช่องว่าง/วรรคตอน', () => {
    const tokens = tokenizeThai('เครื่องปรับอากาศ ขนาด 18000 บีทียู');
    // Intl.Segmenter('th') ตัด "บีทียู" เป็นพยางค์ย่อย ("บี","ที","ยู") จริง (ยืนยันจาก
    // docs/decisions/SPIKES.md §S2 ผล 1 — ตรวจซ้ำใน Node ด้วย Intl.Segmenter ตัวเดียวกัน) สิ่งที่ต้อง
    // ยืนยันคือพยางค์เหล่านั้น "คงอยู่" ในผลลัพธ์ ไม่ถูกกรองทิ้งเป็น token ว่าง/วรรคตอน
    expect(tokens.join('')).toContain('บีทียู');
    expect(tokens).not.toContain('');
  });

  it('ไม่มี token ว่างหรือช่องว่างล้วนหลุดออกมา', () => {
    const tokens = tokenizeThai('ฝาย   น้ำล้น, (ชนิดหิน)');
    for (const t of tokens) {
      expect(t.trim().length).toBeGreaterThan(0);
    }
  });

  it('ค้น "สำนักงาน" (พิมพ์ปกติ) ต้องได้ token ชุดเดียวกับ "ส านักงาน" (สระหลุดจาก PDF)', () => {
    expect(tokenizeThai('สำนักงาน')).toEqual(tokenizeThai('ส านักงาน'));
  });

  it('input ว่าง → array ว่าง', () => {
    expect(tokenizeThai('')).toEqual([]);
    expect(tokenizeThai('   ')).toEqual([]);
  });

  it('deterministic', () => {
    const input = 'รถบรรทุกดีเซล ขนาด 1 ตัน ขับเคลื่อน 4 ล้อ';
    expect(tokenizeThai(input)).toEqual(tokenizeThai(input));
  });

  describe('fallback n-gram (inject getSegmenter: () => null)', () => {
    const noSegmenter = () => null;

    it('ใช้ n-gram (3) แทนเมื่อไม่มี Intl.Segmenter', () => {
      const tokens = tokenizeThai('เครื่องปรับอากาศ', { getSegmenter: noSegmenter });
      expect(tokens).toEqual(tokenizeThaiNgramFallback(foldThai('เครื่องปรับอากาศ')));
      // n-gram ต้องมีจำนวน token มากกว่าการตัดคำแบบ Intl.Segmenter ปกติของคำเดียวกันมาก
      expect(tokens.length).toBeGreaterThan(1);
    });

    it('คำสั้น (≤ 3 ตัวอักษร) ได้ token เดียว ไม่ตัด n-gram', () => {
      expect(tokenizeThai('ฝาย', { getSegmenter: noSegmenter })).toEqual(['ฝาย']);
    });

    it('เก็บตัวเลขเป็น token เดียว ไม่ตัด n-gram (ไม่ใช่อักษรไทย)', () => {
      const tokens = tokenizeThai('ขนาด 18000 บีทียู', { getSegmenter: noSegmenter });
      expect(tokens).toContain('18000');
    });

    it('folding ยังทำงานก่อน n-gram เสมอ ("สำนักงาน" กับ "ส านักงาน" ให้ผลเดียวกัน)', () => {
      expect(tokenizeThai('สำนักงาน', { getSegmenter: noSegmenter })).toEqual(
        tokenizeThai('ส านักงาน', { getSegmenter: noSegmenter }),
      );
    });
  });
});

describe('tokenizeThaiNgramFallback', () => {
  it('ตัด n-gram ความยาว 3 จากอักษรไทยต่อเนื่อง', () => {
    expect(tokenizeThaiNgramFallback('ฝายน้ำ')).toEqual(['ฝาย', 'ายน', 'ยน้', 'น้ำ']);
  });

  it('ไม่ตัด n-gram กับ chunk ที่ไม่ใช่อักษรไทย (ตัวเลข/ละติน)', () => {
    expect(tokenizeThaiNgramFallback('18000 cctv')).toEqual(['18000', 'cctv']);
  });
});
