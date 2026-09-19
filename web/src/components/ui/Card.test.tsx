import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';

describe('Card', () => {
  it('render header/body/footer', () => {
    render(
      <Card>
        <CardHeader>หัวข้อ</CardHeader>
        <CardBody>เนื้อหา</CardBody>
        <CardFooter>ปุ่ม</CardFooter>
      </Card>,
    );
    expect(screen.getByText('หัวข้อ')).toBeInTheDocument();
    expect(screen.getByText('เนื้อหา')).toBeInTheDocument();
    expect(screen.getByText('ปุ่ม')).toBeInTheDocument();
  });

  it('ใช้ class จาก theme (ไม่มี hex ตรง ๆ)', () => {
    render(<Card data-testid="card">x</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-surface');
    expect(card.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
