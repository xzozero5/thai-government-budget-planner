import { describe, expect, it } from 'vitest';
import { getKeyGateErrorMessage } from '@/features/keygate/errorCopy';
import { t } from '@/i18n';

describe('getKeyGateErrorMessage', () => {
  it('auth → ข้อความจาก copy.keygate.errorAuth', () => {
    expect(getKeyGateErrorMessage('auth', { modelLabel: 'Sonnet 5' })).toBe(t('keygate.errorAuth'));
  });

  it('permission → แทรกชื่อโมเดลที่เลือก', () => {
    const msg = getKeyGateErrorMessage('permission', { modelLabel: 'Opus 5 (ละเอียด)' });
    expect(msg).toContain('Opus 5 (ละเอียด)');
    expect(msg).toBe(t('keygate.errorPermission', { model: 'Opus 5 (ละเอียด)' }));
  });

  it('rate_limit → ข้อความจาก copy.keygate.errorRateLimit', () => {
    expect(getKeyGateErrorMessage('rate_limit', { modelLabel: 'Sonnet 5' })).toBe(
      t('keygate.errorRateLimit'),
    );
  });

  it('network → ข้อความจาก copy.keygate.errorNetwork', () => {
    expect(getKeyGateErrorMessage('network', { modelLabel: 'Sonnet 5' })).toBe(
      t('keygate.errorNetwork'),
    );
  });

  it('unknown → แทรกรายละเอียดที่ไม่ใช่รูปแบบ key', () => {
    const msg = getKeyGateErrorMessage('unknown', {
      modelLabel: 'Sonnet 5',
      detail: 'บางอย่างพัง',
    });
    expect(msg).toContain('บางอย่างพัง');
  });

  it('unknown ไม่มี detail → ใช้ค่า fallback ที่ไม่ใช่ค่าว่าง', () => {
    const msg = getKeyGateErrorMessage('unknown', { modelLabel: 'Sonnet 5' });
    expect(msg.length).toBeGreaterThan(0);
  });
});
