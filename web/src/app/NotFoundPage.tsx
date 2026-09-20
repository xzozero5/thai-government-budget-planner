import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@/i18n';

/** T-405 — 404 (06 §3) */
export function NotFoundPage(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold text-fg">{t('errors.notFoundTitle')}</h1>
      <p className="text-fg-muted">{t('errors.notFoundBody')}</p>
      <Link
        to="/"
        className="text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t('errors.notFoundAction')}
      </Link>
    </main>
  );
}
