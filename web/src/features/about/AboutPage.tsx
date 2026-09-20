/**
 * T-404 — About page (06 §4.6 route `/about`, wireframes.md "about")
 *
 * ข้อความทั้งหมดมาจาก `docs/ui/copy.th.json` namespace `about.*` (N7/06 §7) — ไม่ hard-code ไทยเพิ่ม
 *
 * แหล่งข้อมูล/ปีที่ใช้: แสดงข้อความคงที่จาก copy (`about.sourceBudget`/`sourceEcon`/`sourceWeb`) แทนการ
 * เรียก `data.facets()`/manifest จริง — หน้านี้เป็นหน้าข้อมูลนิ่ง ไม่ควรผูกกับ data engine (DuckDB/manifest)
 * ที่ยังพัฒนาขนานอยู่ใน Phase 2/3 เพื่อลดความเสี่ยงจากการพึ่งพาข้ามทีม
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, ExternalLink } from '@/components/ui';
import { t } from '@/i18n';

const GITHUB_URL = 'https://github.com/xzozero5/thai-government-budget-planner';

function Section({ title, children }: { title: string; children: ReactElement }): ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

export function AboutPage(): ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-fg">{t('about.title')}</h1>
        <p className="text-fg-muted">{t('about.intro')}</p>
      </header>

      <Section title={t('about.howTitle')}>
        <ol className="flex flex-col gap-2 text-fg">
          <li>1. {t('about.howStep1')}</li>
          <li>2. {t('about.howStep2')}</li>
          <li>3. {t('about.howStep3')}</li>
          <li>4. {t('about.howStep4')}</li>
        </ol>
      </Section>

      <Section title={t('about.sourcesTitle')}>
        <ul className="flex flex-col gap-2 text-fg">
          <li>{t('about.sourceBudget')}</li>
          <li>{t('about.sourceEcon')}</li>
          <li>{t('about.sourceWeb')}</li>
        </ul>
      </Section>

      <Section title={t('about.limitsTitle')}>
        <ul className="flex flex-col gap-2 text-fg">
          <li>{t('about.limitScan')}</li>
          <li>{t('about.limitOcr')}</li>
          <li>{t('about.limitEstimate')}</li>
          <li>{t('about.limitUnitPriceScarce')}</li>
          <li>{t('about.limitFy2562')}</li>
          <li>{t('about.limitLocalOcr')}</li>
          <li>{t('about.limitEconUnverified')}</li>
          <li>{t('about.limitAi')}</li>
        </ul>
      </Section>

      <Section title={t('about.privacyTitle')}>
        <p className="text-fg">{t('about.privacyBody')}</p>
      </Section>

      <Section title={t('about.costTitle')}>
        <p className="text-fg">{t('about.costBody')}</p>
      </Section>

      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-fg">{t('about.licenseTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('about.licenseBody')}</p>
        <ExternalLink href={GITHUB_URL} className="text-sm">
          {GITHUB_URL}
        </ExternalLink>
      </Card>

      <Link
        to="/"
        className="text-sm text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t('about.backToApp')}
      </Link>
    </main>
  );
}
