import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AboutPage } from '@/features/about/AboutPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  );
}

describe('AboutPage', () => {
  it('แสดงหัวข้อครบทุกส่วนตาม 06 §4.6 (วิธีทำงาน/แหล่งข้อมูล/ข้อจำกัด/ความเป็นส่วนตัว/ค่าใช้จ่าย/โอเพนซอร์ส)', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'เว็บนี้ทำงานยังไง' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ขั้นตอนการทำงาน')).toBeInTheDocument();
    expect(screen.getByText('แหล่งข้อมูล')).toBeInTheDocument();
    expect(screen.getByText('ข้อจำกัดที่ควรรู้')).toBeInTheDocument();
    expect(screen.getByText('ความเป็นส่วนตัวและความปลอดภัย')).toBeInTheDocument();
    expect(screen.getByText('ค่าใช้จ่าย')).toBeInTheDocument();
    expect(screen.getByText('โอเพนซอร์ส')).toBeInTheDocument();
  });

  it('แสดงขั้นตอนการทำงานทั้ง 4 ขั้น', () => {
    renderPage();
    expect(screen.getByText(/อบต\. จะสร้างฝายน้ำล้น/)).toBeInTheDocument();
    expect(screen.getByText(/ผู้ช่วยถามข้อมูลที่ขาด/)).toBeInTheDocument();
    expect(screen.getByText(/ผู้ช่วยค้นงบจริงย้อนหลัง/)).toBeInTheDocument();
    expect(screen.getByText(/คุณตรวจทุกบรรทัดได้ว่าตัวเลขมาจากไหน/)).toBeInTheDocument();
  });

  it('แสดงข้อจำกัด PDF สแกน (N4) และ OCR ต้นทาง (ADR-005)', () => {
    renderPage();
    expect(screen.getByText(/เอกสาร PDF ที่เป็นภาพสแกน/)).toBeInTheDocument();
    expect(screen.getByText(/ถอดมาจาก OCR ของหน่วยงานเอง/)).toBeInTheDocument();
  });

  it('มีลิงก์ซอร์สโค้ด GitHub ที่ถูกต้อง (https, เปิดแท็บใหม่)', () => {
    renderPage();
    const link = screen.getByRole('link', {
      name: /github\.com\/xzozero5\/thai-government-budget-planner/,
    });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/xzozero5/thai-government-budget-planner',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('มีลิงก์กลับไปหน้าทำงาน', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'กลับไปหน้าทำงาน' })).toHaveAttribute('href', '/');
  });
});
