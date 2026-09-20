import { touchActivity } from '@/ai/session/keyHolder';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { lazy, Suspense, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import { AboutPage } from '@/features/about';
import { KeyGatePage } from '@/features/keygate';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';
// T-203 §4: route ของ harness ทดสอบ data layer เท่านั้น — ตัดออกจาก production bundle ปกติเสมอ
// (ดู comment ใน dataHarness/DataHarnessRoute.tsx) — **ต้องคง import + `{dataHarnessRoute}` นี้ไว้ใน
// <Routes> เหมือนเดิมทุกประการ** เพราะ e2e/eval ของ data harness พึ่งพา route นี้อยู่
import { dataHarnessRoute } from '@/app/dataHarness/DataHarnessRoute';
import { NotFoundPage } from './NotFoundPage';

// T-405: หน้า workspace (chat/proposal/citation/ai) หนักที่สุดของแอป — lazy-load เพื่อไม่ให้ไป inline
// อยู่ใน initial bundle ของ KeyGate/About (initial load ต้อง < 3 MB gz ตาม CLAUDE.md §3)
const LazyWorkspaceRoute = lazy(() =>
  import('@/features/workspace').then((m) => ({ default: m.WorkspaceRoute })),
);

// งานลดขนาด entry chunk (20 ก.ย. 2569, งานเร่ง): `LoadPagePlaceholder` เดิม import `LoadPage` จาก
// `@/features/export` แบบ static — `LoadPage` ลาก `ProposalPane`/`CitationDrawer`/`ExportDialog` (รวม
// DOMPurify สำหรับ sanitize SVG ภาพประกอบ) เข้ามาด้วย ทำให้ route "/load" ที่ผู้ใช้ส่วนน้อยเท่านั้นที่กด
// (เปิดไฟล์ .tgbp.json เก่า) ติดอยู่ใน entry bundle ที่ทุกคนต้องโหลดตั้งแต่หน้าแรกเสมอ — เปลี่ยนเป็น
// `React.lazy` เหมือน `LazyWorkspaceRoute` ข้างบน (พฤติกรรม/ข้อความหน้า `/load` เดิมทุกประการ แค่โหลดช้า
// ลง 1 request); คงชื่อไฟล์ `LoadPagePlaceholder.tsx`/export name เดิมไว้ (ตามคอมเมนต์ในไฟล์นั้น) — แค่
// import แบบ lazy แทน static
const LazyLoadPage = lazy(() =>
  import('./LoadPagePlaceholder').then((m) => ({ default: m.LoadPagePlaceholder })),
);

/** T-602 NEW-L6: เดิม idle timer ของ key ถูกต่ออายุเฉพาะตอน "ส่งข้อความ" — ผู้ใช้ที่นั่งแก้ BOQ/อ่านหลักฐาน
 * ต่อเนื่อง 60 นาทีโดยไม่ส่งข้อความจะถูกล้าง key ทั้งที่ยังใช้งานอยู่ → นับการกด/พิมพ์ในหน้าเป็นกิจกรรมด้วย
 * (throttle 30 วินาที; `touchActivity` ไม่ทำอะไรถ้ายังไม่มี key) — แท็บที่ถูกทิ้งไว้เฉย ๆ ยังถูกล้างตามเดิม */
const ACTIVITY_THROTTLE_MS = 30_000;
function ActivityTracker(): null {
  useEffect(() => {
    let last = 0;
    const onActivity = (): void => {
      const now = Date.now();
      if (now - last < ACTIVITY_THROTTLE_MS) return;
      last = now;
      touchActivity();
    };
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []);
  return null;
}

/** T-405: สลับธีม light/dark เก็บใน `sessionStore` (ห้าม localStorage — N2/09 §1) แล้วสะท้อนเป็น
 * `data-theme` บน `<html>` ให้ `tokens.css` เลือกชุดสีที่ถูกต้อง */
function ThemeSync(): null {
  const theme = useSessionStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  return null;
}

/**
 * T-408 (06 §4.6/§6) — เปลี่ยนเส้นทาง (route) → ย้าย focus ไปที่ `<h1>` ใน `#main-content` (ถ้ามี) เพื่อให้
 * screen reader ประกาศหัวข้อหน้าใหม่ (SPA ไม่ reload หน้าจริง จึงไม่มี browser default behavior นี้ให้ฟรี)
 * ข้ามการ focus ตอน mount ครั้งแรก (initial load) — โฟกัสเริ่มต้นของหน้าเว็บปกติควรอยู่ที่ body/skip-link
 * ไม่ใช่แย่ง focus ทันทีตอนโหลดหน้าแรก
 */
function RouteFocusManager(): null {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const heading = document.querySelector<HTMLElement>('#main-content h1');
    if (!heading) {
      return;
    }
    if (!heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
    }
    heading.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ตั้งใจ track เฉพาะ path ไม่ใช่ทั้ง location object
  }, [location.pathname]);

  return null;
}

export function App(): ReactElement {
  return (
    <HashRouter>
      <ToastProvider>
        <ThemeSync />
        <ActivityTracker />
        <RouteFocusManager />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('a11y.skipToContent')}
        </a>
        <div id="main-content">
          {/* T-602 NEW-H1: error ระหว่าง render (ไฟล์ .tgbp.json เสีย/ค่าจากโมเดลผิดรูป) ต้องไม่ทำให้ทั้งแท็บขาว */}
          <ErrorBoundary variant="page">
            <Routes>
              <Route path="/" element={<KeyGatePage />} />
              <Route
                path="/workspace"
                element={
                  <Suspense fallback={<p className="p-6 text-fg-muted">{t('common.loading')}</p>}>
                    <LazyWorkspaceRoute />
                  </Suspense>
                }
              />
              <Route
                path="/load"
                element={
                  <Suspense fallback={<p className="p-6 text-fg-muted">{t('common.loading')}</p>}>
                    <LazyLoadPage />
                  </Suspense>
                }
              />
              <Route path="/about" element={<AboutPage />} />
              {dataHarnessRoute}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </ToastProvider>
    </HashRouter>
  );
}
