/**
 * T-403 — ประกอบ system prompt "ของจริง" สำหรับ production (facets/econ indicators จาก `@/data`
 * จริง + วันที่ปัจจุบันแบบไทย พ.ศ.) แล้วส่งต่อให้ `ai/systemPrompt.ts#buildSystemBlocks` (T-305)
 *
 * ย้าย logic มาจาก `web/src/app/dataHarness/AiEvalHarnessPage.tsx#buildSystemPromptInput`
 * (`KNOWN_ECON_INDICATORS`/`DATASET_NOTES_TH`/`formatTodayBe`) ตามที่ระบุไว้ใน task brief ของ T-403 —
 * ไฟล์ harness เดิมยังไม่ถูกแก้ให้เรียกฟังก์ชันนี้แทน (นอกขอบเขตงานนี้ ไม่ใช่ไฟล์ที่ agent นี้เป็นเจ้าของ)
 * เนื้อหาคงเดิมทุกตัวอักษรเพื่อไม่เปลี่ยนพฤติกรรมที่ T-306 เคยยืนยันแล้ว
 *
 * ห้าม import React/DOM API (module boundary — docs/04-ARCHITECTURE.md §3)
 */
import type Anthropic from '@anthropic-ai/sdk';
import { data as defaultDataFacade, type DataFacade, type EconIndicatorSeries } from '@/data';
import { buildSystemBlocks, type ChatMode } from '../systemPrompt';

// econ indicators ที่มีจริงใน `public/data/econ/indicators.json` ของ production (ยืนยันจริง — ดู
// รายงานปิดงาน T-306) — `buildSystemBlocks` ต้องการ "เฉพาะที่มีค่าจริง" (ดู docstring ของ
// `BuildSystemBlocksInput.econIndicators` ใน `ai/systemPrompt.ts`) จึงกรอง series ที่ทุกจุดเป็น null ทิ้ง
const KNOWN_ECON_INDICATORS = [
  'cmi_cement',
  'cmi_concrete',
  'cmi_electrical_plumbing',
  'cmi_other',
  'cmi_paint',
  'cmi_sanitary',
  'cmi_steel',
  'cmi_tiles',
  'cmi_wood',
  'construction_material_index',
  'cpi_headline_index',
  'gdp_growth_pct',
  'government_budget_total_mthb',
  'inflation_pct',
  'usd_thb_avg',
] as const;

/** สรุปข้อจำกัดของชุดข้อมูล (ADR-004/ADR-005/CLAUDE.md N4/T-114) — เนื้อหาเดียวกับที่ harness ของ T-306
 * ใช้อยู่แล้ว (คัดลอกมาโดยตั้งใจ ไม่ import ข้าม `app/dataHarness/**` เพราะโฟลเดอร์นั้นถูกตัดออกจาก
 * production bundle — ดู `vite.config.ts`) */
const DATASET_NOTES_TH: string[] = [
  'ปีงบประมาณ 2562 ของชุดข้อมูล PBO ไม่ครบทุกกระทรวง (ไฟล์ต้นทางส่งออกไม่สมบูรณ์ ~79% ของยอดรวมทั้งปี) — ดู ADR-004',
  'ข้อมูลของ อบต. ราชาเทวะ ถอดด้วยมือจากเอกสาร PDF ที่ไม่มี text layer (upstream_ocr) อาจมีตัวเลขคลาดเคลื่อนจากต้นฉบับ — ดู ADR-005',
  'PDF ที่ไม่มี text layer ระบบไม่ได้ทำ OCR จึงอ่านเนื้อหาไม่ได้ (ลงทะเบียนไว้เป็น metadata ใน sources.json เท่านั้น)',
  'search_catalog ครอบคลุมเฉพาะบางส่วนของบรรทัดงบทั้งหมด (ไม่ใช่ทุกรายการ) — รายการที่ไม่พบใน catalog ให้ลอง query_budget_lines ด้วย keyword ก่อนสรุปว่าไม่มีข้อมูล',
];

const THAI_MONTHS_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/** วันที่ปัจจุบันแบบไทย พ.ศ. เช่น "20 กันยายน 2569" — รับ `now` เป็น argument (default `new Date()`)
 * เพื่อให้ทดสอบ deterministic ได้ */
export function formatTodayBe(now: Date = new Date()): string {
  const month = THAI_MONTHS_TH[now.getMonth()];
  const yearBe = now.getFullYear() + 543;
  return `${String(now.getDate())} ${month ?? ''} ${String(yearBe)}`;
}

export interface BuildProductionSystemBlocksDeps {
  /** override สำหรับเทสต์/harness — ค่าเริ่มต้นคือ singleton จริงของ `@/data` */
  dataFacade?: DataFacade;
  /** override วันที่ปัจจุบัน — ค่าเริ่มต้นคือ `new Date()` */
  now?: Date;
}

/** ประกอบ system prompt ของจริง — เรียก `dataFacade.facets()` + `dataFacade.getEconSeries()` ต่อ
 * indicator ที่รู้จัก แล้วส่งต่อ `buildSystemBlocks` (T-305) พร้อมโหมด/วันที่ปัจจุบัน */
export async function buildProductionSystemBlocks(
  mode: ChatMode,
  deps: BuildProductionSystemBlocksDeps = {},
): Promise<Anthropic.TextBlockParam[]> {
  const dataFacade = deps.dataFacade ?? defaultDataFacade;
  const facets = await dataFacade.facets();
  const seriesList = await Promise.all(
    KNOWN_ECON_INDICATORS.map((indicator) => dataFacade.getEconSeries(indicator)),
  );
  const econIndicators = seriesList.filter(
    (s): s is EconIndicatorSeries => s !== null && s.points.length > 0,
  );
  return buildSystemBlocks({
    facets,
    econIndicators,
    datasetNotes: DATASET_NOTES_TH,
    coverageNotes: [],
    mode,
    todayBe: formatTodayBe(deps.now),
  });
}
