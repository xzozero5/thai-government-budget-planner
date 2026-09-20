import { describe, expect, it } from 'vitest';
import { buildTgbpFileName } from './fileNames';

describe('buildTgbpFileName', () => {
  it('ต่อท้ายด้วย .tgbp.json', () => {
    expect(buildTgbpFileName('โครงการทดสอบ')).toBe('โครงการทดสอบ.tgbp.json');
  });

  it('ตัดอักขระต้องห้ามของ Windows ออก', () => {
    const name = buildTgbpFileName('โครงการ: <ทดสอบ> / "งบ" | ผิด?*');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name.endsWith('.tgbp.json')).toBe(true);
  });

  it('ชื่อว่าง/มีแต่อักขระต้องห้าม → ใช้ชื่อสำรอง', () => {
    expect(buildTgbpFileName('')).toBe('ข้อเสนอโครงการ.tgbp.json');
    expect(buildTgbpFileName('///???')).toBe('ข้อเสนอโครงการ.tgbp.json');
  });

  it('ไม่ลงท้ายด้วยจุด/ช่องว่างก่อนนามสกุล', () => {
    const name = buildTgbpFileName('ชื่อโครงการ.   ');
    expect(name).toBe('ชื่อโครงการ.tgbp.json');
  });

  it('ตัดความยาวไม่ให้เกินเพดาน', () => {
    const longTitle = 'ก'.repeat(300);
    const name = buildTgbpFileName(longTitle);
    expect(name.length).toBeLessThan(300);
    expect(name.endsWith('.tgbp.json')).toBe(true);
  });
});
