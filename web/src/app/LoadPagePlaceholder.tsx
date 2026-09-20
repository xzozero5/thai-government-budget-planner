import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { t } from '@/i18n';

/**
 * T-405 — placeholder ของ `/load` (06 §3/§4.5: เปิดไฟล์ `.tgbp.json` อย่างเดียว ไม่ต้องมี key)
 * T-502 จะมาแทนที่ด้วยฟังก์ชันเปิดไฟล์จริง (drag-drop/`features/export/tgbpFile.ts`) — หน้านี้แค่แสดง
 * โครง/ข้อความให้ผู้ใช้รู้ว่าเส้นทางนี้มีอยู่ ไม่ทำงานจริง
 */
export function LoadPagePlaceholder(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <Card className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-fg">{t('export.load.title')}</h1>
        <p className="mt-2 text-sm text-fg-muted">{t('export.load.intro')}</p>
        <div className="mt-4 rounded-md border-2 border-dashed border-line p-6 text-sm text-fg-muted">
          {t('export.load.dropzone')}
        </div>
        <Link
          to="/"
          className="mt-4 inline-block text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('common.back')}
        </Link>
      </Card>
    </main>
  );
}
