import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sparkline } from './Sparkline';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('Sparkline', () => {
  it('มี role="img" และ aria-label ตามที่ส่งมา', () => {
    render(
      <Sparkline
        points={[
          { x: 2566, y: 100 },
          { x: 2567, y: 120 },
        ]}
        ariaLabel="แนวโน้มราคาเครื่องปรับอากาศ"
      />,
    );
    const svg = screen.getByRole('img', { name: 'แนวโน้มราคาเครื่องปรับอากาศ' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('ข้ามจุดที่ y เป็น null และวาดหลาย segment แทนการลากเส้นเชื่อม', () => {
    render(
      <Sparkline
        points={[
          { x: 1, y: 10 },
          { x: 2, y: null },
          { x: 3, y: 30 },
          { x: 4, y: 40 },
        ]}
        ariaLabel="ทดสอบช่องว่าง"
      />,
    );
    const svg = screen.getByRole('img', { name: 'ทดสอบช่องว่าง' });
    const paths = svg.querySelectorAll('path');
    // จุดที่ 1 อยู่โดดเดี่ยว (ก่อน null) → ไม่มีเส้นให้ลาก จึงไม่มี <path> สำหรับ segment นั้นเลย
    // จุด 3,4 ต่อกัน → เหลือ path เดียว มีคำสั่ง "L" หนึ่งครั้ง (เส้นตรงจุดเดียว ไม่ข้ามช่องว่างจากจุด 1)
    expect(paths.length).toBe(1);
    const d = paths[0]?.getAttribute('d') ?? '';
    expect(d.startsWith('M')).toBe(true);
    expect(d.match(/L/g)?.length).toBe(1);
  });

  it('เน้นจุดสุดท้ายที่ไม่ใช่ null ด้วยวงกลม', () => {
    render(
      <Sparkline
        points={[
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 3, y: null },
        ]}
        ariaLabel="ทดสอบจุดสุดท้าย"
      />,
    );
    const svg = screen.getByRole('img', { name: 'ทดสอบจุดสุดท้าย' });
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBe(1);
  });

  it('ไม่มี animation (ไม่มี <style> keyframes) เมื่อ prefers-reduced-motion: reduce', () => {
    stubMatchMedia(true);
    render(
      <Sparkline
        points={[
          { x: 1, y: 10 },
          { x: 2, y: 20 },
        ]}
        ariaLabel="ทดสอบ reduced motion"
      />,
    );
    const svg = screen.getByRole('img', { name: 'ทดสอบ reduced motion' });
    expect(svg.querySelector('style')).toBeNull();
    const path = svg.querySelector('path');
    expect(path?.getAttribute('style')).toBeFalsy();
  });

  it('แสดง <style> keyframes เมื่อไม่ลด motion', () => {
    stubMatchMedia(false);
    render(
      <Sparkline
        points={[
          { x: 1, y: 10 },
          { x: 2, y: 20 },
        ]}
        ariaLabel="ทดสอบ motion ปกติ"
      />,
    );
    const svg = screen.getByRole('img', { name: 'ทดสอบ motion ปกติ' });
    expect(svg.querySelector('style')).not.toBeNull();
  });

  it('ว่างเปล่าไม่พัง เมื่อไม่มีจุดข้อมูลเลย', () => {
    render(<Sparkline points={[]} ariaLabel="ไม่มีข้อมูล" />);
    const svg = screen.getByRole('img', { name: 'ไม่มีข้อมูล' });
    expect(svg.querySelectorAll('path').length).toBe(0);
    expect(svg.querySelectorAll('circle').length).toBe(0);
  });
});
