/**
 * T-501 — เก็บ/เรียงเลข [n] ของ citation ทุกชนิดที่ปรากฏใน proposal เดียว (BOQ + audit findings +
 * citations_web) ให้เลขเดียวกันเมื่อเป็น citation เดียวกัน (dedupe) — ใช้ทั้งในตาราง BOQ (แสดง `[n]`)
 * และภาคผนวกท้ายเอกสาร (รายละเอียดเต็มเรียงตามเลข) pure function ล้วน ๆ แยกจาก component ตาม CLAUDE.md §7
 */
import type {
  AuditFinding,
  BoqLine,
  Citation,
  Proposal,
  WebCitation,
} from '@/ai/tools/proposal';

export interface CitationEntry {
  citation: Citation;
  index: number;
}

/** คีย์สำหรับ dedupe — citation ที่ชี้ไปข้อมูลเดียวกันต้องได้เลขเดียวกัน */
export function citationDedupeKey(c: Citation): string {
  switch (c.kind) {
    case 'budget_line':
      return `budget_line:${c.source_id}`;
    case 'document':
      return `document:${c.doc_id}:${String(c.page ?? '')}`;
    case 'econ':
      return `econ:${c.indicator}:${String(c.year_be)}`;
    case 'web':
      return `web:${c.url}`;
  }
}

function webCitationToCitation(w: WebCitation): Citation {
  return {
    kind: 'web',
    url: w.url,
    retrieved_at: w.retrieved_at,
    ...(w.title !== undefined ? { title: w.title } : {}),
    ...(w.price_note !== undefined ? { price_note: w.price_note } : {}),
  };
}

/**
 * สร้าง registry เรียงเลข [1..n] ตามลำดับที่พบครั้งแรก: `citations_web` (ระดับ proposal) ก่อน แล้วค่อย
 * BOQ ตามลำดับบรรทัด แล้ว audit findings — เพื่อให้ web citation ที่ระบุไว้ระดับ proposal ได้เลขต้น ๆ
 * เสมอไม่ว่าจะถูกอ้างซ้ำจากบรรทัดไหน
 */
export function buildCitationRegistry(
  proposal: Pick<Proposal, 'citations_web' | 'boq' | 'audit_findings'>,
): CitationEntry[] {
  const seen = new Map<string, number>();
  const entries: CitationEntry[] = [];

  function add(c: Citation): number {
    const key = citationDedupeKey(c);
    const existing = seen.get(key);
    if (existing !== undefined) return existing;
    const index = entries.length + 1;
    seen.set(key, index);
    entries.push({ citation: c, index });
    return index;
  }

  for (const w of proposal.citations_web) add(webCitationToCitation(w));
  for (const line of proposal.boq) for (const c of line.citations) add(c);
  for (const f of proposal.audit_findings ?? []) for (const c of f.citations) add(c);

  return entries;
}

export type CitationIndexLookup = ReadonlyMap<string, number>;

/** สร้าง lookup key(citation) -> เลข [n] จาก registry — ใช้ที่ตารางเพื่อเลี่ยงสร้าง registry ซ้ำ */
export function toCitationIndexLookup(entries: readonly CitationEntry[]): CitationIndexLookup {
  const map = new Map<string, number>();
  for (const e of entries) map.set(citationDedupeKey(e.citation), e.index);
  return map;
}

/** เลข [n] ของ citation แต่ละอัน (เรียงตามลำดับเดิมของ `citations`) — คืน `[]` ถ้าไม่พบใน registry */
export function citationIndexesFor(
  citations: readonly Citation[],
  lookup: CitationIndexLookup,
): number[] {
  const indexes: number[] = [];
  for (const c of citations) {
    const idx = lookup.get(citationDedupeKey(c));
    if (idx !== undefined) indexes.push(idx);
  }
  return indexes;
}

/** BOQ line ทุกบรรทัดที่ basis != estimate ต้องมี citation (N3) — ใช้เช็คว่าควรเตือนอะไรเพิ่มใน PDF ไหม */
export function boqLineNeedsCitationWarning(line: Pick<BoqLine, 'basis' | 'citations'>): boolean {
  return line.basis !== 'estimate' && line.citations.length === 0;
}

/** รวม citation ทั้งหมดของ audit finding หนึ่งรายการเป็นเลข [n] เรียงแล้ว (ไม่ซ้ำ) */
export function auditFindingCitationIndexes(
  finding: Pick<AuditFinding, 'citations'>,
  lookup: CitationIndexLookup,
): number[] {
  return citationIndexesFor(finding.citations, lookup);
}
