/**
 * T-502 — ดาวน์โหลด `Blob` เป็นไฟล์ในเบราว์เซอร์ผ่าน `<a download>` + `URL.createObjectURL`
 *
 * นี่คือ navigation/download ปกติของเบราว์เซอร์ ไม่ใช่ `fetch` ข้าม origin จึงไม่ชน CSP `connect-src`
 * (N5, docs/09-SECURITY.md §1) — `blob:` URL revoke ทันทีหลังคลิกเพื่อไม่ให้ค้างใน memory
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // ให้ browser เริ่ม download ก่อนค่อย revoke (ทันทีก็ปลอดภัยในเบราว์เซอร์จริงทั้งหมดที่รองรับ แต่หน่วง
  // เล็กน้อยกันปัญหาบาง webview เก่าที่ revoke ก่อน anchor.click() ประมวลผลเสร็จ)
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
