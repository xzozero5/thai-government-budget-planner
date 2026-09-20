import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IllustrationFrame } from './IllustrationFrame';

const FIXTURES_DIR = join(__dirname, '../../lib/__fixtures__/svg');
const ILLUSTRATIONS_DIR = join(__dirname, '../../../../docs/ui/illustrations');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

const DANGEROUS_FIXTURES = [
  '01-script.svg',
  '02-events.svg',
  '03-foreignObject.svg',
  '04-external-href.svg',
  '05-style-url.svg',
  '06-datauri-and-smil.svg',
];

describe('IllustrationFrame — SVG อันตราย', () => {
  it.each(DANGEROUS_FIXTURES)('%s: ไม่มี element/attribute อันตรายหลุดเข้า DOM เลย', (file) => {
    const svgText = readFixture(file);
    render(<IllustrationFrame svgText={svgText} title="ทดสอบภาพอันตราย" />);

    // จำกัดขอบเขตไว้ที่จุด mount ของ SVG เอง (ไม่ปนกับ `style=` ของ component เราเอง เช่น Skeleton/inline)
    const mount = screen.queryByTestId('illustration-svg-mount');
    const scope = mount ?? document.body;
    expect(scope.querySelector('script')).toBeNull();
    expect(scope.querySelector('foreignObject')).toBeNull();
    expect(scope.querySelector('image')).toBeNull();
    expect(scope.querySelector('iframe')).toBeNull();
    expect(scope.querySelector('[onload]')).toBeNull();
    expect(scope.querySelector('[onclick]')).toBeNull();
    expect(scope.querySelector('[style]')).toBeNull();
    expect(scope.innerHTML).not.toMatch(/javascript:/i);
    expect(scope.innerHTML).not.toMatch(/evil\.example/i);
    // ไม่มี <svg> เลย → ต้องเป็นเพราะ sanitize ล้มเหลวทั้งไฟล์ (fallback), ไม่ใช่พังเงียบ ๆ
    if (!mount) {
      expect(screen.getByText(/ไม่ผ่านการตรวจความปลอดภัย/)).toBeInTheDocument();
    }
  });

  it('03-foreignObject.svg (sanitize ล้มเหลวทั้งไฟล์) → แสดง fallback ปฏิเสธ ไม่ mount SVG ใด ๆ', () => {
    render(<IllustrationFrame svgText={readFixture('03-foreignObject.svg')} title="ภาพเสีย" />);
    expect(document.querySelector('svg')).toBeNull();
    expect(screen.getByText(/ไม่ผ่านการตรวจความปลอดภัย/)).toBeInTheDocument();
  });

  it('ปุ่ม "สร้างภาพใหม่" ทำงานได้แม้ sanitize ล้มเหลว', () => {
    const onRegenerate = vi.fn();
    render(
      <IllustrationFrame
        svgText={readFixture('03-foreignObject.svg')}
        title="ภาพเสีย"
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'สร้างภาพใหม่' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});

describe('IllustrationFrame — SVG ดี', () => {
  const goodFiles = readdirSync(ILLUSTRATIONS_DIR).filter((f) => f.endsWith('.svg'));
  // ไฟล์แรกไว้ใช้ในเคสที่ไม่ได้ทดสอบทุกไฟล์ (goodFiles ต้องไม่ว่าง — ยืนยันด้วยเทสต์ด้านบน)
  const firstGoodFile = readFileSync(join(ILLUSTRATIONS_DIR, goodFiles[0] ?? ''), 'utf8');

  it('มีตัวอย่าง SVG ดีอย่างน้อย 1 ไฟล์ให้ทดสอบ', () => {
    expect(goodFiles.length).toBeGreaterThan(0);
  });

  it.each(goodFiles)('%s: render ได้จริง มี <svg> อยู่ใน DOM และมีป้าย AI เสมอ', (file) => {
    const svgText = readFileSync(join(ILLUSTRATIONS_DIR, file), 'utf8');
    render(<IllustrationFrame svgText={svgText} title="แผนผังโครงการ" caption="คำอธิบายภาพ" />);
    expect(document.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/ภาพประกอบโดย AI/)).toBeInTheDocument();
    expect(screen.getByText('คำอธิบายภาพ')).toBeInTheDocument();
  });

  it('role="img" aria-label ตรงกับ title', () => {
    const svgText = firstGoodFile;
    render(<IllustrationFrame svgText={svgText} title="ชื่อภาพประกอบ" />);
    expect(screen.getByRole('img', { name: 'ชื่อภาพประกอบ' })).toBeInTheDocument();
  });

  it('ป้าย AI มองเห็นเสมอ ไม่ผูกกับ hover (ไม่มี class ซ่อน เช่น opacity-0/invisible)', () => {
    const svgText = firstGoodFile;
    render(<IllustrationFrame svgText={svgText} title="ภาพ" />);
    const badge = screen.getByText(/ภาพประกอบโดย AI/);
    expect(badge.className).not.toMatch(/opacity-0|invisible|hidden/);
  });

  it('ปุ่ม "ซ่อนภาพ" เรียก onHide เมื่อส่ง prop มา', () => {
    const svgText = firstGoodFile;
    const onHide = vi.fn();
    render(<IllustrationFrame svgText={svgText} title="ภาพ" onHide={onHide} />);
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนภาพ' }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('lightbox: เปิดด้วยปุ่มขยาย, mount SVG อีก instance หนึ่ง (คนละ node จากกรอบหลัก), ปิดด้วย Esc', () => {
    const svgText = firstGoodFile;
    render(<IllustrationFrame svgText={svgText} title="ภาพขยายได้" />);

    // ยังไม่เปิด lightbox → จุด mount ของ lightbox ยังไม่มีในหน้าเลย (Dialog ปิดอยู่)
    expect(screen.queryByTestId('illustration-lightbox-svg-mount')).toBeNull();
    const mainSvg = screen.getByTestId('illustration-svg-mount').querySelector('svg');
    expect(mainSvg).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ขยายภาพ' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // เปิด lightbox แล้ว → มี node เนื้อหาของ lightbox เป็นคนละ <svg> instance จากกรอบหลัก
    const lightboxSvg = screen.getByTestId('illustration-lightbox-svg-mount').querySelector('svg');
    expect(lightboxSvg).not.toBeNull();
    expect(lightboxSvg).not.toBe(mainSvg);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
