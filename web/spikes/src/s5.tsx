// S5 — SVG sanitizer (DOMPurify ตาม 04 §D9) + SVG→PNG ผ่าน canvas ภายใต้ CSP + ใส่ใน react-pdf
import DOMPurify from 'dompurify';
import { Document, Page, Image as PdfImage, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import sarabunRegular from '../s4/fonts/Sarabun-Regular.ttf?url';

type Json = Record<string, unknown>;
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const out = (m: string) => {
  const el = document.getElementById('out');
  if (el) el.textContent += m + '\n';
};

// ---------- profile ตาม 04 §D9 ----------
const SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'use', 'image'],
  // หมายเหตุ: 04 §D9 เขียน [/^on/i, ...] แต่ DOMPurify รับเฉพาะ "string" ใน FORBID_ATTR
  FORBID_ATTR: ['href', 'xlink:href'],
} as const;

function sanitize(svg: string): string {
  return DOMPurify.sanitize(svg, SANITIZE_CONFIG as unknown as Record<string, unknown>) as unknown as string;
}

/** ตรวจว่ามีอะไรหลุดหลัง sanitize (parse เป็น DOM แล้วเดินดูจริง ๆ) */
function auditSvg(svg: string): Json {
  const doc = new DOMParser().parseFromString(`<div>${svg}</div>`, 'text/html');
  const root = doc.body.firstElementChild!;
  const tags: Record<string, number> = {};
  const attrs: Record<string, number> = {};
  const suspicious: string[] = [];
  const walk = (el: Element) => {
    const t = el.tagName.toLowerCase();
    tags[t] = (tags[t] ?? 0) + 1;
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      attrs[n] = (attrs[n] ?? 0) + 1;
      const v = a.value.toLowerCase();
      if (n.startsWith('on')) suspicious.push(`event-attr ${t}@${n}`);
      if (/javascript:/.test(v)) suspicious.push(`javascript: in ${t}@${n}`);
      if (/https?:\/\//.test(v)) suspicious.push(`external-url in ${t}@${n}=${a.value.slice(0, 60)}`);
      if (/url\(/.test(v) && /https?:/.test(v)) suspicious.push(`css url() external in ${t}@${n}`);
      if (n === 'href' || n === 'xlink:href') suspicious.push(`href left in ${t}`);
    }
    if (t === 'style' && el.textContent) {
      const c = el.textContent.toLowerCase();
      if (/@import/.test(c)) suspicious.push('style @import');
      if (/url\(\s*['"]?https?:/.test(c)) suspicious.push('style url(http…)');
      if (/expression\(/.test(c)) suspicious.push('style expression()');
    }
    for (const ch of Array.from(el.children)) walk(ch);
  };
  for (const ch of Array.from(root.children)) walk(ch);
  return { tags, attrs, suspicious: [...new Set(suspicious)] };
}

function sanitizeCases(cases: { name: string; svg: string }[]): Json {
  return {
    results: cases.map((c) => {
      const clean = sanitize(c.svg);
      return {
        name: c.name,
        bytes_in: c.svg.length,
        bytes_out: clean.length,
        before: auditSvg(c.svg),
        after: auditSvg(clean),
        removed_tags: Object.keys(auditSvg(c.svg).tags as Record<string, number>).filter(
          (t) => !(t in (auditSvg(clean).tags as Record<string, number>)),
        ),
        clean_head: clean.slice(0, 220),
      };
    }),
    dompurify_version: DOMPurify.version,
    removed_report: (DOMPurify.removed ?? []).length,
  };
}

// ---------- SVG → PNG ----------
async function svgToPng(svg: string, opts: { via: 'data' | 'blob'; scale: number; w: number; h: number }): Promise<Json> {
  const t0 = performance.now();
  let url: string;
  if (opts.via === 'blob') url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  else url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new window.Image();
  const loaded = new Promise<Json>((resolve) => {
    img.onload = () => resolve({ ok: true });
    img.onerror = (e) => resolve({ ok: false, error: String((e as ErrorEvent)?.message ?? 'img error') });
  });
  img.src = url;
  const load = await loaded;
  if (!load.ok) return { via: opts.via, loaded: false, error: load.error, ms: performance.now() - t0 };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(opts.w * opts.scale);
  canvas.height = Math.round(opts.h * opts.scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let dataUrl = '';
  let tainted = false;
  let err: string | null = null;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (e) {
    tainted = true;
    err = String(e);
  }
  if (opts.via === 'blob') URL.revokeObjectURL(url);
  (window as unknown as { __s5png?: string }).__s5png = dataUrl;
  return {
    via: opts.via,
    loaded: true,
    canvas: { w: canvas.width, h: canvas.height },
    tainted,
    error: err,
    png_bytes: dataUrl ? Math.floor((dataUrl.length - 22) * 0.75) : 0,
    ms: performance.now() - t0,
    png_head: dataUrl.slice(0, 40),
  };
}

// ---------- PNG → react-pdf ----------
const S = StyleSheet.create({
  page: { fontFamily: 'Sarabun', fontSize: 11, padding: 32 },
  img: { width: 400 },
});

async function pngIntoPdf(pngDataUrl: string): Promise<Json> {
  Font.register({ family: 'Sarabun', fonts: [{ src: sarabunRegular }] });
  Font.registerHyphenationCallback((w: string) => [w]);
  const t0 = performance.now();
  const blob = await pdf(
    <Document>
      <Page size="A4" style={S.page}>
        <Text>ภาพประกอบโครงการ (SVG จาก Claude → PNG 2× → react-pdf)</Text>
        <View>
          <PdfImage src={pngDataUrl} style={S.img} />
        </View>
      </Page>
    </Document>,
  ).toBlob();
  const ms = performance.now() - t0;
  const buf = await blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  const imageOps = ops.fnArray.filter(
    (f: number) => f === pdfjsLib.OPS.paintImageXObject || f === pdfjsLib.OPS.paintInlineImageXObject,
  ).length;
  (window as unknown as { __s5pdf?: ArrayBuffer }).__s5pdf = buf;
  return { ms_render: ms, pdf_bytes: buf.byteLength, image_ops: imageOps, num_pages: doc.numPages };
}

/** ฟอนต์ไทยใน SVG ตอน rasterize: ใช้ฟอนต์ระบบได้ไหม / ต้องฝังไหม */
async function thaiFontInSvg(): Promise<Json> {
  const mk = (family: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60" width="300" height="60"><rect width="300" height="60" fill="#fff"/><text x="8" y="40" font-family="${family}" font-size="28" fill="#111">ฝายน้ำล้น ๑๒๓</text></svg>`;
  const measure = async (family: string) => {
    const r = (await svgToPng(mk(family), { via: 'data', scale: 1, w: 300, h: 60 })) as Json;
    if (!r.loaded) return { family, ...r };
    // นับ pixel ที่ไม่ใช่สีขาว → ถ้า 0 แปลว่า glyph ไม่ถูกวาด
    const dataUrl = (window as unknown as { __s5png?: string }).__s5png!;
    const img = new window.Image();
    await new Promise((res) => {
      img.onload = res;
      img.src = dataUrl;
    });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext('2d')!;
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200) dark++;
    return { family, dark_pixels: dark, png_bytes: r.png_bytes };
  };
  return {
    sarabun_not_embedded: await measure('Sarabun'),
    sans_serif: await measure('sans-serif'),
    tahoma: await measure('Tahoma, sans-serif'),
  };
}

declare global {
  interface Window {
    __s5: {
      sanitizeCases: typeof sanitizeCases;
      svgToPng: typeof svgToPng;
      pngIntoPdf: typeof pngIntoPdf;
      thaiFontInSvg: typeof thaiFontInSvg;
      sanitize: typeof sanitize;
      ready: boolean;
    };
  }
}
window.__s5 = { sanitizeCases, svgToPng, pngIntoPdf, thaiFontInSvg, sanitize, ready: true };
out('s5 loaded');
