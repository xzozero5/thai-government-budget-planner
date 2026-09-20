import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrawerSlide } from './DrawerSlide';

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

describe('DrawerSlide', () => {
  it('เนื้อหาอยู่ใน DOM ทันทีทั้งสองโหมด (drawer)', () => {
    stubMatchMedia(false);
    render(<DrawerSlide variant="drawer">เนื้อหา drawer</DrawerSlide>);
    expect(screen.getByText('เนื้อหา drawer')).toBeInTheDocument();
  });

  it('เนื้อหาอยู่ใน DOM ทันทีทั้งสองโหมด (dialog)', () => {
    stubMatchMedia(false);
    render(<DrawerSlide variant="dialog">เนื้อหา dialog</DrawerSlide>);
    expect(screen.getByText('เนื้อหา dialog')).toBeInTheDocument();
  });

  it('reduced-motion: render div ธรรมดา ไม่มี wrapper motion', () => {
    stubMatchMedia(true);
    const { container } = render(
      <DrawerSlide className="probe" variant="drawer">
        เนื้อหา
      </DrawerSlide>,
    );
    const wrapper = container.querySelector('.probe');
    expect(wrapper?.tagName).toBe('DIV');
    expect(wrapper?.getAttribute('style')).toBeFalsy();
  });
});
