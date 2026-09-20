import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';

const APP_SOURCE = readFileSync(path.join(import.meta.dirname, 'App.tsx'), 'utf-8');

function setHash(hash: string): void {
  window.location.hash = hash;
}

afterEach(() => {
  setHash('#/');
  useSessionStore.setState({ theme: 'light' });
  document.documentElement.removeAttribute('data-theme');
});

describe('App — routes (HashRouter)', () => {
  it('"/" แสดงหน้า KeyGate ภายใน #main-content พร้อม skip link (a11y §6)', () => {
    setHash('#/');
    render(<App />);

    expect(screen.getByText(t('a11y.skipToContent'))).toBeInTheDocument();
    expect(document.getElementById('main-content')).not.toBeNull();
  });

  it('เส้นทางที่ไม่รู้จัก → แสดงหน้า 404', () => {
    setHash('#/ไม่มีจริง');
    render(<App />);

    expect(screen.getByRole('heading', { name: t('errors.notFoundTitle') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('errors.notFoundAction') })).toBeInTheDocument();
  });

  it('"/about" ไม่ตกไปที่หน้า 404 (route จับคู่ได้)', () => {
    setHash('#/about');
    render(<App />);

    expect(screen.queryByRole('heading', { name: t('errors.notFoundTitle') })).not.toBeInTheDocument();
  });

  it('"/load" แสดง placeholder ของ T-502 (เปิดไฟล์ .tgbp.json โดยไม่ต้องมี key)', async () => {
    setHash('#/load');
    render(<App />);

    // งานลดขนาด entry chunk (20 ก.ย. 2569): "/load" เป็น `React.lazy` แล้ว (ลาก ProposalPane/
    // CitationDrawer/ExportDialog ออกจาก entry bundle) — ต้องรอ dynamic import resolve ก่อน
    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: t('export.load.title') })).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it('"/workspace" โดยไม่มี key → guard redirect กลับไปหน้า KeyGate ("/")', async () => {
    useSessionStore.setState({ hasKey: false });
    setHash('#/workspace');
    render(<App />);

    // guard อยู่ใน lazy chunk ของ workspace — ตอนรันทั้งชุดพร้อมกัน dynamic import ช้ากว่า 1 s (ค่า default
    // ของ waitFor) ได้ จึงให้เวลาเพิ่ม (main thread: เคย fail เฉพาะตอนรันเต็มชุด ผ่านเมื่อรันเดี่ยว)
    await waitFor(
      () => {
        expect(window.location.hash).toBe('#/');
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it('ยังคง import และแทรก dataHarnessRoute ใน <Routes> เหมือนเดิมทุกประการ (e2e/eval ของ data harness พึ่งพา route นี้)', () => {
    expect(APP_SOURCE).toContain("import { dataHarnessRoute } from '@/app/dataHarness/DataHarnessRoute';");
    expect(APP_SOURCE).toContain('{dataHarnessRoute}');
  });
});

describe('App — route change focus management (06 §4.6/§6)', () => {
  it('โหลดครั้งแรกไม่แย่ง focus ไปที่ <h1> (initial load ไม่ใช่ route change)', () => {
    setHash('#/');
    render(<App />);
    const h1 = screen.getByRole('heading', { name: t('common.appName'), level: 1 });
    expect(h1).not.toHaveFocus();
  });

  it('เปลี่ยนเส้นทางไป /about → focus ไปที่ <h1> ใน #main-content', async () => {
    useSessionStore.setState({ hasKey: false });
    setHash('#/');
    render(<App />);

    setHash('#/about');

    await waitFor(() => {
      const h1 = screen.getByRole('heading', { name: t('about.title'), level: 1 });
      expect(h1).toHaveFocus();
    });
  });
});

describe('App — theme sync (06 §2: data-theme บน <html>, เก็บใน sessionStore เท่านั้น ห้าม localStorage)', () => {
  it('sessionStore.theme สะท้อนเป็น data-theme บน <html> ทันทีที่ mount', () => {
    useSessionStore.setState({ theme: 'dark' });
    setHash('#/');
    render(<App />);

    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('เปลี่ยน theme ระหว่างทาง → data-theme อัปเดตตาม', async () => {
    useSessionStore.setState({ theme: 'light' });
    setHash('#/');
    render(<App />);
    expect(document.documentElement.dataset['theme']).toBe('light');

    useSessionStore.getState().setTheme('dark');

    await waitFor(() => {
      expect(document.documentElement.dataset['theme']).toBe('dark');
    });
  });
});
