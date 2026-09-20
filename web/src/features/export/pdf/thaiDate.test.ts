import { describe, expect, it } from 'vitest';
import { formatThaiBuddhistDate, formatThaiBuddhistDateTime } from './thaiDate';

describe('formatThaiBuddhistDate', () => {
  it('แสดงวัน เดือนเต็มภาษาไทย ปี พ.ศ. (ค.ศ. 2026 → พ.ศ. 2569)', () => {
    const date = new Date(2026, 8, 20); // 20 กันยายน 2026
    expect(formatThaiBuddhistDate(date)).toBe('20 กันยายน 2569');
  });
});

describe('formatThaiBuddhistDateTime', () => {
  it('มีทั้งวันที่ พ.ศ. และเวลาแบบ 24 ชม. ต่อท้ายด้วย น.', () => {
    const date = new Date(2026, 8, 20, 14, 5);
    const out = formatThaiBuddhistDateTime(date);
    expect(out).toContain('2569');
    expect(out).toContain('14:05');
    expect(out.endsWith('น.')).toBe(true);
  });
});
