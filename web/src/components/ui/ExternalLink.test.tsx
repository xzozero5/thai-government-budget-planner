import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExternalLink } from '@/components/ui/ExternalLink';

describe('ExternalLink', () => {
  it('https ถูกต้อง → เป็นลิงก์ target=_blank rel=noopener noreferrer', () => {
    render(<ExternalLink href="https://shopee.co.th/product/1">Shopee</ExternalLink>);
    const link = screen.getByRole('link', { name: /Shopee/ });
    expect(link).toHaveAttribute('href', 'https://shopee.co.th/product/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('มีปุ่มคัดลอก URL เต็ม', () => {
    render(<ExternalLink href="https://example.com/x">ตัวอย่าง</ExternalLink>);
    expect(screen.getByRole('button', { name: 'คัดลอกลิงก์' })).toBeInTheDocument();
  });

  it.each([
    ['http://example.com', 'http'],
    ['javascript:alert(1)', 'javascript:'],
    ['data:text/html,<script>alert(1)</script>', 'data:'],
    ['ftp://example.com/file', 'ftp:'],
    ['//evil.example.com', 'protocol-relative'],
    ['not a url', 'invalid'],
    ['https://bank.example@evil.example/login', 'userinfo หลอกตา'],
    ['https://user:pass@example.com/', 'user:pass'],
    [' JaVaScRiPt:alert(1)', 'javascript: ปนช่องว่าง/ตัวพิมพ์'],
  ])('ปฏิเสธ scheme ที่ไม่ใช่ https: %s (%s)', (href) => {
    render(<ExternalLink href={href}>ลิงก์อันตราย</ExternalLink>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('ลิงก์อันตราย')).toBeInTheDocument();
  });

  it('hideCopyButton ซ่อนปุ่มคัดลอก', () => {
    render(
      <ExternalLink href="https://example.com" hideCopyButton>
        ตัวอย่าง
      </ExternalLink>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
