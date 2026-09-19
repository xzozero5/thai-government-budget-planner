// อ่าน API key ฝั่ง Node เท่านั้น (N2) — ห้าม print/เขียนลงไฟล์/ใส่ใน URL
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE_DIR } from './harness.mjs';

export function readApiKey() {
  const file = join(SPIKE_DIR, '..', '.env.local'); // web/.env.local
  const txt = readFileSync(file, 'utf8');
  const m = /^\s*VITE_EVAL_ANTHROPIC_API_KEY\s*=\s*(.+)\s*$/m.exec(txt);
  if (!m) throw new Error('ไม่พบ VITE_EVAL_ANTHROPIC_API_KEY ใน web/.env.local');
  const key = m[1].trim().replace(/^["']|["']$/g, '');
  if (!key.startsWith('sk-ant-')) throw new Error('รูปแบบ key ไม่ถูกต้อง');
  return key;
}

/** ราคา ณ วันที่ตรวจ (docs.claude.com/en/docs/about-claude/pricing 20 ก.ย. 2569) — USD ต่อ 1M tokens */
export const PRICING = {
  source: 'https://docs.claude.com/en/docs/about-claude/pricing',
  checked_at: '2026-09-20',
  models: {
    'claude-haiku-4-5-20251001': { input: 1, cache_write_5m: 1.25, cache_read: 0.1, output: 5 },
    'claude-sonnet-5': { input: 2, cache_write_5m: 2.5, cache_read: 0.2, output: 10 },
    'claude-sonnet-4-5-20250929': { input: 3, cache_write_5m: 3.75, cache_read: 0.3, output: 15 },
  },
  web_search_per_request_usd: 0.01, // $10 / 1,000 searches
};

export function estimateCost(model, usage) {
  const p = PRICING.models[model];
  if (!p || !usage) return 0;
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  const ws = usage.server_tool_use?.web_search_requests ?? 0;
  return (
    (inTok * p.input + outTok * p.output + cw * p.cache_write_5m + cr * p.cache_read) / 1e6 +
    ws * PRICING.web_search_per_request_usd
  );
}
