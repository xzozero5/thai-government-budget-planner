/**
 * ตั้งค่า Zod ให้ไม่ใช้ JIT (`new Function`) — ต้อง import ไฟล์นี้ก่อนการ parse ครั้งแรกของทั้งแอป (`main.tsx`)
 *
 * เหตุผล (B-001, พบจาก e2e T-409 บน production build): Zod 4 ตรวจว่า runtime อนุญาต `eval` ไหมด้วยการลอง
 * `new Function("")` ใน try/catch — ภายใต้ CSP ของเรา (`script-src 'self' 'wasm-unsafe-eval'`, ไม่มี
 * `'unsafe-eval'` โดยตั้งใจ) การลองนั้นถูกบล็อกและถูก **รายงานเป็น CSP violation ทุก session** แม้ Zod จะจับ
 * exception แล้ว fallback เองก็ตาม — โหมด `jitless` ข้าม probe นี้ทั้งหมด (ดู `zod/v4/core/util.js#allowsEval`)
 * ผลข้างเคียง: parse object ช้าลงเล็กน้อย (ไม่มีนัยสำคัญกับ payload ขนาดของเรา)
 */
import { z } from 'zod';

z.config({ jitless: true });
