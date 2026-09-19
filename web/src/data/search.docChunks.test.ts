/**
 * T-204 — `searchDocChunksText`: ค้นข้อความ DocChunk (จาก PDF) ด้วย `foldThai` ทั้งสองฝั่ง
 * เคสจริงจาก `docs/02-DATA-INVENTORY.md` §B (สระ/วรรณยุกต์หลุดตำแหน่งตอน extract PDF)
 */
import { describe, expect, it } from 'vitest';
import type { DocChunk } from '@/data/types';
import { searchDocChunksText } from '@/data/search';

function makeChunk(text: string, overrides: Partial<DocChunk> = {}): DocChunk {
  return { doc_id: 'd_test', page: 1, chunk_no: 0, text, tables: [], ...overrides };
}

describe('searchDocChunksText', () => {
  it('ค้น "สำนักงาน" (พิมพ์ปกติ) ต้องเจอ chunk ที่มีข้อความ "ส านักงาน" (สระหลุดจาก PDF จริง — 02 §B)', () => {
    const chunks = [makeChunk('งบประมาณของส านักงานประกันสังคม ประจ าปี 2568')];
    const results = searchDocChunksText(chunks, 'สำนักงาน');
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk.text).toBe('งบประมาณของส านักงานประกันสังคม ประจ าปี 2568');
  });

  it('ค้น "ประจำปี" เจอ "ประจ าปี"', () => {
    const chunks = [makeChunk('รายงานประจ าปีงบประมาณ')];
    expect(searchDocChunksText(chunks, 'ประจำปี')).toHaveLength(1);
  });

  it('ค้น "ขั้นต่ำ" เจอ "ขั้นต่ า"', () => {
    const chunks = [makeChunk('อัตราค่าจ้างขั้นต่ า')];
    expect(searchDocChunksText(chunks, 'ขั้นต่ำ')).toHaveLength(1);
  });

  it('คืน chunk ต้นฉบับเสมอ (ไม่ fold ข้อความที่เป็นหลักฐาน — CLAUDE.md N3)', () => {
    const original = 'ส านักงานประกันสังคม';
    const chunks = [makeChunk(original)];
    const [result] = searchDocChunksText(chunks, 'สำนักงาน');
    expect(result?.chunk.text).toBe(original);
  });

  it('ไม่เจอเมื่อไม่มีคำที่ค้นอยู่จริงในเนื้อความ (แม้ fold แล้ว)', () => {
    const chunks = [makeChunk('รายงานผลการเบิกจ่ายงบลงทุน')];
    expect(searchDocChunksText(chunks, 'สำนักงาน')).toEqual([]);
  });

  it('คืนหลาย chunk พร้อม index ที่ตรงตำแหน่งใน array ที่ส่งเข้ามา', () => {
    const chunks = [
      makeChunk('ไม่เกี่ยว'),
      makeChunk('ส านักงานเขต 1'),
      makeChunk('อีกอันที่ไม่เกี่ยว'),
      makeChunk('สำนักงานเขต 2'),
    ];
    const results = searchDocChunksText(chunks, 'สำนักงาน');
    expect(results.map((r) => r.index)).toEqual([1, 3]);
  });

  it('query ว่าง (หรือว่างหลัง fold) → ไม่คืนอะไร', () => {
    const chunks = [makeChunk('เนื้อหาอะไรก็ได้')];
    expect(searchDocChunksText(chunks, '')).toEqual([]);
    expect(searchDocChunksText(chunks, '   ')).toEqual([]);
  });
});
