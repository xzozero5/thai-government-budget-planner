/**
 * T-205 — `econ/indicators.json` loader (lazy + cache) + accessors
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 * ห้าม fetch ข้าม origin (N5) — โหลดผ่าน `loadJson`/`dataUrl` ของ `manifest.ts` เท่านั้น (same-origin)
 *
 * กติกาสำคัญ (N3 + docs/econ-sources.md): **ทุกค่าใน econ/indicators.json มีสถานะ verified:false
 * เสมอ ณ วันนี้** — ห้ามประมาณ/interpolate ค่าที่เป็น `null`; ถ้าไม่มีค่าปีนั้นให้คืน `null` พร้อม `note`
 * ที่อธิบายว่าทำไม (ข้อมูลต้นทางมาพร้อม note นี้อยู่แล้ว)
 */
import { loadJson } from './manifest';
import {
  type EconIndicatorSeries,
  EconIndicatorsFileSchema,
  type EconIndicatorsFile,
} from './types';

// ---------------------------------------------------------------------------
// loadEcon — cache เป็น promise เดียวต่อ module (เหมือน loadManifest ใน manifest.ts)
// ---------------------------------------------------------------------------

let econPromise: Promise<EconIndicatorsFile> | null = null;

/** ล้าง cache ของ econ/indicators.json (ไว้ใช้ใน test เท่านั้น) */
export function resetEconCache(): void {
  econPromise = null;
}

/** โหลด `econ/indicators.json` (fetch + Zod validate) แบบ lazy — cache เป็น promise เดียวต่อ module */
export function loadEcon(fetchImpl: typeof fetch = fetch): Promise<EconIndicatorsFile> {
  econPromise ??= loadJson('econ/indicators.json', EconIndicatorsFileSchema, fetchImpl).catch(
    (err: unknown) => {
      // อย่า cache promise ที่ fail — ให้เรียกซ้ำครั้งถัดไปได้ (เช่น ตอนเน็ตกลับมา)
      econPromise = null;
      throw err;
    },
  );
  return econPromise;
}

// ---------------------------------------------------------------------------
// getEconSeries — คืน series view ของ indicator หนึ่งตัว (ใช้ทำกราฟ/ปรับเงินเฟ้อ)
// ---------------------------------------------------------------------------

/**
 * หา series ของ `indicator` จาก `econ/indicators.json` — คืน `null` เมื่อไม่มี series สำหรับ
 * indicator นั้นเลย (เช่น indicator ที่ทุกปีเป็น null ถูกตัดออกตอน publish — ดู docs/econ-sources.md)
 */
export async function getEconSeries(
  indicator: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EconIndicatorSeries | null> {
  const data = await loadEcon(fetchImpl);
  return data.series.find((s) => s.indicator === indicator) ?? null;
}

// ---------------------------------------------------------------------------
// getEconValue — ค่าตัวชี้วัดหนึ่งปี พร้อม metadata (ไม่เดา/ไม่ประมาณ)
// ---------------------------------------------------------------------------

export interface EconValueResult {
  value: number | null;
  unit: string;
  source_name: string;
  source_url: string;
  /**
   * ตาม docs/econ-sources.md: ทุก record ใน econ/indicators.json มีสถานะ verified:false เสมอ
   * ณ วันนี้ (ยังไม่มีใครตรวจสอบย้อนกลับไปต้นฉบับอีกครั้ง) — ฟิลด์นี้จึงเป็น literal `false` เสมอ
   * (ไม่ได้อ่านจาก record.verified) เพื่อบังคับให้ UI แสดงป้าย "ยังไม่ยืนยัน" เสมอจนกว่าจะมีคน
   * แก้โค้ดจุดนี้อย่างตั้งใจพร้อมตรวจสอบข้อมูลจริงแล้ว (กันไม่ให้ pipeline เผลอ mark verified:true
   * แล้วหลุดขึ้น UI โดยไม่มีใครทวนซ้ำที่นี่)
   */
  verified: false;
  note: string;
}

/**
 * ดึงค่าตัวชี้วัดหนึ่งปี (พ.ศ.) — คืน `null` เมื่อไม่มี record ของ indicator/ปีนี้เลยในไฟล์
 * (ต่างจากกรณี record มีอยู่แต่ `value` เป็น `null` — กรณีนั้นคืนผลลัพธ์ปกติที่ `value: null` พร้อม
 * `note` อธิบายเหตุผล, **ห้ามประมาณ/interpolate ค่าเอง (N3)**)
 */
export async function getEconValue(
  indicator: string,
  yearBe: number,
  fetchImpl: typeof fetch = fetch,
): Promise<EconValueResult | null> {
  const data = await loadEcon(fetchImpl);
  const record = data.records.find((r) => r.indicator === indicator && r.year_be === yearBe);
  if (!record) {
    return null;
  }
  return {
    value: record.value,
    unit: record.unit,
    source_name: record.source_name,
    source_url: record.source_url,
    verified: false,
    note: record.note,
  };
}
