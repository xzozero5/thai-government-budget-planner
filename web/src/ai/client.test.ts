import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { classifyVerifyKeyError, createClient, verifyKey } from './client';

function makeApiError(status: number, type: string): APIError {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message: 'boom' } },
    'boom',
    new Headers(),
  );
}

describe('createClient', () => {
  it('สร้าง Anthropic client จาก apiKey ที่รับเป็น argument เท่านั้น (N2 — ไม่แตะ storage)', () => {
    const client = createClient('fake-key-for-unit-test');
    expect(client).toBeInstanceOf(Anthropic);
  });
});

describe('classifyVerifyKeyError', () => {
  it('แยกชนิด error ด้วย typed exception ของ SDK (ห้าม string-match)', () => {
    expect(classifyVerifyKeyError(makeApiError(401, 'authentication_error'))).toBe('auth');
    expect(classifyVerifyKeyError(makeApiError(403, 'permission_error'))).toBe('permission');
    expect(classifyVerifyKeyError(makeApiError(429, 'rate_limit_error'))).toBe('rate_limit');
    expect(classifyVerifyKeyError(new Anthropic.APIConnectionError({ message: 'net down' }))).toBe('network');
    expect(classifyVerifyKeyError(makeApiError(500, 'api_error'))).toBe('unknown');
    expect(classifyVerifyKeyError(new Error('เหตุผลอื่น'))).toBe('unknown');
  });
});

describe('verifyKey', () => {
  it('สำเร็จ → {ok:true}', async () => {
    const client = createClient('fake-key-for-unit-test');
    vi.spyOn(client.messages, 'countTokens').mockResolvedValue({ input_tokens: 12 });
    const result = await verifyKey(client, 'claude-sonnet-5');
    expect(result).toEqual({ ok: true });
  });

  it('401 → kind auth พร้อมข้อความไทย', async () => {
    const client = createClient('fake-key-for-unit-test');
    vi.spyOn(client.messages, 'countTokens').mockRejectedValue(makeApiError(401, 'authentication_error'));
    const result = await verifyKey(client, 'claude-sonnet-5');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('auth');
      expect(result.messageTh.length).toBeGreaterThan(0);
    }
  });

  it('network error → kind network', async () => {
    const client = createClient('fake-key-for-unit-test');
    vi.spyOn(client.messages, 'countTokens').mockRejectedValue(
      new Anthropic.APIConnectionError({ message: 'down' }),
    );
    const result = await verifyKey(client, 'claude-sonnet-5');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network');
    }
  });
});
