// S4 — @react-pdf/renderer + ฟอนต์ Sarabun (OFL) ใน browser จริง
import { Document, Page, Text, View, StyleSheet, Font, Link, pdf } from '@react-pdf/renderer';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import sarabunRegular from '../s4/fonts/Sarabun-Regular.ttf?url';
import sarabunBold from '../s4/fonts/Sarabun-Bold.ttf?url';
import sarabunItalic from '../s4/fonts/Sarabun-Italic.ttf?url';

type Json = Record<string, unknown>;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const out = (m: string) => {
  const el = document.getElementById('out');
  if (el) el.textContent += m + '\n';
};

let fontRegistered = false;
function registerFont(disableHyphenation: boolean) {
  if (!fontRegistered) {
    Font.register({
      family: 'Sarabun',
      fonts: [
        { src: sarabunRegular, fontWeight: 'normal' },
        { src: sarabunBold, fontWeight: 'bold' },
        { src: sarabunItalic, fontStyle: 'italic' },
      ],
    });
    fontRegistered = true;
  }
  // ปิดการตัดคำ: react-pdf ตัดคำด้วย hyphenation ของ latin ซึ่งทำให้คำไทยแตกกลางคำ
  Font.registerHyphenationCallback(disableHyphenation ? (word: string) => [word] : (word: string) => word.split('-'));
}

const S = StyleSheet.create({
  page: { fontFamily: 'Sarabun', fontSize: 10, padding: 32, lineHeight: 1.5 },
  h1: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  h2: { fontSize: 13, fontWeight: 'bold', marginTop: 12, marginBottom: 4 },
  p: { marginBottom: 6 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#888' },
  hdr: { flexDirection: 'row', backgroundColor: '#e8eef7', borderBottomWidth: 1, borderBottomColor: '#333' },
  c1: { width: '6%', padding: 3 },
  c2: { width: '44%', padding: 3 },
  c3: { width: '10%', padding: 3, textAlign: 'right' },
  c4: { width: '10%', padding: 3 },
  c5: { width: '15%', padding: 3, textAlign: 'right' },
  c6: { width: '15%', padding: 3, textAlign: 'right' },
  footer: { position: 'absolute', bottom: 16, left: 32, right: 32, fontSize: 8, textAlign: 'center', color: '#555' },
  link: { color: '#1a56b8', textDecoration: 'underline' },
});

const ITEMS = [
  ['เครื่องปรับอากาศ แบบแยกส่วนชนิดติดผนัง มีระบบฟอกอากาศ ขนาด 18,000 บีทียู', 12, 'เครื่อง', 28500],
  ['รถบรรทุก (ดีเซล) ขนาด 1 ตัน ขับเคลื่อน 4 ล้อ แบบดับเบิ้ลแค็บ', 2, 'คัน', 868000],
  ['กล้องโทรทัศน์วงจรปิด (CCTV) ชนิดเครือข่าย แบบมุมมองคงที่', 24, 'ชุด', 23800],
  ['เครื่องวิทยุสื่อสาร ระบบ VHF/FM ชนิดมือถือ 5 วัตต์', 50, 'เครื่อง', 12000],
  ['ฝายน้ำล้น (คอนกรีตเสริมเหล็ก) สันฝายสูง ๑.๕๐ เมตร กว้าง ๘.๐๐ เมตร', 1, 'แห่ง', 2450000],
  ['ค่าจ้างเหมาปรับปรุงซ่อมแซมอาคารเรียน อาคารประกอบและสิ่งก่อสร้างอื่น', 3, 'รายการ', 185000],
  ['โต๊ะ-เก้าอี้นักเรียน ระดับมัธยมศึกษา แบบ มอก.', 120, 'ชุด', 1650],
  ['เครื่องคอมพิวเตอร์โน้ตบุ๊ก สำหรับงานประมวลผล', 15, 'เครื่อง', 22000],
];

const BOQ = Array.from({ length: 64 }, (_, i) => {
  const b = ITEMS[i % ITEMS.length];
  return { no: i + 1, name: `${i + 1}. ${b[0] as string}`, qty: b[1] as number, unit: b[2] as string, price: b[3] as number };
});

const baht = (n: number) => new Intl.NumberFormat('th-TH').format(n);

const TRICKY = 'ก็ต่อเมื่อ ผู้ใหญ่ ป้ำ ๆ เป๋อ ๆ น้ำ ที่นั่น กตัญญู ปฏิญาณ ญี่ปุ่น ฤๅษี เฌอ ฯลฯ';
const NUMERALS = 'เลขไทย ๐๑๒๓๔๕๖๗๘๙ · เลขอารบิก 0123456789 · ๑,๒๓๔,๕๖๗.๘๙ บาท · 1,234,567.89 บาท';

function Doc() {
  return (
    <Document title="TGBP spike S4" author="TGBP">
      <Page size="A4" style={S.page} wrap>
        <Text style={S.h1}>ข้อเสนอโครงการ (ตัวอย่างทดสอบฟอนต์ไทย)</Text>
        <Text style={S.h2}>๑. สระลอย / วรรณยุกต์ซ้อน</Text>
        <Text style={S.p}>{TRICKY}</Text>
        <Text style={S.p}>
          ทดสอบวรรณยุกต์ซ้อนสระบน: น้ำ ที่ ผู้ ปี้ กี๋ เกี๊ยะ เปี๊ยก โต๊ะ ครั้ง ตั๋ว ฟื้น มั่ง เสื้อ ป๋วย
        </Text>
        <Text style={S.h2}>๒. เลขไทย / เลขอารบิก</Text>
        <Text style={S.p}>{NUMERALS}</Text>
        <Text style={S.h2}>๓. ข้อความยาวเพื่อทดสอบการตัดบรรทัด (word wrap)</Text>
        <Text style={S.p}>
          โครงการก่อสร้างฝายน้ำล้นคอนกรีตเสริมเหล็กพร้อมระบบส่งน้ำเพื่อการเกษตรในพื้นที่ตำบลบ้านกลาง
          อำเภอสันป่าตอง จังหวัดเชียงใหม่ ซึ่งดำเนินการโดยองค์การบริหารส่วนตำบลบ้านกลาง
          โดยมีวัตถุประสงค์เพื่อเพิ่มปริมาณน้ำต้นทุนสำหรับการเพาะปลูกในฤดูแล้งและบรรเทาปัญหาอุทกภัยในฤดูฝน
        </Text>
        <Text style={S.h2}>๔. ลิงก์ (ต้องกดได้ใน PDF)</Text>
        <Text style={S.p}>
          ที่มา:{' '}
          <Link src="https://xzozero5.github.io/thai-government-budget-planner/" style={S.link}>
            https://xzozero5.github.io/thai-government-budget-planner/
          </Link>
        </Text>
        <Text style={S.footer} fixed render={({ pageNumber, totalPages }) => `หน้า ${pageNumber} / ${totalPages}`} />
      </Page>

      <Page size="A4" style={S.page} wrap>
        <Text style={S.h1}>รายการค่าใช้จ่าย (BOQ)</Text>
        <View style={S.hdr} fixed>
          <Text style={S.c1}>ลำดับ</Text>
          <Text style={S.c2}>รายการ</Text>
          <Text style={S.c3}>จำนวน</Text>
          <Text style={S.c4}>หน่วย</Text>
          <Text style={S.c5}>ราคา/หน่วย</Text>
          <Text style={S.c6}>รวม (บาท)</Text>
        </View>
        {BOQ.map((r) => (
          <View key={r.no} style={S.row} wrap={false}>
            <Text style={S.c1}>{r.no}</Text>
            <Text style={S.c2}>{r.name}</Text>
            <Text style={S.c3}>{baht(r.qty)}</Text>
            <Text style={S.c4}>{r.unit}</Text>
            <Text style={S.c5}>{baht(r.price)}</Text>
            <Text style={S.c6}>{baht(r.qty * r.price)}</Text>
          </View>
        ))}
        <Text style={S.footer} fixed render={({ pageNumber, totalPages }) => `หน้า ${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}

// เอกสารทดสอบที่ 2: ข้อความสั้น ๆ แยก <Text> ละบรรทัด → ตรวจว่าตัวอักษรท้ายหายจริงไหม
const PROBES = [
  'ฯลฯ',
  'เฌอ ฯลฯ',
  'ป๋วย',
  'เสื้อ ป๋วย',
  'กตัญญู',
  'น้ำ',
  'ที่นั่น',
  'สำนักงาน',
  'ปฏิญาณ',
  'ญี่ปุ่น',
  'ฤๅษี',
  'อุทกภัยในฤดูฝน',
  'ABC ฯลฯ XYZ',
  'ครุภัณฑ์ ๑๒๓',
  'ก็ต่อเมื่อ',
  TRICKY,
  'ทดสอบวรรณยุกต์ซ้อนสระบน: น้ำ ที่ ผู้ ปี้ กี๋ เกี๊ยะ เปี๊ยก โต๊ะ ครั้ง ตั๋ว ฟื้น มั่ง เสื้อ ป๋วย',
  'เฌอ ฯลฯ ยาว ๆ อีกหน่อยให้ใกล้ขอบขวา แต่ยังไม่ชนขอบ',
];

let suffix = '|';
let prefix = true;
function ProbeDoc() {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        {PROBES.map((p, i) => (
          <Text key={i} style={{ marginBottom: 4 }}>{`${prefix ? `[${i}]` : ''}${p}${suffix}`}</Text>
        ))}
      </Page>
    </Document>
  );
}

async function renderProbe(sfx = '|', pfx = true): Promise<Json> {
  suffix = sfx;
  prefix = pfx;
  registerFont(true);
  const blob = await pdf(<ProbeDoc />).toBlob();
  const buf = await blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const lines = (tc.items as { str: string }[]).map((x) => x.str).filter((s) => s.trim().length);
  return {
    suffix: sfx,
    expected: PROBES.map((p, i) => `${pfx ? `[${i}]` : ''}${p}${sfx}`),
    extracted: lines,
    bytes: buf.byteLength,
  };
}

async function render(opts: { disableHyphenation: boolean }): Promise<Json> {
  registerFont(opts.disableHyphenation);
  const t0 = performance.now();
  const blob = await pdf(<Doc />).toBlob();
  const ms = performance.now() - t0;
  const buf = await blob.arrayBuffer();
  (window as unknown as { __s4pdf?: ArrayBuffer }).__s4pdf = buf;
  return { ms_render: ms, bytes: buf.byteLength, disableHyphenation: opts.disableHyphenation };
}

async function inspect(scale = 1.6): Promise<Json> {
  const buf = (window as unknown as { __s4pdf?: ArrayBuffer }).__s4pdf;
  if (!buf) throw new Error('render() ก่อน');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const pages: Json[] = [];
  const images: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    const text = (tc.items as { str: string }[]).map((x) => x.str).join('');
    const vp = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d')!;
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    images.push(canvas.toDataURL('image/png'));
    pages.push({ page: i, chars: text.length, text: text.slice(0, 1200) });
  }
  // annotation (Link) ของหน้าแรก
  const ann = await (await doc.getPage(1)).getAnnotations();
  return {
    num_pages: doc.numPages,
    pages,
    images,
    links: (ann as { subtype: string; url?: string }[]).filter((a) => a.subtype === 'Link').map((a) => a.url ?? null),
  };
}

declare global {
  interface Window {
    __s4: { render: typeof render; inspect: typeof inspect; renderProbe: typeof renderProbe; ready: boolean };
  }
}
window.__s4 = { render, inspect, renderProbe, ready: true };
out('s4 loaded');
