/**
 * T-406 — ชนิดข้อมูลของ `ProposalPane` (props-driven, presentational เท่านั้น — ไม่มี fetch/store)
 *
 * import จาก `@/ai/tools/proposal` แบบ **type-only** เท่านั้น (ขอบเขตงาน T-406 — ห้ามแตะ `src/ai/**`)
 * บาง type ย่อย (Assumption/Risk/ScopeSection/RequesterContext) ไม่ได้ถูก export ตรง ๆ จากไฟล์นั้น
 * (มีแต่ schema, ไม่มี `export type Assumption = ...`) จึงดึงด้วย indexed-access type จาก `Proposal`
 * แทนการเพิ่ม export ใหม่ในไฟล์ที่ไม่ได้เป็นเจ้าของ
 */
import type { ReactNode } from 'react';
import type {
  AuditFinding,
  BoqLine,
  Citation,
  Comparable,
  Confidence,
  IllustrationRef,
  Proposal,
  StatCard,
  Totals,
  TrendRef,
} from '@/ai/tools/proposal';

export type Assumption = Proposal['assumptions'][number];
export type Risk = Proposal['risks'][number];
export type ScopeSection = Proposal['scope_and_specs'][number];
export type RequesterContext = Proposal['requester_context'];
export type WebCitation = Proposal['citations_web'][number];

export interface ProposalVersionInfo {
  index: number;
  label: string;
  createdAt: string;
  source: 'ai' | 'user_edit';
}

export interface LineEditPatch {
  qty?: number;
  unit_price_thb?: number;
}

export interface ProposalPaneProps {
  proposal: Proposal | null;
  /** คำเตือนจาก `validateAndNormalizeProposal` (ไม่ใช่ audit_findings ของ proposal เอง) */
  warnings: string[];
  versions: ProposalVersionInfo[];
  currentVersionIndex: number;
  onSelectVersion: (index: number) => void;
  /** id ของบรรทัด BOQ ที่ผู้ใช้เคยแก้ไขเองในเวอร์ชันปัจจุบัน */
  editedLineIds: string[];
  onEditLine: (lineId: string, patch: LineEditPatch) => void;
  /** ส่งคำขอให้ AI ทบทวน — `lineId` undefined = ทบทวนทั้งข้อเสนอ/ข้อควรระวังโดยรวม */
  onRequestReview: (lineId?: string) => void;
  onOpenCitation: (citation: Citation, line?: BoqLine) => void;
  onExport: () => void;
  onSave: () => void;
  isAiRunning: boolean;
  /** ป้าย citation chip แบบละเอียด (เช่น "PBO 2566 · กรมพลังงาน") ที่ resolve จาก `SourceFingerprint`
   * ของ `ToolLog` แล้ว (T-405/406 ต่อสาย) — คืน `undefined` = ใช้ label ย่อเดิม (`citationChipLabel`)
   * ไม่ส่ง prop นี้มาเลย = พฤติกรรมเดิมทุกกรณี (ไม่ทำลาย test เดิมของ T-406) */
  resolveCitationLabel?: (citation: Citation) => string | undefined;
  /** ช่องสำหรับ component จาก `components/viz/**` (T-412, กำลังทำขนาน) — ยังไม่มีให้ = ไม่แสดงส่วนนี้ */
  renderStatCards?: (cards: StatCard[]) => ReactNode;
  renderTrend?: (trendRef: TrendRef) => ReactNode;
  renderIllustration?: (ref: IllustrationRef) => ReactNode;
}

export type {
  AuditFinding,
  BoqLine,
  Citation,
  Comparable,
  Confidence,
  IllustrationRef,
  Proposal,
  StatCard,
  Totals,
  TrendRef,
};
