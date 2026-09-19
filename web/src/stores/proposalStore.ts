/**
 * T-403 — `proposalStore`: ประวัติเวอร์ชันของ proposal ในบทสนทนานี้ (04 §D7 slice `proposal`)
 *
 * ไม่มี `persist`/`devtools` middleware (09 §1) — ประวัติหายเมื่อปิด/รีเฟรชแท็บ (ผู้ใช้ export
 * `.tgbp.json` เองถ้าต้องการเก็บ — `features/export/tgbpFile.ts`)
 *
 * US-3.2/3.3: แก้ qty/unit_price ในตาราง BOQ → คำนวณ `total_thb`/`totals` ใหม่ทันทีด้วย pure
 * function (`boqMath.ts`) โดยไม่แตะ `basis`/`confidence`/`citations`/`rationale`; ทุกการแก้สร้าง
 * เวอร์ชันใหม่ต่อท้าย (`source: 'user_edit'`) เพื่อให้ผู้ใช้ย้อนดูเวอร์ชันก่อนหน้าได้เสมอ
 */
import { create } from 'zustand';
import type { Proposal } from '@/ai/tools/proposal';
import { recomputeBoqLine, recomputeTotals, type BoqLineEditInput } from './boqMath';
import { createId } from './id';

export type ProposalVersionSource = 'ai' | 'user_edit';

export interface ProposalVersion {
  id: string;
  proposal: Proposal;
  warnings: string[];
  createdAt: number;
  source: ProposalVersionSource;
  /** id ของบรรทัด BOQ ที่ผู้ใช้เคยแก้ไขสะสมมาถึงเวอร์ชันนี้ (ดูเหตุผลที่ไม่ใส่ใน `BoqLine` เองใน
   * `boqMath.ts`) */
  userEditedLineIds: string[];
}

export type UpdateBoqLineResult = { ok: true } | { ok: false; error: string };

export interface ProposalStoreState {
  versions: ProposalVersion[];
  /** -1 เมื่อยังไม่มีเวอร์ชันใดเลย */
  currentIndex: number;

  pushVersion: (proposal: Proposal, warnings: string[], source: ProposalVersionSource) => string;
  selectVersion: (index: number) => void;
  updateBoqLine: (lineId: string, edit: BoqLineEditInput) => UpdateBoqLineResult;
  reset: () => void;
}

export const useProposalStore = create<ProposalStoreState>((set, get) => ({
  versions: [],
  currentIndex: -1,

  pushVersion(proposal, warnings, source) {
    const state = get();
    const previous = state.currentIndex >= 0 ? state.versions[state.currentIndex] : undefined;
    const id = createId('propver');
    const version: ProposalVersion = {
      id,
      proposal,
      warnings,
      createdAt: Date.now(),
      source,
      userEditedLineIds: source === 'ai' ? [] : (previous?.userEditedLineIds ?? []),
    };
    set((s) => ({ versions: [...s.versions, version], currentIndex: s.versions.length }));
    return id;
  },

  selectVersion(index) {
    const { versions } = get();
    if (index < 0 || index >= versions.length) {
      return;
    }
    set({ currentIndex: index });
  },

  updateBoqLine(lineId, edit) {
    const { versions, currentIndex } = get();
    const current = versions[currentIndex];
    if (current === undefined) {
      return { ok: false, error: 'ยังไม่มีข้อเสนอให้แก้ไข' };
    }
    const lineIndex = current.proposal.boq.findIndex((l) => l.id === lineId);
    const line = lineIndex === -1 ? undefined : current.proposal.boq[lineIndex];
    if (line === undefined) {
      return { ok: false, error: `ไม่พบบรรทัด BOQ id=${lineId}` };
    }

    const recomputed = recomputeBoqLine(line, edit);
    if (!recomputed.ok) {
      return recomputed;
    }

    const nextBoq = current.proposal.boq.map((l, i) => (i === lineIndex ? recomputed.line : l));
    const nextTotals = recomputeTotals(nextBoq, current.proposal.totals);
    const nextProposal: Proposal = { ...current.proposal, boq: nextBoq, totals: nextTotals };
    const nextEditedIds = current.userEditedLineIds.includes(lineId)
      ? current.userEditedLineIds
      : [...current.userEditedLineIds, lineId];

    const version: ProposalVersion = {
      id: createId('propver'),
      proposal: nextProposal,
      warnings: current.warnings,
      createdAt: Date.now(),
      source: 'user_edit',
      userEditedLineIds: nextEditedIds,
    };
    set((s) => ({ versions: [...s.versions, version], currentIndex: s.versions.length }));
    return { ok: true };
  },

  reset() {
    set({ versions: [], currentIndex: -1 });
  },
}));

/** เวอร์ชันปัจจุบัน (หรือ `null` ถ้ายังไม่มี) — เขียนเป็นฟังก์ชันแยกเพื่อใช้เป็น selector ได้ตรง ๆ:
 * `useProposalStore(getCurrentProposalVersion)` */
export function getCurrentProposalVersion(state: ProposalStoreState): ProposalVersion | null {
  return state.currentIndex >= 0 ? (state.versions[state.currentIndex] ?? null) : null;
}
