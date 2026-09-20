/**
 * โหมดอ่านอย่างเดียวของ ProposalPane (หน้า `/load` — T-502): ครอบด้วย
 * `<ProposalReadOnlyContext.Provider value={true}>` แล้วช่องแก้ BOQ จะเป็นข้อความธรรมดา (กดแก้ไม่ได้)
 * และปุ่ม "ให้ AI ทบทวน" ถูกซ่อน — ใช้ context เพื่อไม่ต้องร้อย prop ผ่านทุกชั้นของตาราง (desktop + การ์ดมือถือ)
 */
import { createContext, useContext } from 'react';

export const ProposalReadOnlyContext = createContext(false);

export function useProposalReadOnly(): boolean {
  return useContext(ProposalReadOnlyContext);
}
