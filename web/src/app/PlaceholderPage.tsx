import type { ReactElement } from 'react';

export function PlaceholderPage(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center text-slate-900">
      <h1 className="text-3xl font-bold sm:text-4xl">เครื่องมือวางแผนงบประมาณภาครัฐ (TGBP)</h1>
      <p className="text-lg text-slate-600">กำลังพัฒนา</p>
    </main>
  );
}
