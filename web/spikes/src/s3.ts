// S3 — @anthropic-ai/sdk เรียกตรงจาก browser
// N2: key ถูกส่งเข้ามาเป็น argument ตอน runtime เท่านั้น — ห้าม import.meta.env, ห้าม log, ห้ามเก็บลง storage
import Anthropic from '@anthropic-ai/sdk';

type Json = Record<string, unknown>;

const out = (m: string) => {
  const el = document.getElementById('out');
  if (el) el.textContent += m + '\n';
};

function client(key: string): Anthropic {
  return new Anthropic({
    apiKey: key,
    dangerouslyAllowBrowser: true,
    // header ที่เอกสารระบุสำหรับเรียกตรงจาก browser
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
    maxRetries: 0,
  });
}

/** (ก) CORS + header: count_tokens ไม่เสียค่า token */
async function ping(key: string, model: string): Promise<Json> {
  const t = performance.now();
  try {
    const r = await client(key).messages.countTokens({
      model,
      messages: [{ role: 'user', content: 'สวัสดี' }],
    });
    return { ok: true, ms: performance.now() - t, input_tokens: r.input_tokens };
  } catch (e) {
    return { ok: false, ms: performance.now() - t, error: describe(e) };
  }
}

function describe(e: unknown): Json {
  const err = e as { status?: number; name?: string; message?: string; error?: { error?: { type?: string } } };
  return {
    name: err?.name,
    status: err?.status,
    // ข้อความ error ของ SDK ไม่มี key แต่ตัด header ออกให้ชัวร์
    message: String(err?.message ?? e).slice(0, 300),
    type: err?.error?.error?.type,
  };
}

/** (ข) streaming */
async function streamTest(key: string, model: string): Promise<Json> {
  const t = performance.now();
  let firstTokenMs = 0;
  let text = '';
  let events = 0;
  try {
    const s = client(key).messages.stream({
      model,
      max_tokens: 120,
      messages: [{ role: 'user', content: 'ตอบสั้น ๆ 1 ประโยค: งบประมาณแผ่นดินคืออะไร' }],
    });
    s.on('text', (d: string) => {
      events += 1;
      if (!firstTokenMs) firstTokenMs = performance.now() - t;
      text += d;
    });
    const msg = await s.finalMessage();
    return {
      ok: true,
      ms_total: performance.now() - t,
      ms_first_token: firstTokenMs,
      text_events: events,
      text_len: text.length,
      text_head: text.slice(0, 120),
      usage: msg.usage as unknown as Json,
      stop_reason: msg.stop_reason,
    };
  } catch (e) {
    return { ok: false, ms_total: performance.now() - t, error: describe(e) };
  }
}

/** (ค) agent loop ที่มี client tool 1 ตัว (mock search_catalog คืน 2 แถว) */
async function toolLoop(key: string, model: string): Promise<Json> {
  const c = client(key);
  const tools = [
    {
      name: 'search_catalog',
      description: 'ค้นหารายการงบประมาณในอดีตจาก catalog ด้วยคำค้นภาษาไทย',
      input_schema: {
        type: 'object' as const,
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
    },
  ];
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'ราคากลางของเครื่องปรับอากาศ 18000 บีทียู ที่รัฐเคยตั้งงบคือเท่าไร ใช้ tool ค้นก่อนแล้วตอบสั้น ๆ' },
  ];
  const rounds: Json[] = [];
  const t = performance.now();
  try {
    for (let i = 0; i < 3; i++) {
      const msg = await c.messages.create({ model, max_tokens: 300, tools, messages });
      rounds.push({
        round: i,
        stop_reason: msg.stop_reason,
        usage: msg.usage as unknown as Json,
        blocks: msg.content.map((b) => b.type),
      });
      if (msg.stop_reason !== 'tool_use') {
        const txt = msg.content.find((b) => b.type === 'text');
        return {
          ok: true,
          ms: performance.now() - t,
          rounds,
          final_text: txt && txt.type === 'text' ? txt.text.slice(0, 250) : null,
        };
      }
      messages.push({ role: 'assistant', content: msg.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of msg.content) {
        if (b.type === 'tool_use') {
          results.push({
            type: 'tool_result',
            tool_use_id: b.id,
            content: JSON.stringify({
              rows: [
                { key: 'เครื่องปรับอากาศ ขนาด 18000 บีทียู', median_unit_price_thb: 24500, n: 53, source_id: 'a1b2c3d4e5f60708' },
                { key: 'แอร์ชนิดแขวน 18000 บีทียู', median_unit_price_thb: 27900, n: 6, source_id: '1122334455667788' },
              ],
              total: 2,
            }),
          });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    return { ok: true, ms: performance.now() - t, rounds, final_text: null, note: 'ครบ 3 รอบ' };
  } catch (e) {
    return { ok: false, ms: performance.now() - t, rounds, error: describe(e) };
  }
}

/** (ง) server tool web search — 1 ครั้งเท่านั้น */
async function webSearch(key: string, model: string, toolType: string): Promise<Json> {
  const t = performance.now();
  try {
    const msg = await client(key).messages.create({
      model,
      max_tokens: 300,
      tools: [{ type: toolType, name: 'web_search', max_uses: 1 } as unknown as Anthropic.ToolUnion],
      messages: [{ role: 'user', content: 'ราคาเครื่องปรับอากาศ 18000 BTU ในไทยตอนนี้ประมาณเท่าไร ตอบสั้น ๆ พร้อมแหล่งอ้างอิง' }],
    });
    return {
      ok: true,
      ms: performance.now() - t,
      usage: msg.usage as unknown as Json,
      block_types: msg.content.map((b) => b.type),
      citations: msg.content
        .filter((b) => b.type === 'text')
        .flatMap((b) => ((b as { citations?: { url?: string; title?: string }[] }).citations ?? []).map((c) => c.url))
        .slice(0, 5),
      text_head: (msg.content.find((b) => b.type === 'text') as { text?: string } | undefined)?.text?.slice(0, 200) ?? null,
    };
  } catch (e) {
    return { ok: false, ms: performance.now() - t, error: describe(e) };
  }
}

/** (จ) prompt caching: ยิง 2 ครั้งด้วย system block ยาวเกินขั้นต่ำของ model */
async function caching(key: string, model: string, systemText: string): Promise<Json> {
  const c = client(key);
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
  ];
  const calls: Json[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const t = performance.now();
      const msg = await c.messages.create({
        model,
        max_tokens: 40,
        system,
        messages: [{ role: 'user', content: i === 0 ? 'ตอบว่า OK' : 'ตอบว่า OK2' }],
      });
      calls.push({ call: i, ms: performance.now() - t, usage: msg.usage as unknown as Json });
    }
    return { ok: true, calls, system_chars: systemText.length };
  } catch (e) {
    return { ok: false, calls, error: describe(e) };
  }
}


/** S5: ให้ Claude สร้าง SVG ตามข้อจำกัดใน 04 §D9 */
async function generateSvg(key: string, model: string, system: string, prompt: string, maxTokens = 4000): Promise<Json> {
  const t = performance.now();
  try {
    const msg = await client(key).messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const m = /<svg[\s\S]*?<\/svg>/i.exec(text);
    return {
      ok: true,
      ms: performance.now() - t,
      usage: msg.usage as unknown as Json,
      stop_reason: msg.stop_reason,
      text_len: text.length,
      svg: m ? m[0] : null,
      svg_bytes: m ? new TextEncoder().encode(m[0]).length : 0,
    };
  } catch (e) {
    return { ok: false, ms: performance.now() - t, error: describe(e) };
  }
}

/** ตรวจ N2: key ต้องไม่ถูกเขียนลง storage ใด ๆ */
function storageAudit(): Json {
  const ls: string[] = [];
  const ss: string[] = [];
  for (let i = 0; i < localStorage.length; i++) ls.push(localStorage.key(i)!);
  for (let i = 0; i < sessionStorage.length; i++) ss.push(sessionStorage.key(i)!);
  return { localStorage_keys: ls, sessionStorage_keys: ss, cookie_len: document.cookie.length };
}

declare global {
  interface Window {
    __s3: {
      ping: typeof ping;
      streamTest: typeof streamTest;
      toolLoop: typeof toolLoop;
      webSearch: typeof webSearch;
      caching: typeof caching;
      storageAudit: typeof storageAudit;
      generateSvg: typeof generateSvg;
      ready: boolean;
    };
  }
}
window.__s3 = { ping, streamTest, toolLoop, webSearch, caching, storageAudit, generateSvg, ready: true };
out('s3 loaded');
