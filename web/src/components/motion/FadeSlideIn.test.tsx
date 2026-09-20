import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FadeSlideIn } from './FadeSlideIn';

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

describe('FadeSlideIn', () => {
  it('เนื้อหาอยู่ใน DOM ทันทีเสมอ แม้ไม่ reduced-motion (ไม่มี state ที่ซ่อนเนื้อหาไว้ก่อน)', () => {
    stubMatchMedia(false);
    render(<FadeSlideIn>ข้อความแชท</FadeSlideIn>);
    expect(screen.getByText('ข้อความแชท')).toBeInTheDocument();
  });

  it('reduced-motion: render children ตรง ๆ ไม่มี wrapper motion (ไม่มี transform/opacity เริ่มต้น)', () => {
    stubMatchMedia(true);
    const { container } = render(<FadeSlideIn className="probe">ข้อความแชท</FadeSlideIn>);
    expect(screen.getByText('ข้อความแชท')).toBeInTheDocument();
    const wrapper = container.querySelector('.probe');
    expect(wrapper?.tagName).toBe('DIV');
    expect(wrapper?.getAttribute('style')).toBeFalsy();
  });

  it('ส่ง className ไปที่ wrapper ทั้งสองโหมด', () => {
    stubMatchMedia(false);
    const { container } = render(<FadeSlideIn className="probe">x</FadeSlideIn>);
    expect(container.querySelector('.probe')).not.toBeNull();
  });
});
