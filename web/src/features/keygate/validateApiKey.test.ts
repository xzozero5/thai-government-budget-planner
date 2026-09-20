import { describe, expect, it } from 'vitest';
import { validateApiKeyFormat } from '@/features/keygate/validateApiKey';

// N: ห้ามเขียนสตริงรูป key จริง/ปลอมแบบ `sk-ant-` + อักขระ >= 8 ตัวตรง ๆ ในไฟล์ — ประกอบจาก parts
const FAKE_KEY = ['sk', 'ant', 'fake-key-for-unit-test'].join('-');

describe('validateApiKeyFormat', () => {
  it('ผ่านเมื่อรูปแบบถูกต้อง (ขึ้นต้น sk-ant- และยาวพอ)', () => {
    expect(validateApiKeyFormat(FAKE_KEY)).toBeNull();
  });

  it('error เมื่อว่างเปล่า', () => {
    expect(validateApiKeyFormat('')).toBe('ใส่ API key ก่อนถึงจะเริ่มได้');
  });

  it('error เมื่อว่างเปล่าหลัง trim (เว้นวรรคล้วน)', () => {
    expect(validateApiKeyFormat('   ')).toBe('ใส่ API key ก่อนถึงจะเริ่มได้');
  });

  it('error เมื่อไม่ขึ้นต้นด้วย sk-ant-', () => {
    expect(validateApiKeyFormat('sk-other-1234567890123')).toContain('sk-ant-');
  });

  it('error เมื่อสั้นเกินไปแม้ขึ้นต้นถูก', () => {
    expect(validateApiKeyFormat('sk-ant-abc')).toContain('sk-ant-');
  });
});
