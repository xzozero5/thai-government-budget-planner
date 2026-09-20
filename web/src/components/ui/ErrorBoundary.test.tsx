import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { t } from '@/i18n';
import { ErrorBoundary } from './ErrorBoundary';

const FAKE_KEY = ['sk', 'ant', 'fake-key-for-unit-test-000'].join('-');

function Boom({ message }: { message: string }): ReactElement {
  throw new Error(message);
}

describe('ErrorBoundary (T-602 NEW-H1)', () => {
  let errorSpy: MockInstance<typeof console.error>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('error ระหว่าง render → แสดง fallback (role=alert) ไม่ใช่หน้าขาว และส่วนนอก boundary ยังอยู่', () => {
    render(
      <div>
        <p>ส่วนอื่นของหน้า</p>
        <ErrorBoundary>
          <Boom message="Invalid time value" />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid time value');
    expect(screen.getByText('ส่วนอื่นของหน้า')).toBeInTheDocument();
  });

  it('ข้อความ error ที่มีสตริงรูป key ถูก mask ทั้งบนจอและใน console (ไม่ log object error ดิบ)', () => {
    render(
      <ErrorBoundary>
        <Boom message={`request failed with key ${FAKE_KEY}`} />
      </ErrorBoundary>,
    );
    expect(document.body.textContent).not.toContain(FAKE_KEY);
    const ours = errorSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith('[ErrorBoundary]'),
    );
    expect(ours.length).toBeGreaterThan(0);
    for (const call of ours) {
      for (const arg of call) {
        expect(typeof arg).toBe('string');
        expect(String(arg)).not.toContain(FAKE_KEY);
      }
    }
  });

  it('variant="page" มีลิงก์กลับหน้าแรก; กด "ลองใหม่" แล้ว render ลูกใหม่ได้เมื่อสาเหตุหายไป', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky(): ReactElement {
      if (shouldThrow) throw new Error('ชั่วคราว');
      return <p>กลับมาแล้ว</p>;
    }
    render(
      <ErrorBoundary variant="page">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('link', { name: t('common.back') })).toHaveAttribute('href', '#/');
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(screen.getByText('กลับมาแล้ว')).toBeInTheDocument();
  });

  it('resetKey เปลี่ยน → ล้างสถานะ error เอง (เช่น ผู้ใช้เลือกไฟล์ใหม่)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="a">
        <Boom message="พัง" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="b">
        <p>ไฟล์ใหม่</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('ไฟล์ใหม่')).toBeInTheDocument();
  });
});
