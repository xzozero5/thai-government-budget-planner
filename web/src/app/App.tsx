import type { ReactElement } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { PlaceholderPage } from '@/app/PlaceholderPage';

export function App(): ReactElement {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<PlaceholderPage />} />
      </Routes>
    </HashRouter>
  );
}
