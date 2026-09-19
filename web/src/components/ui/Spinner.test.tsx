import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from '@/components/ui/Spinner';

describe('Spinner', () => {
  it('มี role=status และ label ภาษาไทยเป็นค่าเริ่มต้น', () => {
    render(<Spinner />);
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
  });

  it('override label ได้', () => {
    render(<Spinner label="กำลังคำนวณ BOQ" />);
    expect(screen.getByRole('status', { name: 'กำลังคำนวณ BOQ' })).toBeInTheDocument();
  });
});
