/**
 * T-309 — `IllustrationSink`: ที่เก็บ SVG ที่ sanitize แล้วของ `emit_illustration`
 *
 * ยังไม่มี Zustand store จริง (Phase 4 — 04 §D7 `proposal`/`toolLog` slice) จึงกำหนด interface นี้ไว้
 * ก่อนแล้ว inject เข้ามาทาง `ToolContext.illustrationSink` (`tools/toolKit.ts`) เมื่อ Phase 4 สร้าง
 * store จริงแล้ว ให้ implement interface นี้ตรง ๆ ไม่ต้องแก้ `ai/**`
 *
 * ห้าม import React/DOM API ใน `ai/` ยกเว้นที่ `lib/svgSanitizer.ts` ใช้ภายในตัวเอง (N9/module
 * boundary) — ไฟล์นี้เก็บแค่ผลลัพธ์ของ `sanitizeSvg()` (string ที่ sanitize แล้ว) ไม่ใช่ DOM node
 */

export interface StoredIllustration {
  illustrationId: string;
  title: string;
  caption: string;
  kind: 'map' | 'cross_section' | 'isometric' | 'diagram';
  /** SVG ที่ผ่าน `sanitizeSvg()` แล้ว (string, ปลอดภัยพอจะ parse ใหม่ด้วย DOMParser ตอน render) */
  svg: string;
  warnings: string[];
}

export interface IllustrationSink {
  /** บันทึกภาพที่ sanitize สำเร็จแล้ว 1 ภาพ */
  add(illustration: StoredIllustration): void;
  /** จำนวนภาพที่เก็บไว้แล้วใน session นี้ (ใช้จำกัด ≤ 3 ภาพ/proposal ร่วมกับ `ToolLog.illustrationCount`) */
  count(): number;
  get(illustrationId: string): StoredIllustration | undefined;
}

/** in-memory sink สำหรับ unit test/สภาพแวดล้อมที่ยังไม่มี store จริง (Phase 4 ค่อยแทนที่ด้วย
 * implementation ที่ผูกกับ Zustand slice) */
export function createInMemoryIllustrationSink(): IllustrationSink {
  const store = new Map<string, StoredIllustration>();
  return {
    add(illustration) {
      store.set(illustration.illustrationId, illustration);
    },
    count() {
      return store.size;
    },
    get(illustrationId) {
      return store.get(illustrationId);
    },
  };
}
