/**
 * T-501 QA รอบภาพจริง — สร้าง PNG ตัวอย่างที่ "ดูรู้เรื่อง" (ลายตาราง 2 สี) แทนภาพทดสอบ 1×1 สีทึบเดิม
 * (ซึ่งเมื่อยืด `objectFit` เต็มพื้นที่ภาพในเอกสารจริงจะกลายเป็นสี่เหลี่ยมทึบเต็มหน้า มองไม่ออกว่าเป็นภาพ
 * ประกอบ) เขียนเองด้วย Node `zlib` ล้วน ๆ (ไม่มี `canvas` ให้ใช้ฝั่ง Node — ดู `svgToPng.ts` หัวไฟล์) ใช้
 * เฉพาะใน test/สคริปต์ render ตัวอย่างเท่านั้น ไม่ได้ export ไปใช้ใน production
 */
import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcOut = Buffer.alloc(4);
  crcOut.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcOut]);
}

/** สร้าง PNG ลายตาราง 2 สี ขนาด `size`x`size` (RGB, 8-bit, ไม่มี alpha) คืนเป็น data URL */
export function buildCheckerboardPngDataUrl(size = 16): string {
  const cell = Math.max(1, Math.floor(size / 4));
  const colorA: [number, number, number] = [0x2f, 0x6f, 0xb0]; // น้ำเงินอมเทา
  const colorB: [number, number, number] = [0xe8, 0xee, 0xf7]; // ฟ้าอ่อน (เข้าชุดสี COLOR_HEADER_BG)

  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const isA = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const [r, g, b] = isA ? colorA : colorB;
      const offset = 1 + x * 3;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor (RGB)
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString('base64')}`;
}
