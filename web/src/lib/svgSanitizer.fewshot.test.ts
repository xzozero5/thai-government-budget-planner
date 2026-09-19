/**
 * main thread (review ของ T-401): ตัวอย่าง few-shot SVG ที่จะส่งให้โมเดลเลียนแบบ (`docs/ui/illustrations/`)
 * ต้องผ่าน sanitizer ของเราเองเสมอ — ถ้าตัวอย่างไม่ผ่าน โมเดลจะถูกสอนให้วาดสิ่งที่ระบบปฏิเสธ
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './svgSanitizer';

const dir = join(__dirname, '../../../docs/ui/illustrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));

describe('few-shot SVG ของ illustration-style ผ่าน sanitizeSvg', () => {
  it('มีตัวอย่างอย่างน้อย 3 ไฟล์', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s', (file) => {
    const result = sanitizeSvg(readFileSync(join(dir, file), 'utf8'));
    expect(result.ok).toBe(true);
  });
});
