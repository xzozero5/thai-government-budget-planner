import type { ReactElement } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { PlaceholderPage } from '@/app/PlaceholderPage';
// T-203 §4: route ของ harness ทดสอบ data layer เท่านั้น — ตัดออกจาก production bundle ปกติเสมอ
// (ดู comment ใน dataHarness/DataHarnessRoute.tsx)
import { dataHarnessRoute } from '@/app/dataHarness/DataHarnessRoute';

export function App(): ReactElement {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<PlaceholderPage />} />
        {dataHarnessRoute}
      </Routes>
    </HashRouter>
  );
}
