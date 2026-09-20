import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cx, usePrefersReducedMotion } from './utils';

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

function Probe(): ReactElement {
  const reduced = usePrefersReducedMotion();
  return <span>{reduced ? 'reduced' : 'normal'}</span>;
}

describe('cx', () => {
  it('รวม string ที่เป็น truthy เท่านั้น', () => {
    expect(cx('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('คืนสตริงว่างเมื่อไม่มีค่า truthy เลย', () => {
    expect(cx(false, undefined, null)).toBe('');
  });
});

describe('usePrefersReducedMotion', () => {
  it('คืน false เมื่อไม่มี window.matchMedia (jsdom default) ไม่ throw', () => {
    render(<Probe />);
    expect(screen.getByText('normal')).toBeInTheDocument();
  });

  it('คืน true เมื่อ matchMedia บอกว่า prefers-reduced-motion: reduce', () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText('reduced')).toBeInTheDocument();
  });

  it('คืน false เมื่อ matchMedia บอกว่าไม่ลด motion', () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByText('normal')).toBeInTheDocument();
  });
});
