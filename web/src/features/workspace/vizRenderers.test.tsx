import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatCard as StatCardData, TrendRef } from '@/ai/tools/proposal';
import { t } from '@/i18n';
import { BoqTrendCell, ProposalStatCard } from './vizRenderers';
import { resetTrendCacheForTests } from './trendData';

const dataMocks = vi.hoisted(() => ({
  getPriceTrend: vi.fn(),
}));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    data: {
      ...actual.data,
      ...dataMocks,
    },
  };
});

beforeEach(() => {
  resetTrendCacheForTests();
  dataMocks.getPriceTrend.mockReset();
});

afterEach(() => {
  resetTrendCacheForTests();
});

function statCard(kind: 'item' | 'indicator', key: string): StatCardData {
  return { trend_ref: { kind, key }, headline_th: 'หัวข้อทดสอบ' };
}

const itemTrendRef: TrendRef = { kind: 'item', key: 'concrete_240ksc' };

describe('ProposalStatCard (S8, po-review ชุด B) — deltaPct/sourceLabel/verified', () => {
  it('PriceTrend (item ในคลังงบของเว็บเอง): verified=true เสมอ, ไม่มี sourceLabel, มี deltaPct จาก changePct', async () => {
    dataMocks.getPriceTrend.mockResolvedValue({
      key: 'concrete_240ksc',
      basis: 'unit_price_per_line',
      unitLabel: 'บาท/หน่วย',
      points: [{ yearBe: 2567, n: 5, median: 2350 }],
      changePct: { fromYear: 2563, toYear: 2567, pct: 12.5 },
      caveats: [],
    });

    render(<ProposalStatCard card={statCard('item', 'concrete_240ksc')} />);

    expect(await screen.findByText(t('proposal.stat.verified'))).toBeInTheDocument();
    expect(screen.getByText('+12.5%')).toBeInTheDocument();
    expect(screen.queryByText(/^ที่มา /)).not.toBeInTheDocument();
  });

  it('EconTrend (ตัวชี้วัดเศรษฐกิจ): verified=false เสมอ + มี sourceLabel จาก source_name', async () => {
    dataMocks.getPriceTrend.mockResolvedValue({
      indicator: 'cpi',
      label_th: 'ดัชนีราคาผู้บริโภค',
      unit: 'จุด',
      points: [{ yearBe: 2567, value: 108.2 }],
      source_name: 'สำนักงานสถิติแห่งชาติ',
      source_url: 'https://example.go.th',
      verified: false,
      changePct: null,
      caveats: [],
    });

    render(<ProposalStatCard card={statCard('indicator', 'cpi')} />);

    expect(await screen.findByText(t('proposal.stat.unverified'))).toBeInTheDocument();
    expect(
      screen.getByText(t('proposal.stat.sourceLabel', { source: 'สำนักงานสถิติแห่งชาติ' })),
    ).toBeInTheDocument();
    // changePct เป็น null (ตัวอย่างน้อย) → ไม่มี Δ% ให้แสดง
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});

describe('BoqTrendCell — tooltip ปี/มัธยฐาน/n (ของใหม่จากชุด A: proposal.boq.trendTooltip)', () => {
  it('PriceTrend มีจุดข้อมูล → เนื้อหา tooltip มีปี/มัธยฐาน/จำนวนรายการ', async () => {
    dataMocks.getPriceTrend.mockResolvedValue({
      key: 'concrete_240ksc',
      basis: 'unit_price_per_line',
      unitLabel: 'บาท/หน่วย',
      points: [{ yearBe: 2567, n: 5, median: 2350 }],
      changePct: null,
      caveats: [],
    });
    render(<BoqTrendCell trendRef={itemTrendRef} />);

    await screen.findByRole('img');
    expect(
      screen.getByText(t('proposal.boq.trendTooltip', { year: 2567, median: '2,350', count: 5 })),
    ).toBeInTheDocument();
  });
});
