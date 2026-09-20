import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Collapse } from './Collapse';

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

describe('Collapse', () => {
  it('เนื้อหาอยู่ใน DOM ทันทีตอน mount (ไม่ต้องรอ rAF)', () => {
    stubMatchMedia(false);
    render(<Collapse>เนื้อหาแผง</Collapse>);
    expect(screen.getByText('เนื้อหาแผง')).toBeInTheDocument();
  });

  it('reduced-motion: ไม่มี transition และเปิดเต็มทันที (ไม่ค้างที่ 0fr)', () => {
    stubMatchMedia(true);
    const { container } = render(<Collapse className="probe">เนื้อหา</Collapse>);
    const wrapper = container.querySelector<HTMLElement>('.probe');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.transition).toBe('none');
    expect(wrapper?.style.gridTemplateRows).toBe('1fr');
  });
});
