/**
 * T-207 / N9 — SVG sanitizer: ทุก SVG ที่ Claude สร้าง (`emit_illustration`) ต้องผ่านที่นี่ก่อน
 * render เสมอ (docs/04-ARCHITECTURE.md §D9 "แก้ตาม spike S5", docs/decisions/SPIKES.md §S5)
 *
 * ห้าม import React (module boundary — docs/04-ARCHITECTURE.md §3)
 * ห้ามใช้ `dangerouslySetInnerHTML` กับสตริงดิบ — `node()` สร้าง DOM node ใหม่ด้วย
 * `DOMParser` + `document.importNode` เสมอ
 *
 * ทำไมไม่ใช้แค่ DOMPurify profile เดียวตามที่ 04-ARCHITECTURE.md เขียนไว้เดิม (ก่อนแก้ตาม S5):
 * - spike S5 พบว่า `<style>@import url(...)` หลุด 100% และ `FORBID_ATTR` รับเฉพาะ string (ไม่ใช่ regex)
 * - main thread ทดสอบเพิ่มเติมตอนเขียนไฟล์นี้ (ดู report ของ T-207) พบว่า **attribute `style` ธรรมดา**
 *   ที่มี `url(https://...)` (ทั้งตัวพิมพ์เล็ก `style` และตัวพิมพ์ผสม `STYLE`) **ก็หลุดผ่าน DOMPurify
 *   เช่นกัน** เมื่อ sanitize node ที่ parse จาก XML (`image/svg+xml`) — DOMPurify ไม่รัน CSS sanitizer
 *   ของ attribute `style` ในโหมดนี้ ⇒ ต้องเดิน DOM ตรวจซ้ำเองเป็น defense-in-depth ชั้นที่สอง
 *   (เหตุผลเดียวกับที่ D9 ตัดสินใจไม่พึ่ง CSP อย่างเดียว)
 */
import DOMPurify from 'dompurify';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SanitizeSvgOptions {
  /** ขนาดไฟล์สูงสุด (ไบต์, UTF-8) — ค่าเริ่มต้น 60 KB ตาม docs/04 §D9 */
  maxBytes?: number;
  /** ถ้าระบุ — สีที่อยู่นอก palette นี้จะได้ warning (ไม่ reject) */
  palette?: string[];
}

export interface SanitizeSvgOk {
  ok: true;
  /** SVG ที่ sanitize แล้ว serialize กลับเป็นสตริง (เก็บ/ส่งต่อได้) */
  svg: string;
  /**
   * สร้าง DOM node ใหม่ทุกครั้งที่เรียก (`DOMParser` + `document.importNode`) — ห้ามใช้
   * `dangerouslySetInnerHTML` กับ `svg` (สตริงดิบ) ตรง ๆ
   */
  node: () => SVGSVGElement;
  warnings: string[];
}

export interface SanitizeSvgFail {
  ok: false;
  /** เหตุผลภาษาไทย */
  reason: string;
}

export type SanitizeSvgResult = SanitizeSvgOk | SanitizeSvgFail;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BYTES = 60 * 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// ตาม docs/04-ARCHITECTURE.md §D9 (แก้ตาม S5) — เพิ่ม style, animate*, set, a, iframe, object, embed, link, meta
const FORBIDDEN_TAGS = [
  'script',
  'foreignObject',
  'use',
  'image',
  'style',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'a',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
];
const FORBIDDEN_TAGS_LOWER = new Set(FORBIDDEN_TAGS.map((t) => t.toLowerCase()));

/** FORBID_ATTR ของ DOMPurify รับเฉพาะ string (ไม่ใช่ regex — บทเรียนจาก S5) */
const DOMPURIFY_FORBID_ATTR = ['href', 'xlink:href'];

/** presentation attribute ที่มักเป็น "สี" — ใช้เทียบกับ palette (ถ้าระบุ) */
const COLOR_ATTRS = new Set([
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color',
]);

/** ค่าที่ไม่ใช่สีจริง — ไม่ต้องเทียบ palette */
const NON_COLOR_VALUES = new Set(['none', 'transparent', 'currentcolor', 'inherit']);

/** attribute ที่ browser ตีความค่าเป็น paint server / URL reference ได้ (fill="url(…)", filter="url(…)" …) */
const REFERENCE_ATTRS = new Set([
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color',
  'filter',
  'mask',
  'clip-path',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'cursor',
]);

/**
 * allowlist grammar ของ REFERENCE_ATTRS (T-206): keyword/ชื่อสี (a-z ล้วน) · #hex · rgb()/rgba()/hsl()/hsla()
 * ที่ข้างในมีแต่ตัวเลข/%/,/ช่องว่าง/`/`/`deg` · `url(#id)` (ตามด้วยสี fallback ได้) — อย่างอื่นทั้งหมดถูกตัด
 * (blocklist ใช้ไม่ได้: `\000075rl(` ถูก browser ถอดเป็น `url(` ตอน parse ค่า แล้ว Chromium ยิง request ออกจริง)
 */
const LOCAL_URL_REF = String.raw`url\(\s*#[A-Za-z_][\w.:-]*\s*\)`;
const COLOR_TOKEN = String.raw`(?:[a-zA-Z]{1,30}|#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\((?:[\d.%,\s/+-]|deg)+\))`;
const ALLOWED_REFERENCE_VALUE = new RegExp(
  String.raw`^\s*(?:${LOCAL_URL_REF}(?:\s+${COLOR_TOKEN})?|${COLOR_TOKEN})\s*$`,
);

function isAllowedReferenceValue(value: string): boolean {
  return ALLOWED_REFERENCE_VALUE.test(value);
}

const URL_FN_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

// ---------------------------------------------------------------------------
// Helpers — ตรวจค่า attribute
// ---------------------------------------------------------------------------

/** ค่า attribute มี `url(...)` ที่ไม่ใช่ local reference (`url(#id)`) หรือไม่ */
function hasDisallowedUrlReference(value: string): boolean {
  URL_FN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_FN_PATTERN.exec(value)) !== null) {
    const ref = (match[2] ?? '').trim();
    if (!ref.startsWith('#')) {
      return true;
    }
  }
  return false;
}

/** ค่า attribute มี scheme อันตราย (`javascript:`, `data:`) ปนอยู่ที่ไหนก็ตามหรือไม่ */
function hasDangerousScheme(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes('javascript:') || lower.includes('data:');
}

/**
 * ค่า attribute อ้างทรัพยากรภายนอกด้วยวิธีอื่นนอกจาก `url(` หรือไม่ — main thread พิสูจน์ว่า
 * `style="mask-image:image-set(&quot;https://…&quot; 1x)"` หลุด blocklist แบบ `url(` ได้ (CSS โหลดรูปได้หลาย
 * ฟังก์ชัน: image-set/-webkit-image-set/image/cross-fade/element) ⇒ ใช้กฎกว้าง: ห้ามมี `://`,
 * ขึ้นต้น `//`, หรือฟังก์ชันโหลดทรัพยากรของ CSS ในค่า attribute ใด ๆ (ยกเว้น xmlns*)
 */
const CSS_RESOURCE_FUNCTIONS = [
  'image-set(',
  'image(',
  'cross-fade(',
  'element(',
  '@import',
  'expression(',
];

function hasExternalReference(value: string): boolean {
  const lower = value.toLowerCase().replace(/\s+/g, '');
  if (lower.includes('://') || lower.startsWith('//') || lower.includes('(//')) {
    return true;
  }
  return CSS_RESOURCE_FUNCTIONS.some((needle) => lower.includes(needle));
}

function isColorAllowedByPalette(value: string, palette: string[]): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || NON_COLOR_VALUES.has(trimmed) || trimmed.startsWith('url(')) {
    // ไม่ใช่ค่าสีตรง ๆ (เช่น อ้าง gradient) — ไม่ตัดสิน
    return true;
  }
  return palette.some((p) => p.trim().toLowerCase() === trimmed);
}

// ---------------------------------------------------------------------------
// Helpers — เดิน DOM ลบ comment / processing instruction
// ---------------------------------------------------------------------------

function removeCommentsAndProcessingInstructions(root: Element): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION,
  );
  const toRemove: Node[] = [];
  let current = walker.nextNode();
  while (current) {
    toRemove.push(current);
    current = walker.nextNode();
  }
  for (const n of toRemove) {
    n.parentNode?.removeChild(n);
  }
}

// ---------------------------------------------------------------------------
// Defense-in-depth: เดิน DOM ตรวจซ้ำหลัง DOMPurify (ดูเหตุผลด้านบนของไฟล์)
// ---------------------------------------------------------------------------

function stripDisallowedNodesDeep(
  root: Element,
  warnings: string[],
  palette: string[] | undefined,
): void {
  removeCommentsAndProcessingInstructions(root);

  const allElements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  const elementsToRemove: Element[] = [];

  for (const el of allElements) {
    const tagLower = el.tagName.toLowerCase();
    if (el !== root && FORBIDDEN_TAGS_LOWER.has(tagLower)) {
      elementsToRemove.push(el);
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      const nameLower = name.toLowerCase();
      const value = attr.value;

      if (nameLower.startsWith('on')) {
        el.removeAttribute(name);
        warnings.push(`ลบ attribute ต้องห้าม "${name}" ออกจาก <${tagLower}> (event handler)`);
        continue;
      }
      if (nameLower === 'href' || nameLower === 'xlink:href') {
        el.removeAttribute(name);
        warnings.push(`ลบ attribute "${name}" ออกจาก <${tagLower}> (ไม่อนุญาตลิงก์ภายนอก)`);
        continue;
      }
      if (nameLower === 'style') {
        // ตัดทิ้งเสมอ (ไม่ใช่ blocklist): CSS มีหลายช่องทางโหลดทรัพยากรภายนอก — prompt สั่งให้ AI ใช้
        // presentation attributes (fill/stroke/…) แทน inline CSS อยู่แล้ว (04 §D9)
        el.removeAttribute(name);
        warnings.push(`ลบ attribute "${name}" ออกจาก <${tagLower}> (ไม่อนุญาต inline CSS)`);
        continue;
      }
      if (nameLower === 'xmlns' || nameLower.startsWith('xmlns:')) {
        continue; // namespace URI ไม่ใช่การโหลดทรัพยากร
      }
      // T-206 (architect): CSS escape — ห้ามมี backslash ในค่า attribute ใด ๆ (SVG ที่ถูกต้องไม่ต้องใช้)
      // และ attribute ที่รับ paint/URL reference ต้องผ่าน allowlist grammar (ดู REFERENCE_ATTRS)
      if (value.includes('\\')) {
        el.removeAttribute(name);
        warnings.push(`ลบ attribute "${name}" ออกจาก <${tagLower}> (พบ backslash/CSS escape)`);
        continue;
      }
      if (REFERENCE_ATTRS.has(nameLower) && !isAllowedReferenceValue(value)) {
        el.removeAttribute(name);
        warnings.push(`ลบ attribute "${name}" ออกจาก <${tagLower}> (ค่าไม่อยู่ในรูปแบบที่อนุญาต)`);
        continue;
      }
      if (
        hasDangerousScheme(value) ||
        hasDisallowedUrlReference(value) ||
        hasExternalReference(value)
      ) {
        el.removeAttribute(name);
        warnings.push(
          `ลบ attribute "${name}" ออกจาก <${tagLower}> (พบ url()/javascript:/data: ที่ไม่อนุญาต)`,
        );
        continue;
      }
      if (palette && COLOR_ATTRS.has(nameLower) && !isColorAllowedByPalette(value, palette)) {
        warnings.push(
          `สี "${value}" ใน attribute "${name}" ของ <${tagLower}> ไม่อยู่ใน palette ที่กำหนด`,
        );
      }
    }
  }

  for (const el of elementsToRemove) {
    el.parentNode?.removeChild(el);
  }
}

// ---------------------------------------------------------------------------
// node() — สร้าง DOM node ใหม่จากสตริงที่ sanitize แล้ว (ห้าม innerHTML ของสตริงดิบ)
// ---------------------------------------------------------------------------

function parseFreshSvgNode(svgText: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  // boundary: DOM API คืน Node ทั่วไป แต่รู้แน่ว่าเป็น <svg> เพราะ sanitizeSvg ตรวจ root แล้วก่อนหน้านี้
  return document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
}

// ---------------------------------------------------------------------------
// sanitizeSvg
// ---------------------------------------------------------------------------

export function sanitizeSvg(svgText: string, options: SanitizeSvgOptions = {}): SanitizeSvgResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const palette = options.palette;

  const byteLength = new TextEncoder().encode(svgText).length;
  if (byteLength > maxBytes) {
    return {
      ok: false,
      reason: `ไฟล์ SVG มีขนาด ${String(byteLength)} ไบต์ เกินกำหนด ${String(maxBytes)} ไบต์`,
    };
  }

  // ป้องกัน entity expansion / XXE (billion laughs ฯลฯ) — ปฏิเสธตั้งแต่ระดับสตริงก่อน parse เลย
  // (บาง XML parser รวมถึง jsdom ขยาย internal entity ให้ก่อนที่เราจะเดิน DOM ตรวจ)
  if (/<!doctype/i.test(svgText) || /<!entity/i.test(svgText)) {
    return { ok: false, reason: 'ไม่อนุญาต DOCTYPE/ENTITY ใน SVG (ป้องกัน entity expansion)' };
  }

  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');

  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, reason: 'SVG มีข้อผิดพลาดของ XML (parse ไม่ผ่าน)' };
  }
  // defense-in-depth: กันกรณี parser ไม่รายงาน parsererror แต่ยังมี doctype หลงเหลือ
  if (doc.doctype) {
    return { ok: false, reason: 'ไม่อนุญาต DOCTYPE/ENTITY ใน SVG (ป้องกัน entity expansion)' };
  }

  const root = doc.documentElement;
  if (root.namespaceURI !== SVG_NAMESPACE || root.localName.toLowerCase() !== 'svg') {
    return { ok: false, reason: 'root element ของไฟล์ต้องเป็น <svg> เท่านั้น' };
  }

  const viewBox = root.getAttribute('viewBox');
  if (viewBox === null || viewBox.trim().length === 0) {
    return { ok: false, reason: 'SVG ต้องมี attribute viewBox' };
  }

  // DOMPurify sanitize "in place" บน node ที่ parse แล้ว (ไม่ reparse เป็น HTML — คง SVG namespace)
  const sanitizedRoot = DOMPurify.sanitize(root, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: DOMPURIFY_FORBID_ATTR,
    IN_PLACE: true,
    // boundary: overload คืน Node เมื่อ IN_PLACE:true แต่รู้แน่ว่าเป็น root element เดิม (svg)
  }) as Element;

  const warnings: string[] = [];
  stripDisallowedNodesDeep(sanitizedRoot, warnings, palette);

  // responsive: คง viewBox ไว้ แต่ไม่ผูกขนาดจริงเป็น px ตายตัว
  sanitizedRoot.setAttribute('width', '100%');
  sanitizedRoot.setAttribute('height', '100%');

  const svg = new XMLSerializer().serializeToString(sanitizedRoot);

  return {
    ok: true,
    svg,
    node: () => parseFreshSvgNode(svg),
    warnings,
  };
}
