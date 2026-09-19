import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from './index';

describe('i18n', () => {
  it('สำเนาใน src/i18n ต้องตรงกับต้นฉบับ docs/ui/copy.th.json ทุกตัวอักษร', () => {
    const source = readFileSync(join(__dirname, '../../../docs/ui/copy.th.json'), 'utf8');
    const bundled = readFileSync(join(__dirname, 'copy.th.json'), 'utf8');
    expect(bundled).toBe(source);
  });

  it('t() คืนข้อความและแทน placeholder', () => {
    expect(t('keygate.apiKeyPlaceholder')).toContain('sk-ant-');
    expect(t('keygate.apiKeyFormat').length).toBeGreaterThan(10);
  });

  it('placeholder ที่ไม่ได้ส่งค่า คงรูปเดิมไว้ (ไม่กลายเป็น undefined)', () => {
    const raw = t('keygate.apiKeyFormat');
    expect(t('keygate.apiKeyFormat', { unused: 1 })).toBe(raw);
  });
});
