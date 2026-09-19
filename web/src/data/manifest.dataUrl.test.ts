/**
 * (ง) dataUrl ภายใต้ BASE_URL='/thai-government-budget-planner/' และการปฏิเสธ path อันตราย
 *
 * หมายเหตุ: ตอนรัน `vitest` (dev/serve mode) Vite ให้ `import.meta.env.BASE_URL === '/'` เสมอ
 * (ค่าตาม `base` ใน vite.config.ts ถูก apply จริงเฉพาะตอน `vite build`) จึงต้อง stub ค่านี้ให้
 * เป็นค่าที่ใช้จริงบน GitHub Pages (`/thai-government-budget-planner/`) เพื่อทดสอบ requirement นี้
 * โดยเฉพาะ — ใช้ `vi.stubEnv` (คืนค่าอัตโนมัติหลังแต่ละ test ผ่าน `unstubEnvs` ใน config ด้านล่าง)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataUrl } from '@/data/manifest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dataUrl (T-202 ง)', () => {
  it('สร้าง URL จาก import.meta.env.BASE_URL (Vite base = /thai-government-budget-planner/) ไม่ hard-code /data/', () => {
    vi.stubEnv('BASE_URL', '/thai-government-budget-planner/');
    expect(import.meta.env.BASE_URL).toBe('/thai-government-budget-planner/');
    expect(dataUrl('manifest.json')).toBe('/thai-government-budget-planner/data/manifest.json');
    expect(dataUrl('budget_lines/pbo/2566/15000.parquet')).toBe(
      '/thai-government-budget-planner/data/budget_lines/pbo/2566/15000.parquet',
    );
  });

  it('เข้ารหัส path segment ที่มีอักขระพิเศษ/ยูนิโค้ดอย่างถูกต้อง', () => {
    vi.stubEnv('BASE_URL', '/thai-government-budget-planner/');
    const url = dataUrl('catalog/trends/14.json.gz');
    expect(url).toBe('/thai-government-budget-planner/data/catalog/trends/14.json.gz');
  });

  it('ปฏิเสธ path ว่างเปล่า', () => {
    expect(() => dataUrl('')).toThrow();
  });

  it('ปฏิเสธ path ที่ขึ้นต้นด้วย "/"', () => {
    expect(() => dataUrl('/manifest.json')).toThrow();
  });

  it('ปฏิเสธ path ที่มี ".." (path traversal)', () => {
    expect(() => dataUrl('../secret.json')).toThrow();
    expect(() => dataUrl('catalog/../../secret.json')).toThrow();
  });

  it('ปฏิเสธ path ที่มี scheme อื่น (N5 — ห้าม origin นอก)', () => {
    expect(() => dataUrl('https://evil.example/manifest.json')).toThrow();
    expect(() => dataUrl('//evil.example/manifest.json')).toThrow();
  });
});
