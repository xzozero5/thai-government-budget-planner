import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/App';

describe('App', () => {
  it('renders the Thai placeholder page at the root route', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'เครื่องมือวางแผนงบประมาณภาครัฐ (TGBP)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('กำลังพัฒนา')).toBeInTheDocument();
  });
});
