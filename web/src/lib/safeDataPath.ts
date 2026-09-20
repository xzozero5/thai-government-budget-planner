/**
 * ตัวตรวจ "relative path ปลอดภัย" ใช้ร่วมกันระหว่าง:
 * - `data/manifest.ts#assertSafeRelativePath` (path ของไฟล์ static ใต้ `data/` ที่ `dataUrl()` ต่อ URL ให้)
 * - `features/export/tgbpFile.ts` (`sourceShards[sourceId]` ที่บันทึกไว้ในไฟล์ `.tgbp.json` — เป็น
 *   hint ของ shard path เดียวกัน ต้องผ่านกฎเดียวกันเป๊ะ เพราะสุดท้ายถูกส่งเข้า `data.getLines`/
 *   `dataUrl()` เหมือนกัน)
 *
 * กฎ (N5 — ห้าม fetch ข้าม origin, ห้าม path traversal): ห้ามว่าง, ห้ามขึ้นต้นด้วย "/", ห้ามมี
 * scheme/origin อื่น (`https:`, `//evil.example`), ห้ามมี segment "..", ห้ามมี backslash/อักขระควบคุม
 *
 * ตรวจทีละอักขระด้วย `charCodeAt` แทน regex character class ของอักขระควบคุม (เหมือน
 * `lib/safeUrl.ts#hasControlOrSeparatorChar`) เพื่อเลี่ยง `no-control-regex`
 */

export type UnsafeDataPathReason = 'empty' | 'leadingSlash' | 'schemeOrProtocolRelative' | 'dotdot' | 'forbiddenChar';

const BACKSLASH_CODE = 92;
const MAX_C0_CONTROL_CODE = 31;
const DEL_CODE = 127;

function hasForbiddenPathChar(path: string): boolean {
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code === BACKSLASH_CODE || code <= MAX_C0_CONTROL_CODE || code === DEL_CODE) {
      return true;
    }
  }
  return false;
}

/** คืนเหตุผลแรกที่ทำให้ `path` ไม่ปลอดภัย หรือ `null` ถ้าปลอดภัย */
export function findUnsafeDataPathReason(path: string): UnsafeDataPathReason | null {
  if (path.length === 0) {
    return 'empty';
  }
  if (path.startsWith('/')) {
    return 'leadingSlash';
  }
  if (path.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    return 'schemeOrProtocolRelative';
  }
  if (path.split('/').includes('..')) {
    return 'dotdot';
  }
  if (hasForbiddenPathChar(path)) {
    return 'forbiddenChar';
  }
  return null;
}

/** true เฉพาะเมื่อ `path` เป็น relative path ที่ปลอดภัยตามกฎข้างบนทั้งหมด */
export function isSafeRelativeDataPath(path: string): boolean {
  return findUnsafeDataPathReason(path) === null;
}
