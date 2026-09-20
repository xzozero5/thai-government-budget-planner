// ต้องมาก่อนทุก import ที่อาจ parse ด้วย Zod (กัน CSP violation จาก probe `new Function` — B-001)
import '@/lib/zodConfig';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ไม่พบ #root element ใน index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
