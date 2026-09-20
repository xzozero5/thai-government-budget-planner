// @vitest-environment node
/**
 * T-501 — test ของ `ProposalDocument`/`renderProposalPdf` ที่ render จริงด้วย `@react-pdf/renderer`
 * (environment node: react-pdf ไม่ต้องการ DOM และเร็วกว่า jsdom มาก)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Image as PdfImage, Link, Page, Text, View } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import type { Proposal } from '@/ai/tools/proposal';
import { t as translate } from '@/i18n';
import equipAirconFixture from './__fixtures__/proposal.equip-aircon.json';
import { buildCheckerboardPngDataUrl } from './__fixtures__/samplePng';
import { buildSyntheticBoq } from './__fixtures__/syntheticBoq';
import { pdfCopy } from './copy';
import type { FontSource } from './fonts';
import {
  decodePageTextRuns,
  pdfEmbeddedFontNames,
  pdfHasImageObject,
  pdfHasValidHeader,
  pdfImageObjectCount,
  pdfLinkUris,
  pdfPageCount,
} from './pdfProbe';
import { ProposalDocument } from './ProposalDocument';
import { buildPdfFileName, renderProposalPdf } from './renderProposalPdf';
import { normalizeToUnicodeArtifacts, stripSoftBreaks } from './thaiText';

const equipAircon = equipAirconFixture as unknown as Proposal;

/** ฟอนต์จริงในดิสก์ (ไม่มี dev server ตอน test ฝั่ง Node — ดู fonts.ts หัวไฟล์) */
const TEST_DIRNAME = path.dirname(fileURLToPath(import.meta.url));
const TEST_FONT_SOURCE: FontSource = {
  regular: path.resolve(TEST_DIRNAME, '../../../../public/fonts/Sarabun-Regular.ttf'),
  bold: path.resolve(TEST_DIRNAME, '../../../../public/fonts/Sarabun-Bold.ttf'),
  italic: path.resolve(TEST_DIRNAME, '../../../../public/fonts/Sarabun-Italic.ttf'),
};

async function toBuffer(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer());
}

/** ต่อข้อความที่ decode ได้จากทุกหน้าของ PDF เป็นก้อนเดียว (ยังไม่ normalize/ลบช่องว่าง) */
function decodeAllPagesNormalized(buf: Buffer): string {
  const pageCount = pdfPageCount(buf);
  const parts: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    for (const run of decodePageTextRuns(buf, i)) parts.push(run.text);
  }
  return parts.join(' ');
}

/** ลบช่องว่างทั้งหมดก่อนเทียบเนื้อหา — ตัว ZWSP (มาตรการทางเลี่ยงบั๊ก S4 #2, `toPdfText`) ที่แทรกระหว่าง
 * พยางค์ไทย มักถูก decode กลับมาเป็นช่องว่างจริง (glyph ของ ZWSP ถูก dedupe ร่วมกับช่องว่างตอน subset
 * ฟอนต์) ทำให้ข้อความไทยที่ปกติไม่มีช่องว่างระหว่างพยางค์กลับมีช่องว่างแทรกอยู่ทั่วไปในผลลัพธ์ที่ decode
 * ได้ — ไม่กระทบภาพที่มองเห็นจริง (ZWSP กว้าง 0) แค่กระทบการเทียบสตริงในเทสต์นี้เท่านั้น
 * **ต้องลบช่องว่างก่อน `normalizeToUnicodeArtifacts` เสมอ** — ไม่งั้นช่องว่างที่แทรกอยู่ระหว่าง `ำ`
 * กับ `า` (จาก ZWSP ที่ตำแหน่งนั้นพอดี) จะไปกันไม่ให้ regex `/ำา/g` ของ normalize เจอคู่ที่ติดกัน */
function normalizedNoSpace(s: string): string {
  return normalizeToUnicodeArtifacts(stripAllWhitespace(s));
}

function countOccurrences(haystack: string, needle: string): number {
  return needle === '' ? 0 : haystack.split(needle).length - 1;
}

function stripAllWhitespace(s: string): string {
  return s.replace(/\s+/g, '');
}

/** primitive ของ react-pdf เอง — ห้าม "เรียก" ตรง ๆ เหมือน function component ธรรมดา (อาจพึ่ง internal
 * reconciler ของ react-pdf) ต่างจาก helper component ของเราเอง (`Bullet`/`BoqRow`/ฯลฯ) ที่เป็น React
 * function component ล้วน ๆ เรียกตรง ๆ เพื่อ "ขยาย" โครง element ต่อได้อย่างปลอดภัย */
const REACT_PDF_PRIMITIVES = new Set<unknown>([Document, Page, View, Text, Link, PdfImage]);

/** เดินโครง React element tree ที่ `ProposalDocument(props)` คืนมา (ไม่ต้อง render จริง) เก็บทุกสตริงที่
 * เป็น "ลูกโดยตรง" ของ `<Text>`/`<Link>` — คือสิ่งที่จะถูกส่งเข้า react-pdf จริง ๆ (ก่อนลบ ZWSP)
 * function component ของเราเอง (เช่น `BoqRow`) ยังไม่ถูก "ขยาย" จนกว่า renderer จริงจะเรียก — เดินเข้าไป
 * เรียกเองที่นี่เพื่อดูเนื้อหาจริงโดยไม่ต้อง render PDF เต็มรูปแบบ */
function collectTextNodeStrings(node: unknown, out: string[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string') return; // ถูกเก็บโดย parent element ที่เป็น Text/Link อยู่แล้ว
  if (Array.isArray(node)) {
    for (const child of node) collectTextNodeStrings(child, out);
    return;
  }
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    const el = node as { type: unknown; props: { children?: unknown } };
    if (el.type === Text || el.type === Link) {
      const { children } = el.props;
      if (typeof children === 'string') out.push(children);
      else if (Array.isArray(children)) {
        for (const c of children) if (typeof c === 'string') out.push(c);
      }
      collectTextNodeStrings(el.props.children, out);
      return;
    }
    if (typeof el.type === 'function' && !REACT_PDF_PRIMITIVES.has(el.type)) {
      const rendered = (el.type as (p: unknown) => unknown)(el.props);
      collectTextNodeStrings(rendered, out);
      return;
    }
    collectTextNodeStrings(el.props.children, out);
  }
}

describe('ProposalDocument — snapshot ของข้อความที่ส่งเข้า <Text> (หลังลบ U+200B)', () => {
  it('มีหัวข้อของทุก section ที่ fixture นี้มีข้อมูลจริง และไม่มีหัวข้อของ section ที่ว่างเปล่า', () => {
    const element = ProposalDocument({ proposal: equipAircon });
    const texts: string[] = [];
    collectTextNodeStrings(element, texts);
    const joined = stripSoftBreaks(texts.join('\n'));

    // หัวข้อที่ต้องมี (fixture มีข้อมูลจริงในส่วนนี้) — ส่วนใหญ่มาจาก copy.th.json (T-401, `@/i18n`)
    expect(joined).toContain(equipAircon.title);
    expect(joined).toContain(translate('proposal.sections.summary'));
    expect(joined).toContain(equipAircon.summary);
    expect(joined).toContain(translate('proposal.sections.objective'));
    expect(joined).toContain(translate('proposal.sections.scope'));
    expect(joined).toContain(translate('proposal.sections.boq'));
    expect(joined).toContain(equipAircon.boq[0]?.item);
    expect(joined).toContain(pdfCopy.section.totals);
    expect(joined).toContain(translate('proposal.sections.assumptions'));
    expect(joined).toContain(translate('proposal.sections.comparison'));
    expect(joined).toContain(equipAircon.comparables[0]?.agency);
    expect(joined).toContain(pdfCopy.section.citationsAppendix);
    expect(joined).toContain(pdfCopy.cover.aiDraftBadge);

    // หัวข้อที่ไม่ควรมี (fixture ไม่มีข้อมูลส่วนนี้ — mode:"draft", ไม่มี stat_cards/images)
    expect(joined).not.toContain(translate('proposal.stat.sectionTitle'));
    expect(joined).not.toContain(translate('proposal.sections.audit'));
    expect(joined).not.toContain(pdfCopy.section.trendImages);
    expect(joined).not.toContain(translate('proposal.sections.illustration'));
  });

  it('ทุกข้อความที่ส่งเข้า Text ผ่าน toPdfText แล้ว (ลบ ZWSP กลับมาต้องเหมือนต้นฉบับ ไม่มีอักขระอื่นเพิ่ม/หาย)', () => {
    const element = ProposalDocument({ proposal: equipAircon });
    const texts: string[] = [];
    collectTextNodeStrings(element, texts);
    // ทุกสตริงที่ไม่ว่างต้องเคย "ผ่าน toPdfText" แปลว่ามีอักขระเสียสละ ZWSP ต่อท้ายอย่างน้อย 1 ตัว
    const nonEmpty = texts.filter((s) => s.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    for (const s of nonEmpty) {
      expect(s.endsWith(' ')).toBe(true);
    }
  });
});

describe('renderProposalPdf — render fixture จริงเป็น PDF buffer', () => {
  it('ขึ้นต้นด้วย %PDF, embed ฟอนต์ Sarabun, มี appendix citations', async () => {
    const blob = await renderProposalPdf({
      proposal: equipAircon,
      warnings: ['ตัวอย่างคำเตือนจาก validator'],
      dataVersion: 'test-data-version-1',
      generatedAt: new Date(2026, 8, 20),
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);

    expect(pdfHasValidHeader(buf)).toBe(true);
    expect(pdfPageCount(buf)).toBeGreaterThanOrEqual(2);

    const fontNames = pdfEmbeddedFontNames(buf);
    expect(fontNames.some((n) => n.includes('Sarabun'))).toBe(true);

    const allText = decodeAllPagesNormalized(buf);
    expect(normalizedNoSpace(allText)).toContain(normalizedNoSpace('ตัวอย่างคำเตือนจาก validator'));
  }, 20_000);

  it('BOQ 60 แถวสังเคราะห์ทำให้ตารางข้ามหน้าได้จริง และไม่มีแถวไหนหายไป', async () => {
    const boq = buildSyntheticBoq(60);
    const syntheticProposal: Proposal = { ...equipAircon, boq };

    const blob = await renderProposalPdf({
      proposal: syntheticProposal,
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);

    const pageCount = pdfPageCount(buf);
    expect(pageCount).toBeGreaterThanOrEqual(3); // cover + อย่างน้อย 2 หน้าเนื้อหาของตาราง 60 แถว

    const allText = decodeAllPagesNormalized(buf);
    const allTextNoSpace = normalizedNoSpace(allText);
    // ทุกบรรทัดต้องยังอยู่ครบ (เลขลำดับ 1..60 ที่พิมพ์ไว้ในชื่อรายการ "N. ...")
    for (const line of boq) {
      const expectedNo = line.item.split('.')[0];
      expect(allText).toContain(`${expectedNo ?? ''}.`);
    }
    // ข้อความท้าย ๆ ของรายการ BOQ สุดท้าย (บั๊ก S4 #2 คือตัวท้ายสุดของ block หาย) ต้องอยู่ครบ — รวมถึง
    // เนื้อหาท้ายสุดของทั้งเอกสาร (ภาคผนวก citations รายการสุดท้าย) ด้วย
    const lastLine = boq[boq.length - 1];
    expect(lastLine).toBeDefined();
    if (lastLine !== undefined) {
      expect(allTextNoSpace).toContain(normalizedNoSpace(lastLine.item.slice(-10)));
    }
    const lastCitation = lastLine?.citations[0];
    if (lastCitation?.kind === 'web') {
      expect(allTextNoSpace).toContain(normalizedNoSpace(lastCitation.url.slice(-6)));
    }
  }, 20_000);

  it('Link เฉพาะ URL https:// เท่านั้น — URL อันตราย (javascript:/http:) ต้องไม่ปรากฏเป็น /URI', async () => {
    const dangerousProposal: Proposal = {
      ...equipAircon,
      citations_web: [
        { url: 'https://shopee.co.th/safe-product', retrieved_at: '2569-09-20' },
        // ไม่ผ่าน validateAndNormalizeProposal อยู่แล้วตามปกติ แต่ ProposalDocument ต้องกันเองอีกชั้น
        // (defense-in-depth เผื่อผู้เรียกส่ง Proposal ที่ไม่ผ่าน validator มาโดยตรง)
        { url: 'javascript:alert(1)', retrieved_at: '2569-09-20' },
        { url: 'http://insecure.example.com', retrieved_at: '2569-09-20' },
      ],
    };
    const blob = await renderProposalPdf({
      proposal: dangerousProposal,
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);

    const uris = pdfLinkUris(buf);
    expect(uris).toContain('https://shopee.co.th/safe-product');
    expect(uris.some((u) => u.startsWith('javascript:'))).toBe(false);
    expect(uris.some((u) => u.startsWith('http://'))).toBe(false);
  }, 20_000);

  it('มี image object เมื่อส่งภาพรวมโครงการเป็น PNG data URL 1x1', async () => {
    const png1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const blob = await renderProposalPdf({
      proposal: equipAircon,
      images: { overview: png1x1 },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    expect(pdfHasImageObject(buf)).toBe(true);
  }, 20_000);

  it('โหมด audit + audit_findings แสดงหัวข้อข้อสังเกตจากการตรวจสอบ', async () => {
    const auditProposal: Proposal = {
      ...equipAircon,
      mode: 'audit',
      audit_findings: [
        {
          text: 'ราคาต่อหน่วยสูงกว่าค่ามัธยฐานของหน่วยงานอื่นในปีเดียวกันอย่างมีนัยสำคัญ',
          severity: 'high',
          citations: [],
        },
      ],
    };
    const blob = await renderProposalPdf({ proposal: auditProposal, fontSource: TEST_FONT_SOURCE });
    const buf = await toBuffer(blob);
    const allText = decodeAllPagesNormalized(buf);
    expect(normalizedNoSpace(allText)).toContain(
      normalizedNoSpace('ราคาต่อหน่วยสูงกว่าค่ามัธยฐาน'.slice(0, 20)),
    );
  }, 20_000);
});

describe('T-504 (US-8.3) — กราฟแนวโน้มราคาที่เกี่ยวข้อง', () => {
  const PNG_1X1 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('ไม่มี images.trends → ไม่มีหัวข้อ "แนวโน้มราคาที่เกี่ยวข้อง" เลย', async () => {
    const blob = await renderProposalPdf({ proposal: equipAircon, fontSource: TEST_FONT_SOURCE });
    const buf = await toBuffer(blob);
    const allText = decodeAllPagesNormalized(buf);
    expect(normalizedNoSpace(allText)).not.toContain(normalizedNoSpace(pdfCopy.section.trendImages));
  });

  it('มี images.trends 3 รูป → มี image object 3 ชิ้น + หัวข้อ section + คำบรรยาย basis/n รวม', async () => {
    // เนื้อภาพต้องต่างกันจริง (ไม่ใช่ data URL เดียวกันซ้ำ) — pdfkit cache/dedupe ภาพที่ src เหมือนกันเป๊ะ
    // เป็น XObject เดียว ทำให้นับจำนวนไม่ตรงกับจำนวนกราฟถ้าใช้ PNG ตัวอย่างเดียวกันทั้ง 3 รูป
    const blob = await renderProposalPdf({
      proposal: equipAircon,
      images: {
        trends: [
          {
            title: 'เครื่องปรับอากาศ 18000 บีทียู',
            dataUrl: buildCheckerboardPngDataUrl(8),
            basisLabel: 'อิงราคาต่อหน่วย',
            nTotal: 12,
          },
          { title: 'ดัชนีราคาผู้บริโภค', dataUrl: buildCheckerboardPngDataUrl(16) },
          {
            title: 'ปูนซีเมนต์ถุง',
            dataUrl: buildCheckerboardPngDataUrl(24),
            basisLabel: 'อิงยอดต่อรายการงบ',
            nTotal: 4,
          },
        ],
      },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    expect(pdfImageObjectCount(buf)).toBe(3);

    const allText = decodeAllPagesNormalized(buf);
    const noSpace = normalizedNoSpace(allText);
    expect(noSpace).toContain(normalizedNoSpace(pdfCopy.section.trendImages));
    expect(noSpace).toContain(normalizedNoSpace('เครื่องปรับอากาศ 18000 บีทียู'));
    expect(noSpace).toContain(normalizedNoSpace('อิงราคาต่อหน่วย'));
    expect(noSpace).toContain(normalizedNoSpace(pdfCopy.trend.nTotal(12)));
    expect(noSpace).toContain(normalizedNoSpace('อิงยอดต่อรายการงบ'));
    // การ์ดตัวชี้วัดเศรษฐกิจ (ไม่มี basisLabel/nTotal) ไม่ต้องมีคำบรรยายเพิ่ม แต่ต้องไม่ทำให้ทั้งไฟล์พัง
    expect(noSpace).toContain(normalizedNoSpace('ดัชนีราคาผู้บริโภค'));
  }, 20_000);

  it('T-602 (เก็บตก PDF, N3): กราฟตัวชี้วัดเศรษฐกิจที่ unverified:true → มีคำบรรยาย "ยังไม่ตรวจสอบ"; ชื่อกราฟปรากฏเป็น text จริงครั้งเดียว (ไม่ซ้ำ)', async () => {
    const blob = await renderProposalPdf({
      proposal: equipAircon,
      images: {
        trends: [
          {
            title: 'ดัชนีราคาผู้บริโภค (ทดสอบ unverified)',
            dataUrl: buildCheckerboardPngDataUrl(8),
            unverified: true,
          },
        ],
      },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    const allText = decodeAllPagesNormalized(buf);
    const noSpace = normalizedNoSpace(allText);
    expect(noSpace).toContain(normalizedNoSpace(translate('proposal.stat.unverified')));
    // ชื่อกราฟปรากฏเป็น PDF text จริงเพียงครั้งเดียว (SubHeading เหนือรูป) — ไม่ซ้ำสองครั้งเหมือนเดิม
    // (เดิมซ้ำกับ title ที่ raster เป็นพิกเซลในรูปเอง ซึ่งไม่นับเป็น PDF text อยู่แล้ว จึงนับจาก text ล้วน ๆ)
    expect(countOccurrences(noSpace, normalizedNoSpace('ดัชนีราคาผู้บริโภค(ทดสอบunverified)'))).toBe(1);
  }, 20_000);

  it('sections.trends=false → ไม่มีหัวข้อ/รูปกราฟแม้ส่ง images.trends มา (ปิดที่ระดับ ProposalDocument เอง)', async () => {
    const blob = await renderProposalPdf({
      proposal: equipAircon,
      images: { trends: [{ title: 'ทดสอบ', dataUrl: PNG_1X1 }] },
      sections: { trends: false },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    expect(pdfHasImageObject(buf)).toBe(false);
    const allText = decodeAllPagesNormalized(buf);
    expect(normalizedNoSpace(allText)).not.toContain(normalizedNoSpace(pdfCopy.section.trendImages));
  });

  it('sections.stats=false → ไม่มี headline ของ stat_cards บนหน้าปก', async () => {
    const withStatCards: Proposal = {
      ...equipAircon,
      stat_cards: [{ trend_ref: { kind: 'indicator', key: 'cpi' }, headline_th: 'CPI ทดสอบพิเศษ 999' }],
    };
    const blob = await renderProposalPdf({
      proposal: withStatCards,
      sections: { stats: false },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    const allText = decodeAllPagesNormalized(buf);
    expect(normalizedNoSpace(allText)).not.toContain(normalizedNoSpace('CPIทดสอบพิเศษ999'));
  });

  it('sections.assumptionsRisks=false → ไม่มีหัวข้อสมมติฐาน/ความเสี่ยง แม้ proposal มีข้อมูล', async () => {
    const blob = await renderProposalPdf({
      proposal: equipAircon, // fixture มี assumptions/risks จริง (ยืนยันใน describe แรกของไฟล์นี้)
      sections: { assumptionsRisks: false },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    const allText = decodeAllPagesNormalized(buf);
    expect(normalizedNoSpace(allText)).not.toContain(normalizedNoSpace(translate('proposal.sections.assumptions')));
    expect(normalizedNoSpace(allText)).not.toContain(normalizedNoSpace(translate('proposal.sections.risks')));
  });

  it('sections.comparables=false → ไม่มีหัวข้อเทียบเคียง แม้ proposal มีข้อมูล', async () => {
    const blob = await renderProposalPdf({
      proposal: equipAircon,
      sections: { comparables: false },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    const allText = decodeAllPagesNormalized(buf);
    expect(normalizedNoSpace(allText)).not.toContain(normalizedNoSpace(translate('proposal.sections.comparison')));
  });

  it('sections.illustrations=false → ไม่มีรูปภาพรวมโครงการแม้ส่ง images.overview มา', async () => {
    const blob = await renderProposalPdf({
      proposal: equipAircon,
      images: { overview: PNG_1X1 },
      sections: { illustrations: false },
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    expect(pdfHasImageObject(buf)).toBe(false);
  });

  it('S13: author (ผู้จัดทำ) แสดงบนหน้าปกเมื่อระบุ และไม่แสดงเมื่อไม่ระบุ', async () => {
    const withAuthor = await toBuffer(
      await renderProposalPdf({ proposal: equipAircon, author: 'กองบรรณาธิการข่าว ก', fontSource: TEST_FONT_SOURCE }),
    );
    expect(normalizedNoSpace(decodeAllPagesNormalized(withAuthor))).toContain(
      normalizedNoSpace('กองบรรณาธิการข่าวก'),
    );

    const withoutAuthor = await toBuffer(
      await renderProposalPdf({ proposal: equipAircon, fontSource: TEST_FONT_SOURCE }),
    );
    expect(normalizedNoSpace(decodeAllPagesNormalized(withoutAuthor))).not.toContain(
      normalizedNoSpace('กองบรรณาธิการข่าวก'),
    );
  }, 20_000);
});

describe('QA รอบภาพจริง — กันถอยหลังปัญหาที่ 1-3 (หัวตาราง BOQ, footer, hyphen แปลกปลอม)', () => {
  it('ปัญหาที่ 1: หัวตาราง BOQ ปรากฏเฉพาะหน้าที่มีแถว BOQ จริงเท่านั้น (0 บนหน้าอื่นทั้งหมด)', async () => {
    const boq = buildSyntheticBoq(60);
    const syntheticProposal: Proposal = { ...equipAircon, boq };
    const blob = await renderProposalPdf({
      proposal: syntheticProposal,
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);

    // ข้อความเฉพาะของหัวตาราง BOQ (ต่อ colBasis กับ colConfidence ตรงกับที่ ProposalDocument ประกอบจริง)
    const headerMarker = normalizedNoSpace(
      `${translate('proposal.boq.colBasis')}/${translate('proposal.boq.colConfidence')}`,
    );
    // ข้อความที่มีเฉพาะแถว BOQ จริง (ไม่ใช่หัวตาราง) — ใช้ label หน่วยที่ทุกแถวสังเคราะห์มี
    // main thread: แถว BOQ หนึ่ง ๆ มีป้าย basis ได้ 3 แบบ — เดิมใช้แค่ "historical" ทำให้หน้าสุดท้ายของตาราง
    // (เหลือแต่แถว market/estimate) ถูกนับเป็น "หน้าที่ไม่มีแถว BOQ" แล้วเทสตกทั้งที่ภาพจริงถูกต้อง
    // (ป้าย basis อย่างเดียวก็ไม่พอ: คำว่า "ประมาณการ" อยู่ใน footer ทุกหน้า) → ใช้รูป "<basis> · <confidence>"
    // ที่มีเฉพาะในเซลล์ของแถว BOQ
    const boqRowMarkers = (['historical', 'market', 'estimate'] as const).flatMap((basis) =>
      (['high', 'medium', 'low'] as const).map((confidence) =>
        normalizedNoSpace(
          `${translate(`proposal.basis.${basis}`)} · ${translate(`proposal.confidence.${confidence}`)}`,
        ),
      ),
    );

    const pageCount = pdfPageCount(buf);
    expect(pageCount).toBeGreaterThanOrEqual(4); // ปก + ก่อน BOQ + BOQ (หลายหน้า) + หลัง BOQ

    let pagesWithHeader = 0;
    let pagesWithBoqRows = 0;
    for (let i = 0; i < pageCount; i++) {
      const pageText = normalizedNoSpace(
        decodePageTextRuns(buf, i)
          .map((r) => r.text)
          .join(' '),
      );
      const hasHeader = pageText.includes(headerMarker);
      const hasBoqRow = boqRowMarkers.some((marker) => pageText.includes(marker));
      if (hasHeader) pagesWithHeader += 1;
      if (hasBoqRow) pagesWithBoqRows += 1;
      // หน้าไหนไม่มีแถว BOQ เลย ต้องไม่มีหัวตาราง BOQ โผล่มาด้วย (บั๊กเดิม: หัวตารางซ้ำทุกหน้าเพราะใช้
      // `fixed` ระดับ Page เดียวที่ครอบทุก section — ดู comment หัวไฟล์ ProposalDocument.tsx)
      if (!hasBoqRow) {
        expect(hasHeader).toBe(false);
      }
    }
    expect(pagesWithBoqRows).toBeGreaterThan(0);
    expect(pagesWithHeader).toBe(pagesWithBoqRows);
  }, 20_000);

  it('ปัญหาที่ 2: footer (เลขหน้า + disclaimer) ต้องปรากฏจริงทุกหน้า', async () => {
    const boq = buildSyntheticBoq(60);
    const syntheticProposal: Proposal = { ...equipAircon, boq };
    const blob = await renderProposalPdf({
      proposal: syntheticProposal,
      dataVersion: 'regression-test-version',
      fontSource: TEST_FONT_SOURCE,
    });
    const buf = await toBuffer(blob);
    const pageCount = pdfPageCount(buf);
    expect(pageCount).toBeGreaterThanOrEqual(4);

    const disclaimerMarker = normalizedNoSpace(pdfCopy.footer.disclaimer);
    for (let i = 0; i < pageCount; i++) {
      const pageText = normalizedNoSpace(
        decodePageTextRuns(buf, i)
          .map((r) => r.text)
          .join(' '),
      );
      expect(pageText).toContain(disclaimerMarker);
      // เลขหน้า "หน้า N / M" — ตรวจแค่ว่ามีคำว่า "หน้า" ตามด้วยตัวเลขปรากฏ (ไม่ผูกรูปแบบเป๊ะเพราะช่องว่าง
      // ถูกลบไปแล้วในขั้น normalize)
      expect(pageText).toMatch(/หน้า\d+\/\d+/);
    }
  }, 20_000);

  it('ปัญหาที่ 3: ไม่มี "-" (hyphen) แปลกปลอมจากการตัดบรรทัดไทย — จำนวน "-" ในผลลัพธ์ต้องเท่ากับต้นฉบับเป๊ะ', async () => {
    const element = ProposalDocument({ proposal: equipAircon });
    const texts: string[] = [];
    collectTextNodeStrings(element, texts);
    const expectedText = stripSoftBreaks(texts.join(''));
    const expectedHyphenCount = (expectedText.match(/-/g) ?? []).length;
    // sanity: fixture นี้ต้องมี "-" อยู่จริงอย่างน้อย 1 ตัว (เช่น "-0.14%" ในสมมติฐาน) ไม่งั้นเทสต์นี้
    // จะผ่านเฉย ๆ โดยไม่ได้พิสูจน์อะไร (ทั้งสองฝั่งเป็น 0 พร้อมกันได้)
    expect(expectedHyphenCount).toBeGreaterThan(0);

    const blob = await renderProposalPdf({ proposal: equipAircon, fontSource: TEST_FONT_SOURCE });
    const buf = await toBuffer(blob);
    const allText = decodeAllPagesNormalized(buf);
    const actualHyphenCount = (stripAllWhitespace(allText).match(/-/g) ?? []).length;

    expect(actualHyphenCount).toBe(expectedHyphenCount);
  }, 20_000);
});

describe('buildPdfFileName', () => {
  it('ตัดอักขระต้องห้ามของ Windows ออก และคงภาษาไทยไว้', () => {
    const name = buildPdfFileName({
      title: 'โครงการ: ซื้อ/ติดตั้ง "แอร์" <18,000 บีทียู> ปี*2569?',
      requester_context: { fiscal_year_be: 2569 },
    });
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name).toContain('แอร์');
    expect(name).toContain('2569');
  });

  it('ชื่อว่างเปล่า (เหลือแต่อักขระต้องห้าม) ได้ชื่อ fallback', () => {
    const name = buildPdfFileName({ title: '???///', requester_context: { fiscal_year_be: 2570 } });
    expect(name).toContain('ข้อเสนอโครงการ');
  });
});
