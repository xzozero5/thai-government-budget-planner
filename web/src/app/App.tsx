import { lazy, Suspense, useEffect } from 'react';
import type { ReactElement } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import { AboutPage } from '@/features/about';
import { KeyGatePage } from '@/features/keygate';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';
// T-203 §4: route ของ harness ทดสอบ data layer เท่านั้น — ตัดออกจาก production bundle ปกติเสมอ
// (ดู comment ใน dataHarness/DataHarnessRoute.tsx) — **ต้องคง import + `{dataHarnessRoute}` นี้ไว้ใน
// <Routes> เหมือนเดิมทุกประการ** เพราะ e2e/eval ของ data harness พึ่งพา route นี้อยู่
import { dataHarnessRoute } from '@/app/dataHarness/DataHarnessRoute';
import { LoadPagePlaceholder } from './LoadPagePlaceholder';
import { NotFoundPage } from './NotFoundPage';

// T-405: หน้า workspace (chat/proposal/citation/ai) หนักที่สุดของแอป — lazy-load เพื่อไม่ให้ไป inline
// อยู่ใน initial bundle ของ KeyGate/About (initial load ต้อง < 3 MB gz ตาม CLAUDE.md §3)
const LazyWorkspaceRoute = lazy(() =>
  import('@/features/workspace').then((m) => ({ default: m.WorkspaceRoute })),
);

/** T-405: สลับธีม light/dark เก็บใน `sessionStore` (ห้าม localStorage — N2/09 §1) แล้วสะท้อนเป็น
 * `data-theme` บน `<html>` ให้ `tokens.css` เลือกชุดสีที่ถูกต้อง */
function ThemeSync(): null {
  const theme = useSessionStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  return null;
}

export function App(): ReactElement {
  return (
    <HashRouter>
      <ToastProvider>
        <ThemeSync />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('a11y.skipToContent')}
        </a>
        <div id="main-content">
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
            <Route path="/load" element={<LoadPagePlaceholder />} />
            <Route path="/about" element={<AboutPage />} />
            {dataHarnessRoute}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </ToastProvider>
    </HashRouter>
  );
}
