import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

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

describe('usePrefersReducedMotion (canonical — components/motion)', () => {
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
