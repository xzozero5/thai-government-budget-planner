// บันทึกค่าใช้จ่าย API ของ spike (ไม่มี key) → web/spikes/api-spend.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE_DIR } from './harness.mjs';
import { PRICING, estimateCost } from './key.mjs';

const FILE = join(SPIKE_DIR, 'api-spend.json');

export function loadLedger() {
  if (!existsSync(FILE)) return { price_source_url: PRICING.source, price_checked_at: PRICING.checked_at, entries: [] };
  return JSON.parse(readFileSync(FILE, 'utf8'));
}

export function record(spike, model, label, usage) {
  const l = loadLedger();
  const cost = estimateCost(model, usage);
  l.entries.push({
    at: new Date().toISOString(),
    spike,
    label,
    model,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_read: usage?.cache_read_input_tokens ?? 0,
    cache_creation: usage?.cache_creation_input_tokens ?? 0,
    web_search_requests: usage?.server_tool_use?.web_search_requests ?? 0,
    est_cost_usd: Number(cost.toFixed(6)),
    price_source_url: PRICING.source,
  });
  l.total_usd = Number(l.entries.reduce((a, b) => a + b.est_cost_usd, 0).toFixed(6));
  writeFileSync(FILE, JSON.stringify(l, null, 2), 'utf8');
  return { cost, total: l.total_usd };
}

export function total() {
  return loadLedger().total_usd ?? 0;
}
