/**
 * T-501/T-504 — เอกสาร PDF ของข้อเสนอโครงการ (`@react-pdf/renderer`)
 *
 * ไฟล์นี้ถูก reach ได้เฉพาะผ่าน dynamic `import('./ProposalDocument')` ใน `renderProposalPdf.tsx`
 * เท่านั้น (ไม่มีที่ไหนใน `src/**` import แบบ static) เพื่อให้ Vite แยก `@react-pdf/renderer` +
 * ไฟล์นี้เป็น lazy chunk แยกจาก initial bundle จริง (ตรวจด้วย `vite build` ท้าย task)
 *
 * ทุกข้อความที่ส่งเข้า `<Text>`/`<Link>` (ยกเว้น `src` ของ `<Link>` เอง ซึ่งต้องเป็น URL สะอาด) ต้องผ่าน
 * `t()` (= `toPdfText`, **ไม่ใช่** `t()` ของ `@/i18n` — ตั้งชื่อชนกันโดยตั้งใจ ดูคอมเมนต์ import ด้านล่าง)
 * เสมอ แก้บั๊กภาษาไทย 2 ข้อของ S4 (ดูหัวไฟล์ `thaiText.ts`)
 *
 * ข้อความ UI ภาษาไทย: ใช้ `translate()` (คือ `t` ของ `@/i18n`, T-401 `docs/ui/copy.th.json`) ก่อนเสมอ
 * ตาม CLAUDE.md §7 — ใช้ `pdfCopy` (`./copy.ts`) เฉพาะข้อความที่เป็นของ PDF ล้วน ๆ และยังไม่มี key ใน
 * copy.th.json (ดูคอมเมนต์หัวไฟล์ `copy.ts`)
 *
 * โครงหน้า (แก้ตาม QA รอบภาพจริง — ดูหัวไฟล์ `thaiText.ts`/`fonts.ts` สำหรับบั๊ก textkit ที่เกี่ยวข้อง):
 * แยกเป็น `<Page>` REACT element **หลายตัว** แทนที่จะยัดทุกอย่างใน `<Page wrap>` เดียว เพราะ `fixed`
 * (เช่นหัวตาราง BOQ) จะซ้ำ**ทุกหน้าที่เกิดจาก `<Page>` element เดียวกัน** ไม่ว่าหน้านั้นจะมีเนื้อหา
 * ส่วนไหนจริง ๆ ก็ตาม — ถ้ายัดทุกอย่างไว้ Page เดียวกัน หัวตาราง BOQ จะไปโผล่ที่หน้าซึ่งไม่มีแถว BOQ เลย
 * (ยืนยันด้วยภาพจริง) ⇒ แบ่งเป็น 4 กลุ่ม: ปก (เดี่ยว) / ก่อน BOQ (ถ้ามีเนื้อหา) / ตาราง BOQ / หลัง BOQ
 * — แต่ละกลุ่มมี footer ของตัวเอง (เห็นทุกหน้าจริงเพราะ `fixed` ของแต่ละกลุ่มไม่ปนกัน)
 */
import {
  Document,
  Image as PdfImage,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import type { AuditFinding, BoqLine, Citation, Comparable } from '@/ai/tools/proposal';
import { t as translate } from '@/i18n';
import { formatFiscalYearBe, formatNumber, formatThb } from '@/lib/format';
import {
  buildCitationRegistry,
  citationIndexesFor,
  toCitationIndexLookup,
  type CitationEntry,
  type CitationIndexLookup,
} from './citationRegistry';
import { pdfCopy } from './copy';
import { SARABUN_FONT_FAMILY } from './fonts';
import { formatThaiBuddhistDate } from './thaiDate';
import { toPdfText } from './thaiText';
import type { ProposalDocumentProps } from './types';

/** ตัวช่วยหลัก: ทุกสตริงที่ส่งเข้า `<Text>` ต้องผ่านนี่เสมอ (แก้บั๊กไทยของ S4 — ดู thaiText.ts) */
function t(text: string): string {
  return toPdfText(text);
}

const MODE_LABEL_KEY = {
  audit: 'chat.modeAudit',
  draft: 'chat.modeDraft',
} as const;

const BASIS_LABEL_KEY = {
  historical: 'proposal.basis.historical',
  market: 'proposal.basis.market',
  estimate: 'proposal.basis.estimate',
} as const;

const CONFIDENCE_LABEL_KEY = {
  high: 'proposal.confidence.high',
  medium: 'proposal.confidence.medium',
  low: 'proposal.confidence.low',
} as const;

/** จำนวน pt ขั้นต่ำที่ต้องเหลือใต้หัวข้อก่อนตัดหน้า — กันหัวข้อกำพร้า (ปัญหาที่ 5 จาก QA รอบภาพจริง) */
const HEADING_MIN_PRESENCE_AHEAD = 40;
const SUBHEADING_MIN_PRESENCE_AHEAD = 24;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const COLOR_TEXT = '#1a1a1a';
const COLOR_MUTED = '#5b5b5b';
const COLOR_BORDER = '#c9c9c9';
const COLOR_HEADER_BG = '#e8eef7';
const COLOR_ESTIMATE = '#a15c00';
const COLOR_MARKET = '#0f5fa8';
const COLOR_HISTORICAL = '#1f7a3d';
const COLOR_BADGE_BG = '#fff2cc';
const COLOR_EDITED_BG = '#e6f0ff';

/** บรรทัด content ที่อาจตัดหลายบรรทัด (ไม่ใช่ label สั้นบรรทัดเดียว) ต้องมี lineHeight ≥ 1.35 เสมอ (ปัญหา
 * ที่ 4 จาก QA รอบภาพจริง) — **ห้ามตั้งค่านี้ที่ `S.page` เด็ดขาด**: `fixed`+`render` (footer เลขหน้า)
 * จะหาย/เลื่อนไปนอกหน้ากระดาษถ้า `lineHeight` ถูกตั้งที่ระดับ Page แล้วมีเนื้อหาอื่นตัดมากกว่า 1 บรรทัด
 * (บั๊กของ `@react-pdf/layout`'s `measure()` สำหรับ dynamic fixed node — ยืนยันด้วยการ bisect สไตล์จริง
 * ระหว่าง QA รอบภาพ: ตัดปัญหาได้ทันทีเมื่อย้าย `lineHeight` ออกจาก Page ไปใส่ที่ content style แทน)
 */
const CONTENT_LINE_HEIGHT = 1.4;

const S = StyleSheet.create({
  page: {
    fontFamily: SARABUN_FONT_FAMILY,
    fontSize: 9.5,
    padding: 32,
    paddingBottom: 44,
    color: COLOR_TEXT,
  },
  coverTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 12, lineHeight: 1.35 },
  aiBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLOR_BADGE_BG,
    borderWidth: 1,
    borderColor: '#c9a227',
    borderRadius: 3,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  coverMetaRow: { flexDirection: 'row', marginBottom: 4 },
  coverMetaLabel: { width: '32%', color: COLOR_MUTED },
  coverMetaValue: { width: '68%', fontWeight: 'bold', lineHeight: CONTENT_LINE_HEIGHT },
  h1: { fontSize: 14, fontWeight: 'bold', marginTop: 16, marginBottom: 8, lineHeight: 1.3 },
  h2: { fontSize: 11, fontWeight: 'bold', marginTop: 10, marginBottom: 6, lineHeight: 1.3 },
  p: { marginBottom: 6, lineHeight: CONTENT_LINE_HEIGHT },
  muted: { color: COLOR_MUTED, lineHeight: CONTENT_LINE_HEIGHT },
  bullet: { flexDirection: 'row', marginBottom: 4 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1, lineHeight: CONTENT_LINE_HEIGHT },
  image: {
    width: '100%',
    maxHeight: 260,
    marginTop: 4,
    marginBottom: 4,
    objectFit: 'contain',
    borderWidth: 0.5,
    borderColor: COLOR_BORDER,
  },
  imageCaption: {
    fontSize: 8,
    color: COLOR_MUTED,
    marginBottom: 10,
    lineHeight: CONTENT_LINE_HEIGHT,
  },

  highlightBox: {
    borderWidth: 0.5,
    borderColor: COLOR_BORDER,
    borderRadius: 3,
    padding: 10,
    marginTop: 14,
  },
  highlightLabel: { fontSize: 9, color: COLOR_MUTED, marginBottom: 2 },
  highlightValue: { fontSize: 22, fontWeight: 'bold' },
  highlightNote: {
    fontSize: 8.5,
    color: COLOR_ESTIMATE,
    marginTop: 4,
    lineHeight: CONTENT_LINE_HEIGHT,
  },
  highlightStatItem: { fontSize: 9, marginTop: 4, lineHeight: CONTENT_LINE_HEIGHT },

  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: COLOR_HEADER_BG,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingVertical: 3,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR_BORDER,
    paddingVertical: 3,
  },
  cellHeader: { fontSize: 8.5, fontWeight: 'bold', paddingHorizontal: 3 },
  boqNo: { width: '5%', paddingHorizontal: 3 },
  boqItem: { width: '27%', paddingHorizontal: 3 },
  boqQty: { width: '8%', paddingHorizontal: 3, textAlign: 'right' },
  boqUnit: { width: '8%', paddingHorizontal: 3 },
  boqUnitPrice: { width: '13%', paddingHorizontal: 3, textAlign: 'right' },
  boqTotal: { width: '13%', paddingHorizontal: 3, textAlign: 'right' },
  boqBasis: { width: '26%', paddingHorizontal: 3 },
  itemSpec: { fontSize: 8, color: COLOR_MUTED, marginTop: 1, lineHeight: CONTENT_LINE_HEIGHT },
  basisLabel: { fontWeight: 'bold' },
  editedBadge: {
    backgroundColor: COLOR_EDITED_BG,
    fontSize: 7.5,
    borderRadius: 2,
    paddingHorizontal: 3,
    marginTop: 1,
    alignSelf: 'flex-start',
  },

  totalsRow: { flexDirection: 'row', marginBottom: 3 },
  totalsLabel: { width: '55%' },
  totalsValue: { width: '45%', textAlign: 'right', fontWeight: 'bold' },
  grandTotalRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 4,
    marginTop: 4,
  },
  grandTotalLabel: { width: '55%', fontSize: 11, fontWeight: 'bold' },
  grandTotalValue: { width: '45%', textAlign: 'right', fontSize: 11, fontWeight: 'bold' },

  comparableCard: {
    borderWidth: 0.5,
    borderColor: COLOR_BORDER,
    borderRadius: 2,
    padding: 6,
    marginBottom: 6,
  },
  comparableRow: { flexDirection: 'row', marginBottom: 2 },
  comparableText: { lineHeight: CONTENT_LINE_HEIGHT },

  citationItem: { marginBottom: 5 },
  citationIndex: { fontWeight: 'bold' },
  citationText: { lineHeight: CONTENT_LINE_HEIGHT },
  link: { color: '#1a56b8', textDecoration: 'underline' },

  warningItem: { marginBottom: 3, color: '#8a1f11', lineHeight: CONTENT_LINE_HEIGHT },

  footer: {
    position: 'absolute',
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 7.5,
    color: COLOR_MUTED,
    textAlign: 'center',
  },
});

const BASIS_COLOR: Record<BoqLine['basis'], string> = {
  historical: COLOR_HISTORICAL,
  market: COLOR_MARKET,
  estimate: COLOR_ESTIMATE,
};

// ---------------------------------------------------------------------------
// Small presentational helpers (JSX) — logic ที่ pure ล้วน ๆ อยู่ใน citationRegistry.ts/thaiText.ts
// ---------------------------------------------------------------------------

/** หัวข้อ section มาตรฐาน — มี `minPresenceAhead` เสมอกันหัวข้อลอยเดี่ยวท้ายหน้า (ปัญหาที่ 5) */
function SectionHeading({ children }: { children: string }) {
  return (
    <Text style={S.h1} minPresenceAhead={HEADING_MIN_PRESENCE_AHEAD}>
      {t(children)}
    </Text>
  );
}

function SubHeading({ children }: { children: string }) {
  return (
    <Text style={S.h2} minPresenceAhead={SUBHEADING_MIN_PRESENCE_AHEAD}>
      {t(children)}
    </Text>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={S.bullet} wrap={false}>
      <Text style={S.bulletDot}>{t('•')}</Text>
      <Text style={S.bulletText}>{t(text)}</Text>
    </View>
  );
}

function citationMarkers(citations: readonly Citation[], lookup: CitationIndexLookup): string {
  const indexes = citationIndexesFor(citations, lookup);
  return indexes.map((i) => `[${String(i)}]`).join('');
}

function BoqHeaderRow() {
  return (
    <View style={S.tableHeaderRow} fixed>
      <Text style={[S.cellHeader, S.boqNo]}>{t(pdfCopy.boqTable.no)}</Text>
      <Text style={[S.cellHeader, S.boqItem]}>{t(translate('proposal.boq.colItem'))}</Text>
      <Text style={[S.cellHeader, S.boqQty]}>{t(translate('proposal.boq.colQty'))}</Text>
      <Text style={[S.cellHeader, S.boqUnit]}>{t(translate('proposal.boq.colUnit'))}</Text>
      <Text style={[S.cellHeader, S.boqUnitPrice]}>
        {t(translate('proposal.boq.colUnitPrice'))}
      </Text>
      <Text style={[S.cellHeader, S.boqTotal]}>{t(translate('proposal.boq.colAmount'))}</Text>
      <Text style={[S.cellHeader, S.boqBasis]}>
        {t(`${translate('proposal.boq.colBasis')} / ${translate('proposal.boq.colConfidence')}`)}
      </Text>
    </View>
  );
}

function BoqRow({
  line,
  no,
  lookup,
  edited,
}: {
  line: BoqLine;
  no: number;
  lookup: CitationIndexLookup;
  edited: boolean;
}) {
  const markers = citationMarkers(line.citations, lookup);
  const basisLabel = translate(BASIS_LABEL_KEY[line.basis]);
  const confidenceLabel = translate(CONFIDENCE_LABEL_KEY[line.confidence]);
  return (
    <View style={S.tableRow} wrap={false}>
      <Text style={S.boqNo}>{t(String(no))}</Text>
      <View style={S.boqItem}>
        <Text>{t(line.item)}</Text>
        {line.spec !== undefined ? <Text style={S.itemSpec}>{t(line.spec)}</Text> : null}
      </View>
      <Text style={S.boqQty}>{t(formatNumber(line.qty))}</Text>
      <Text style={S.boqUnit}>{t(line.unit)}</Text>
      <Text style={S.boqUnitPrice}>{t(formatThb(line.unit_price_thb))}</Text>
      <Text style={S.boqTotal}>{t(formatThb(line.total_thb))}</Text>
      <View style={S.boqBasis}>
        <Text style={[S.basisLabel, { color: BASIS_COLOR[line.basis] }]}>
          {t(`${basisLabel} · ${confidenceLabel}${markers}`)}
        </Text>
        {edited ? (
          <Text style={S.editedBadge}>{t(translate('proposal.boq.editedBadge'))}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** ปัญหาที่ 8 จาก QA รอบภาพจริง: `ComparableSchema` ไม่มี field แยกว่า `unit_price_thb` เป็น "ราคาต่อ
 * หน่วยจริง" หรือ "ยอดรวมของบรรทัดงบ" (เมื่อ qty=1 ทั้งสองอย่างจะเท่ากันเสมอ) — ใช้ heuristic: ถ้า
 * `unit_price_thb` เท่ากับ `amount_thb` เป๊ะ ให้ถือว่าไม่มีข้อมูลราคาต่อหน่วยที่ต่างจากยอดรวมจริง ๆ จึงไม่
 * ควรติดป้าย "ราคา/หน่วย" ซ้ำ (สับสนว่าเป็นค่าคนละความหมาย) — รายงานข้อจำกัดนี้ไว้ใน task report */
function shouldShowComparableUnitPrice(comparable: Comparable): boolean {
  return (
    comparable.unit_price_thb !== undefined && comparable.unit_price_thb !== comparable.amount_thb
  );
}

function ComparableCard({ comparable }: { comparable: Comparable }) {
  const showUnitPrice = shouldShowComparableUnitPrice(comparable);
  return (
    <View style={S.comparableCard} wrap={false}>
      <View style={S.comparableRow}>
        <Text style={[S.comparableText, { width: '50%' }]}>
          {t(`${translate('citation.budgetLine.agency')}: ${comparable.agency}`)}
        </Text>
        <Text style={[S.comparableText, { width: '50%' }]}>
          {t(
            `${translate('citation.budgetLine.year')}: ${formatFiscalYearBe(comparable.fiscal_year_be, { withEra: true })}`,
          )}
        </Text>
      </View>
      <Text style={[S.comparableText, { marginBottom: 2 }]}>
        {t(`${translate('proposal.boq.colItem')}: ${comparable.item_name}`)}
      </Text>
      <View style={S.comparableRow}>
        <Text style={[S.comparableText, { width: showUnitPrice ? '50%' : '100%' }]}>
          {t(`${pdfCopy.comparablesTable.amount}: ${formatThb(comparable.amount_thb)}`)}
        </Text>
        {showUnitPrice ? (
          <Text style={[S.comparableText, { width: '50%' }]}>
            {t(
              `${translate('proposal.boq.colUnitPrice')}: ${formatThb(comparable.unit_price_thb ?? 0)}`,
            )}
          </Text>
        ) : null}
      </View>
      <Text style={[S.muted, S.comparableText]}>
        {t(`${pdfCopy.comparablesTable.similarity}: ${comparable.similarity_note}`)}
      </Text>
    </View>
  );
}

function AuditFindingItem({
  finding,
  index,
  lookup,
}: {
  finding: AuditFinding;
  index: number;
  lookup: CitationIndexLookup;
}) {
  const markers = citationMarkers(finding.citations, lookup);
  return (
    <View style={S.bullet} wrap={false}>
      <Text style={S.bulletDot}>{t(String(index))}.</Text>
      <Text style={S.bulletText}>
        {t(`[${pdfCopy.severity[finding.severity]}] ${finding.text}${markers}`)}
      </Text>
    </View>
  );
}

function CitationDetailText({
  citation,
  documentProps,
}: {
  citation: Citation;
  documentProps: ProposalDocumentProps;
}) {
  switch (citation.kind) {
    case 'budget_line': {
      const detail = documentProps.budgetLineDetails?.[citation.source_id];
      const parts = [
        `${translate('citation.types.budget_line')} — source_id: ${citation.source_id}`,
      ];
      if (detail?.dataset !== undefined) parts.push(`dataset: ${detail.dataset}`);
      if (detail?.fiscalYearBe !== undefined) {
        parts.push(
          `${translate('citation.budgetLine.year')} ${formatFiscalYearBe(detail.fiscalYearBe, { withEra: true })}`,
        );
      }
      if (detail?.agency !== undefined) {
        parts.push(`${translate('citation.budgetLine.agency')}: ${detail.agency}`);
      }
      if (detail?.itemNameRaw !== undefined) parts.push(detail.itemNameRaw);
      if (detail?.amountThb !== undefined) {
        parts.push(`${pdfCopy.citations.amountPrefix}: ${formatThb(detail.amountThb)}`);
      }
      const sourceBits = [detail?.sourcePath, detail?.sheet, detail?.row?.toString()].filter(
        (x): x is string => x !== undefined,
      );
      if (sourceBits.length > 0) {
        parts.push(`${translate('citation.sourcePath')}: ${sourceBits.join(' / ')}`);
      }
      if (citation.note !== undefined) parts.push(citation.note);
      return <Text style={S.citationText}>{t(parts.join(' — '))}</Text>;
    }
    case 'document': {
      const detail = documentProps.documentDetails?.[citation.doc_id];
      const title = detail?.title ?? citation.doc_id;
      const pageText =
        citation.page !== undefined
          ? ` ${translate('citation.page', { page: citation.page })}`
          : '';
      const quoteText = citation.quote !== undefined ? ` — "${citation.quote}"` : '';
      return (
        <Text style={S.citationText}>
          {t(`${translate('citation.types.document')} — ${title}${pageText}${quoteText}`)}
        </Text>
      );
    }
    case 'econ': {
      const key = `${citation.indicator}@${String(citation.year_be)}`;
      const detail = documentProps.econValues?.[key];
      const valueText =
        detail?.value !== undefined
          ? `${formatNumber(detail.value)}${detail.unit !== undefined ? ` ${detail.unit}` : ''}`
          : pdfCopy.noData;
      const verifiedText =
        detail?.verified === true ? '' : ` (${translate('citation.econ.unverified')})`;
      return (
        <Text style={S.citationText}>
          {t(
            `${translate('citation.types.econ')} — ${citation.indicator} ปี${formatFiscalYearBe(citation.year_be, { withEra: true })}: ${valueText}${verifiedText}`,
          )}
        </Text>
      );
    }
    case 'web': {
      const label = citation.title ?? citation.url;
      const meta =
        translate('citation.retrievedAt', { date: citation.retrieved_at }) +
        (citation.price_note !== undefined ? ` — ${citation.price_note}` : '');
      if (citation.url.startsWith('https://')) {
        return (
          <Text style={S.citationText}>
            <Text>{t(`${translate('citation.types.web')} — `)}</Text>
            <Link src={citation.url} style={S.link}>
              {t(label)}
            </Link>
            <Text>{t(` (${meta})`)}</Text>
          </Text>
        );
      }
      // AC (05-FEATURES §F4/§D9): URL ที่ไม่ใช่ https ต้องแสดงเป็นข้อความ ไม่ใช่ลิงก์ที่กดได้
      return (
        <Text style={S.citationText}>
          {t(`${translate('citation.types.web')} — ${label} (${meta})`)}
        </Text>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function ProposalDocument(props: ProposalDocumentProps) {
  const { proposal } = props;
  const generatedAt = props.generatedAt ?? new Date();
  const editedLineIds = new Set(props.editedLineIds ?? []);
  const registry: CitationEntry[] = buildCitationRegistry(proposal);
  const lookup = toCitationIndexLookup(registry);
  const warnings = props.warnings ?? [];
  const estimateLineCount = proposal.boq.filter((l) => l.basis === 'estimate').length;

  function Footer() {
    return (
      <Text
        style={S.footer}
        fixed
        render={({ pageNumber, totalPages }) =>
          `${pdfCopy.footer.pageOf(pageNumber, totalPages)}  ·  ${pdfCopy.footer.disclaimer}` +
          (props.dataVersion !== undefined
            ? `  ·  ${pdfCopy.footer.dataVersionPrefix}: ${props.dataVersion}`
            : '')
        }
      />
    );
  }

  const hasOverviewImage = props.images?.overview !== undefined;
  const hasTrendImages = props.images?.trends !== undefined && props.images.trends.length > 0;
  const hasBeforeBoqContent =
    hasOverviewImage ||
    proposal.illustrations.length > 0 ||
    proposal.objectives.length > 0 ||
    proposal.scope_and_specs.length > 0 ||
    hasTrendImages;

  return (
    <Document
      title={proposal.title}
      author="Thai Government Budget Planner"
      subject="ข้อเสนอโครงการ"
    >
      {/* หน้าปก — เดี่ยวเสมอ (ไม่ควรล้นหน้าถ้าข้อมูล requester_context/summary ไม่ยาวผิดปกติ) */}
      <Page size="A4" style={S.page}>
        <Text style={S.aiBadge}>{t(pdfCopy.cover.aiDraftBadge)}</Text>
        <Text style={S.coverTitle}>{t(proposal.title)}</Text>

        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>{t(translate('chat.modeLabel'))}</Text>
          <Text style={S.coverMetaValue}>{t(translate(MODE_LABEL_KEY[proposal.mode]))}</Text>
        </View>
        {proposal.requester_context.owner_agency !== undefined ? (
          <View style={S.coverMetaRow}>
            <Text style={S.coverMetaLabel}>{t(translate('citation.budgetLine.agency'))}</Text>
            <Text style={S.coverMetaValue}>{t(proposal.requester_context.owner_agency)}</Text>
          </View>
        ) : null}
        {proposal.requester_context.area !== undefined ? (
          <View style={S.coverMetaRow}>
            <Text style={S.coverMetaLabel}>{t(translate('proposal.checklistWhere'))}</Text>
            <Text style={S.coverMetaValue}>{t(proposal.requester_context.area)}</Text>
          </View>
        ) : null}
        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>{t(translate('citation.budgetLine.year'))}</Text>
          <Text style={S.coverMetaValue}>
            {t(formatFiscalYearBe(proposal.requester_context.fiscal_year_be, { withEra: true }))}
          </Text>
        </View>
        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>{t(pdfCopy.cover.generatedAtLabel)}</Text>
          <Text style={S.coverMetaValue}>{t(formatThaiBuddhistDate(generatedAt))}</Text>
        </View>

        <SectionHeading>{translate('proposal.sections.summary')}</SectionHeading>
        <Text style={S.p}>{t(proposal.summary)}</Text>

        {/* ปัญหาที่ 7 จาก QA รอบภาพจริง: หน้าปกโล่งเกินไป — ดึงยอดรวมทั้งสิ้น + ตัวเลขสถิติเด่นมาไว้
            ต่อจากสรุปแทน (รายละเอียดเต็มของยอดรวมยังอยู่ในส่วน "สรุปยอดรวม" หลังตาราง BOQ ตามเดิม) */}
        <View style={S.highlightBox} wrap={false}>
          <Text style={S.highlightLabel}>{t(translate('proposal.boq.grandTotal'))}</Text>
          <Text style={S.highlightValue}>{t(formatThb(proposal.totals.grand_total_thb))}</Text>
          {estimateLineCount > 0 ? (
            <Text style={S.highlightNote}>
              {t(
                `${String(estimateLineCount)} จาก ${String(proposal.boq.length)} รายการเป็นประมาณการ (${translate('proposal.basis.estimate')}) — ตรวจสอบก่อนใช้อ้างอิง`,
              )}
            </Text>
          ) : null}
          {proposal.stat_cards.map((card, i) => (
            <Text key={i} style={S.highlightStatItem}>
              {t(`• ${card.headline_th}`)}
            </Text>
          ))}
        </View>

        <Footer />
      </Page>

      {/* ก่อน BOQ — เฉพาะเมื่อมีเนื้อหาจริง กันหน้าเปล่า (ไม่มี stat_cards ซ้ำ — ย้ายไปหน้าปกแล้วข้างบน) */}
      {hasBeforeBoqContent ? (
        <Page size="A4" style={S.page} wrap>
          {hasOverviewImage && props.images?.overview !== undefined ? (
            <View wrap={false}>
              <SectionHeading>{translate('proposal.sections.illustration')}</SectionHeading>
              <PdfImage src={props.images.overview} style={S.image} />
              <Text style={S.imageCaption}>{t(pdfCopy.cover.illustrationCaption)}</Text>
            </View>
          ) : null}

          {proposal.illustrations.length > 0 ? (
            <View>
              {proposal.illustrations.map((illustration) => (
                <Text key={illustration.illustration_id} style={S.imageCaption}>
                  {t(`${illustration.title} — ${illustration.caption} (ภาพประกอบโดย AI)`)}
                </Text>
              ))}
            </View>
          ) : null}

          {proposal.objectives.length > 0 ? (
            <View>
              <SectionHeading>{translate('proposal.sections.objective')}</SectionHeading>
              {proposal.objectives.map((o, i) => (
                <Bullet key={i} text={o} />
              ))}
            </View>
          ) : null}

          {proposal.scope_and_specs.length > 0 ? (
            <View>
              <SectionHeading>{translate('proposal.sections.scope')}</SectionHeading>
              {proposal.scope_and_specs.map((section, i) => (
                <View key={i}>
                  <SubHeading>{section.section}</SubHeading>
                  {section.items.map((item, j) => (
                    <Bullet key={j} text={item} />
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {hasTrendImages && props.images?.trends !== undefined ? (
            <View>
              <SectionHeading>{pdfCopy.section.trendImages}</SectionHeading>
              {props.images.trends.map((trend, i) => (
                <View key={i} wrap={false}>
                  <SubHeading>{trend.title}</SubHeading>
                  <PdfImage src={trend.dataUrl} style={S.image} />
                </View>
              ))}
            </View>
          ) : null}

          <Footer />
        </Page>
      ) : null}

      {/* ตาราง BOQ — Page แยกของตัวเอง เพื่อให้หัวตาราง (fixed) ซ้ำเฉพาะหน้าที่มีแถว BOQ จริงเท่านั้น */}
      <Page size="A4" style={S.page} wrap>
        <SectionHeading>{translate('proposal.sections.boq')}</SectionHeading>
        <BoqHeaderRow />
        {proposal.boq.map((line, i) => (
          <BoqRow
            key={line.id}
            line={line}
            no={i + 1}
            lookup={lookup}
            edited={editedLineIds.has(line.id)}
          />
        ))}
        <Footer />
      </Page>

      {/* หลัง BOQ */}
      <Page size="A4" style={S.page} wrap>
        <View wrap={false}>
          <SectionHeading>{pdfCopy.section.totals}</SectionHeading>
          <View style={S.totalsRow}>
            <Text style={S.totalsLabel}>{t(pdfCopy.totals.subtotal)}</Text>
            <Text style={S.totalsValue}>{t(formatThb(proposal.totals.subtotal_thb))}</Text>
          </View>
          {proposal.totals.contingency_thb !== undefined ||
          proposal.totals.contingency_pct !== undefined ? (
            <View style={S.totalsRow}>
              <Text style={S.totalsLabel}>
                {t(
                  proposal.totals.contingency_pct !== undefined
                    ? `${pdfCopy.totals.contingency} (${String(proposal.totals.contingency_pct)}%)`
                    : pdfCopy.totals.contingency,
                )}
              </Text>
              <Text style={S.totalsValue}>
                {t(formatThb(proposal.totals.contingency_thb ?? 0))}
              </Text>
            </View>
          ) : null}
          <View style={S.totalsRow}>
            <Text style={S.totalsLabel}>
              {t(
                proposal.totals.vat_included
                  ? pdfCopy.totals.vatIncluded
                  : pdfCopy.totals.vatNotIncluded,
              )}
            </Text>
            <Text style={S.totalsValue} />
          </View>
          <View style={S.grandTotalRow}>
            <Text style={S.grandTotalLabel}>{t(translate('proposal.boq.grandTotal'))}</Text>
            <Text style={S.grandTotalValue}>{t(formatThb(proposal.totals.grand_total_thb))}</Text>
          </View>
        </View>

        {proposal.assumptions.length > 0 ? (
          <View>
            <SectionHeading>{translate('proposal.sections.assumptions')}</SectionHeading>
            {proposal.assumptions.map((a, i) => (
              <Bullet key={i} text={`[${pdfCopy.impact[a.impact]}] ${a.text}`} />
            ))}
          </View>
        ) : null}

        {proposal.risks.length > 0 ? (
          <View>
            <SectionHeading>{translate('proposal.sections.risks')}</SectionHeading>
            {proposal.risks.map((r, i) => (
              <Bullet
                key={i}
                text={r.mitigation !== undefined ? `${r.text} — ${r.mitigation}` : r.text}
              />
            ))}
          </View>
        ) : null}

        {proposal.comparables.length > 0 ? (
          <View>
            {/* main thread (QA รอบภาพ): `minPresenceAhead` ของหัวข้อไม่ช่วยเมื่อสิ่งที่ตามมาเป็นการ์ด
                `wrap={false}` ทั้งก้อน (หัวข้อค้างท้ายหน้า การ์ดไปหน้าถัดไป) → มัดหัวข้อกับการ์ดใบแรกไว้ด้วยกัน */}
            <View wrap={false}>
              <SectionHeading>{translate('proposal.sections.comparison')}</SectionHeading>
              {proposal.comparables[0] !== undefined ? (
                <ComparableCard comparable={proposal.comparables[0]} />
              ) : null}
            </View>
            {proposal.comparables.slice(1).map((c, i) => (
              <ComparableCard key={i} comparable={c} />
            ))}
          </View>
        ) : null}

        {proposal.mode === 'audit' &&
        proposal.audit_findings !== undefined &&
        proposal.audit_findings.length > 0 ? (
          <View>
            <SectionHeading>{translate('proposal.sections.audit')}</SectionHeading>
            {proposal.audit_findings.map((f, i) => (
              <AuditFindingItem key={i} finding={f} index={i + 1} lookup={lookup} />
            ))}
          </View>
        ) : null}

        {proposal.open_questions.length > 0 ? (
          <View>
            <SectionHeading>{translate('proposal.sections.openQuestions')}</SectionHeading>
            {proposal.open_questions.map((q, i) => (
              <Bullet key={i} text={q} />
            ))}
          </View>
        ) : null}

        {registry.length > 0 ? (
          <View>
            <SectionHeading>{pdfCopy.section.citationsAppendix}</SectionHeading>
            {registry.map((entry) => (
              <View key={entry.index} style={S.citationItem} wrap={false}>
                <Text>
                  <Text style={S.citationIndex}>{t(`[${String(entry.index)}] `)}</Text>
                  <CitationDetailText citation={entry.citation} documentProps={props} />
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {warnings.length > 0 ? (
          <View>
            <SectionHeading>{pdfCopy.section.validatorWarnings}</SectionHeading>
            {warnings.map((w, i) => (
              <Text key={i} style={S.warningItem}>
                {t(`• ${w}`)}
              </Text>
            ))}
          </View>
        ) : null}

        <Footer />
      </Page>
    </Document>
  );
}
