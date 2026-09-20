import type { ReactElement } from 'react';
import { LoadPage } from '@/features/export';

/**
 * T-502 — `/load` ของจริง (06 §3/§4.5): เปิดไฟล์ `.tgbp.json` แล้วแสดงอ่านอย่างเดียว ไม่ต้องใส่ key
 *
 * คงชื่อไฟล์/ชื่อ export `LoadPagePlaceholder` ไว้ตามเดิม (T-405 `App.tsx` import ชื่อนี้อยู่ — ห้ามแก้
 * `App.tsx`) — เนื้อในแทนที่ด้วย `LoadPage` จริงจาก `features/export` ทั้งหมดแล้ว
 */
export function LoadPagePlaceholder(): ReactElement {
  return <LoadPage />;
}
