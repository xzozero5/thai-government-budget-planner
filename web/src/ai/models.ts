/**
 * T-301 — ตาราง capability ต่อรุ่น (ค่าคงที่ — ห้ามต่อท้ายวันที่เอง ตาม ADR-006 ข้อ 1)
 *
 * แหล่งอ้างอิง (bundled skill "claude-api", cache 2026-06-24 — ดู ADR-006 หัวไฟล์):
 * - รายชื่อ/ราคา: `shared/models.md` (Opus 5 "$5/$25 per MTok"), `shared/model-migration.md`
 *   บรรทัด "per-token pricing is lower than Sonnet 4.6: $2/$10 vs $3/$15 per MTok" (Sonnet 5),
 *   `python/claude-api/README.md` คอมเมนต์ "claude-haiku-4-5, # $1.00/$5.00 per 1M tokens"
 * - ตัวคูณ cache write/read (1.25×/0.1× ที่ TTL 5 นาทีเริ่มต้น): `shared/prompt-caching.md` §Economics
 *   (ใช้ได้ทั่วไปกับทั้ง 3 รุ่นนี้ — ข้อยกเว้น Fable 5.1 ไม่เกี่ยวกับโปรเจกต์นี้)
 * - ขั้นต่ำ prompt cache ต่อรุ่น: `shared/prompt-caching.md` ตาราง "Minimum cacheable prefix" —
 *   Sonnet 5 = 1024, Haiku 4.5 = 4096, Opus 5 = 512
 * - web search tool version ต่อรุ่น + ห้าม thinking/effort บน Haiku: ADR-006 ข้อ 2–3 (ตัดสินใจของ
 *   โปรเจกต์ ยืนยันแนวทางเดียวกับ `shared/tool-use-concepts.md` §Dynamic Filtering ที่ไม่รวม Haiku
 *   ไว้ในรายชื่อรุ่นที่รองรับ `web_search_20260209`)
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */

export const MODEL_IDS = ['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export type WebSearchToolType = 'web_search_20260209' | 'web_search_20250305';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelCapability {
  id: ModelId;
  /** ป้ายภาษาไทยที่ผู้ใช้เลือกใน settings (CLAUDE.md §7: UI ภาษาไทย) */
  labelTh: string;
  /** คำอธิบายสั้นผูกกับป้าย "ประหยัด/ปกติ/ละเอียด" (ADR-006 ข้อ 2) */
  descriptionTh: string;
  /** ราคาต่อ 1,000,000 token (USD) — input ที่ไม่ใช่ cache */
  pricePerMTokIn: number;
  /** ราคาต่อ 1,000,000 token (USD) — output */
  pricePerMTokOut: number;
  /** ตัวคูณของ pricePerMTokIn สำหรับ token ที่เขียนเข้า cache (ephemeral 5 นาที ค่าเริ่มต้นของแอปนี้) */
  cacheWriteMultiplier: number;
  /** ตัวคูณของ pricePerMTokIn สำหรับ token ที่อ่านจาก cache */
  cacheReadMultiplier: number;
  /** รองรับ `output_config.effort` หรือไม่ (Haiku 4.5 ไม่รองรับ — ส่งแล้ว error ตาม ADR-006 ข้อ 2) */
  supportsEffort: boolean;
  /** รองรับ `thinking: {type:"adaptive"}` หรือไม่ */
  supportsAdaptiveThinking: boolean;
  /** เวอร์ชัน server tool web_search ที่ต้องส่งให้รุ่นนี้ (ADR-006 ข้อ 3) */
  webSearchToolType: WebSearchToolType;
  /** ขั้นต่ำของ prefix ที่ cache ได้ (token) — ต่ำกว่านี้ `cache_control` จะไม่ error แต่ก็ไม่ cache จริง */
  minCacheablePrefixTokens: number;
  /** วันที่ตรวจราคา/ความสามารถล่าสุด (ISO date) */
  pricingCheckedAt: string;
  /** true = ยังไม่ได้ยืนยันกับหน้าราคาทางการโดยตรง (ดูคอมเมนต์ต่อค่าใน `MODEL_CAPABILITIES`) */
  pricingUnverified: boolean;
}

/** ค่าเริ่มต้นของแอป (ADR-006 ข้อ 1: default `claude-sonnet-5`) */
export const DEFAULT_MODEL_ID: ModelId = 'claude-sonnet-5';

/** ค่าเริ่มต้นของ `output_config.effort` เมื่อผู้ใช้ยังไม่เลือก (ADR-006 ข้อ 2: ผูกกับป้าย "ปกติ") */
export const DEFAULT_EFFORT: EffortLevel = 'medium';

const PRICING_CHECKED_AT = '2026-06-24';

/** ตัวคูณ cache ทั่วไปตาม `shared/prompt-caching.md` §Economics (TTL 5 นาที ค่าเริ่มต้นของแอปนี้ —
 * แอปนี้ไม่ใช้ TTL 1 ชั่วโมง เพราะ session สั้น ไม่คุ้มค่าธรรมเนียมเขียน 2×) */
const CACHE_WRITE_MULTIPLIER_5M = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export const MODEL_CAPABILITIES: Record<ModelId, ModelCapability> = {
  'claude-sonnet-5': {
    id: 'claude-sonnet-5',
    labelTh: 'Sonnet 5 (ปกติ)',
    descriptionTh: 'สมดุลระหว่างความเร็วและคุณภาพ — ค่าเริ่มต้นของแอป',
    // ตรวจแล้ว: shared/model-migration.md "per-token pricing is lower than Sonnet 4.6: $2/$10"
    pricePerMTokIn: 2,
    pricePerMTokOut: 10,
    cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER_5M,
    cacheReadMultiplier: CACHE_READ_MULTIPLIER,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
    webSearchToolType: 'web_search_20260209',
    // ตรวจแล้ว: shared/prompt-caching.md แถว "Opus 4.8, Claude Sonnet 5, Sonnet 4.6, ... | 1024"
    minCacheablePrefixTokens: 1024,
    pricingCheckedAt: PRICING_CHECKED_AT,
    pricingUnverified: false,
  },
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    labelTh: 'Haiku 4.5 (ประหยัด)',
    descriptionTh: 'เร็วและถูกที่สุด เหมาะกับงานถาม-ตอบเรียบง่าย/eval',
    // ตรวจแล้ว: python/claude-api/README.md คอมเมนต์ "claude-haiku-4-5, # $1.00/$5.00 per 1M tokens"
    pricePerMTokIn: 1,
    pricePerMTokOut: 5,
    cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER_5M,
    cacheReadMultiplier: CACHE_READ_MULTIPLIER,
    // ADR-006 ข้อ 2: "Haiku 4.5: ไม่ส่ง thinking และไม่ส่ง effort (รุ่นนี้ error)"
    supportsEffort: false,
    supportsAdaptiveThinking: false,
    webSearchToolType: 'web_search_20250305',
    // ตรวจแล้ว: shared/prompt-caching.md แถว "Opus 4.6, Opus 4.5, Haiku 4.5 | 4096"
    // (S3 วัดจริงบน Haiku 4.5: write/read 17,882 tokens ผ่านขั้นต่ำนี้ — ดู ADR-006/04 §D2)
    minCacheablePrefixTokens: 4096,
    pricingCheckedAt: PRICING_CHECKED_AT,
    pricingUnverified: false,
  },
  'claude-opus-5': {
    id: 'claude-opus-5',
    labelTh: 'Opus 5 (ละเอียด)',
    descriptionTh: 'ละเอียดที่สุด เหมาะกับโครงการซับซ้อน/เดิมพันสูง ราคาแพงกว่ารุ่นอื่นมาก',
    // ตรวจแล้ว: shared/models.md บรรทัด Opus 5 "at half the cost of ... ($5/$25 per MTok)"
    pricePerMTokIn: 5,
    pricePerMTokOut: 25,
    cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER_5M,
    cacheReadMultiplier: CACHE_READ_MULTIPLIER,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
    webSearchToolType: 'web_search_20260209',
    // ตรวจแล้ว: shared/prompt-caching.md แถว "Claude Opus 5, ... | 512 tokens"
    minCacheablePrefixTokens: 512,
    pricingCheckedAt: PRICING_CHECKED_AT,
    pricingUnverified: false,
  },
};

/** ลำดับคงที่ (deterministic) สำหรับ UI dropdown/settings — ห้ามสลับลำดับโดยไม่ตั้งใจ (ผลต่อ snapshot test) */
export const MODEL_LIST: ModelCapability[] = MODEL_IDS.map((id) => MODEL_CAPABILITIES[id]);

export function getModelCapability(id: ModelId): ModelCapability {
  return MODEL_CAPABILITIES[id];
}

export function isModelId(value: string): value is ModelId {
  return (MODEL_IDS as readonly string[]).includes(value);
}

/** [UNVERIFIED] (2026-06-24): ค่าธรรมเนียม web search ต่อครั้ง — reference bundle ยืนยันเฉพาะบริบท
 * Managed Agents (`shared/managed-agents-core.md`: "web searches at $10 per 1,000") ไม่ใช่ค่าที่ระบุตรง
 * ๆ สำหรับ server tool `web_search` บน Messages API แต่ ADR-006 (spike S3, วัดจริงในบราวเซอร์) สรุปตัวเลข
 * เดียวกัน (~$0.01/ครั้ง) จึงใช้ค่านี้เป็นค่าประมาณจนกว่าจะยืนยันกับหน้าราคาทางการของ Messages API โดยตรง
 */
export const WEB_SEARCH_COST_PER_REQUEST_USD = 0.01;

/** ADR-006 ข้อ 3: ลดจาก 5 (แผนเดิม) เหลือ 3 ต่อ turn เพื่อคุมต้นทุน */
export const WEB_SEARCH_MAX_USES = 3;

/** ADR-006 ข้อ 8: 16,000 ต่อ turn (ต่ำกว่าคำแนะนำ 64k ของ streaming โดยตั้งใจ — คุมต้นทุน; SVG ต้อง
 * ≥ 8,000 token จึงยังพอ ตาม T-309/spike S5) */
export const MAX_TOKENS_PER_TURN = 16_000;
