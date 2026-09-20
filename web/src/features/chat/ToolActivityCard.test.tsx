import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolActivity } from '@/stores/chatStore';
import { t } from '@/i18n';
import { ToolActivityCard } from './ToolActivityCard';

function activity(overrides: Partial<ToolActivity>): ToolActivity {
  return { id: 'a1', name: 'search_catalog', status: 'running', ...overrides };
}

describe('ToolActivityCard (06 §7 #25)', () => {
  it('running: แสดงข้อความ "กำลังทำงาน" ของ tool นั้น ๆ', () => {
    render(<ToolActivityCard activity={activity({ status: 'running' })} />);
    expect(screen.getByText(/กำลังค้นว่ามีรายการคล้าย/)).toBeInTheDocument();
  });

  it('done: แสดงสรุปผลจริง (inputSummary) + ปุ่มดูผลเมื่อมี onViewResults', () => {
    const onViewResults = vi.fn();
    render(
      <ToolActivityCard
        activity={activity({ status: 'done', inputSummary: 'search_catalog: พบ 5 รายการ' })}
        onViewResults={onViewResults}
      />,
    );

    expect(screen.getByText('search_catalog: พบ 5 รายการ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('chat.tool.viewResults') }));
    expect(onViewResults).toHaveBeenCalledOnce();
  });

  it('error: ไม่มีปุ่มดูผล แม้ส่ง onViewResults มา', () => {
    render(
      <ToolActivityCard
        activity={activity({ status: 'error', inputSummary: 'search_catalog: เรียกใช้ไม่สำเร็จ' })}
        onViewResults={vi.fn()}
      />,
    );

    expect(screen.getByText('search_catalog: เรียกใช้ไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('chat.tool.viewResults') })).not.toBeInTheDocument();
  });

  it('web_search: แสดง query เสมอ (แม้ไม่ได้ส่ง onViewResults มา) + ไม่มีปุ่มดูผล', () => {
    render(<ToolActivityCard activity={activity({ name: 'web_search', status: 'done', inputSummary: 'แอร์ 18000 บีทียู' })} />);

    expect(screen.getByText(/แอร์ 18000 บีทียู/)).toBeInTheDocument();
    expect(screen.getByText(t('chat.tool.web_search.notice'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('chat.tool.viewResults') })).not.toBeInTheDocument();
  });

  describe('M4 (po-review ชุด B, US-2.2): ข้อความผล tool จาก `summary` แบบมีโครงสร้าง', () => {
    it('มี summary ครบ (count+query) → แสดงข้อความไทยล้วนจาก chat.tool.<tool>.<status> แทน inputSummary', () => {
      render(
        <ToolActivityCard
          activity={activity({
            status: 'done',
            inputSummary: 'search_catalog: พบ 5 รายการ',
            summary: { tool: 'search_catalog', status: 'done', count: 5, query: 'เครื่องปรับอากาศ' },
          })}
        />,
      );
      expect(
        screen.getByText(t('chat.tool.search_catalog.done', { count: 5, query: 'เครื่องปรับอากาศ' })),
      ).toBeInTheDocument();
      expect(screen.queryByText('search_catalog: พบ 5 รายการ')).not.toBeInTheDocument();
    });

    it('summary ว่าง (count=0) → ใช้ข้อความ empty ไทยล้วน', () => {
      render(
        <ToolActivityCard
          activity={activity({
            status: 'done',
            inputSummary: 'search_catalog: พบ 0 รายการ',
            summary: { tool: 'search_catalog', status: 'empty', count: 0, query: 'ของหายาก' },
          })}
        />,
      );
      expect(
        screen.getByText(t('chat.tool.search_catalog.empty', { query: 'ของหายาก' })),
      ).toBeInTheDocument();
    });

    it('มี summary แต่ placeholder ที่ template ต้องการไม่ครบ (เช่น {from}/{to}) → fallback ไปใช้ inputSummary เดิม', () => {
      render(
        <ToolActivityCard
          activity={activity({
            name: 'query_budget_lines',
            status: 'done',
            inputSummary: 'query_budget_lines: ได้ 12 แถว',
            summary: { tool: 'query_budget_lines', status: 'done', count: 12 },
          })}
        />,
      );
      expect(screen.getByText('query_budget_lines: ได้ 12 แถว')).toBeInTheDocument();
    });

    it('ไม่มี summary เลย → พฤติกรรมเดิม (ใช้ inputSummary ตรง ๆ)', () => {
      render(
        <ToolActivityCard
          activity={activity({ status: 'done', inputSummary: 'search_catalog: พบ 5 รายการ' })}
        />,
      );
      expect(screen.getByText('search_catalog: พบ 5 รายการ')).toBeInTheDocument();
    });

    it('T-410 ข้อ 1 (หลัง demo จริง 2569-09-20): status=error มี summary.reason → แสดงเหตุผลจริงแทน "เรียกใช้ไม่สำเร็จ" เฉย ๆ', () => {
      render(
        <ToolActivityCard
          activity={activity({
            status: 'error',
            inputSummary: 'search_catalog: เรียกใช้ไม่สำเร็จ',
            summary: { tool: 'search_catalog', status: 'error', reason: 'คำค้นว่างเปล่า' },
          })}
        />,
      );
      expect(
        screen.getByText(t('chat.tool.search_catalog.error', { reason: 'คำค้นว่างเปล่า' })),
      ).toBeInTheDocument();
      expect(screen.queryByText('search_catalog: เรียกใช้ไม่สำเร็จ')).not.toBeInTheDocument();
    });

    it('status=error ไม่มี summary.reason → fallback ข้อความเดิม ("เรียกใช้ไม่สำเร็จ")', () => {
      render(
        <ToolActivityCard
          activity={activity({
            status: 'error',
            inputSummary: 'search_catalog: เรียกใช้ไม่สำเร็จ',
            summary: { tool: 'search_catalog', status: 'error' },
          })}
        />,
      );
      expect(screen.getByText('search_catalog: เรียกใช้ไม่สำเร็จ')).toBeInTheDocument();
    });

    it('web_search ยังต้องแสดง query เสมอแม้มี summary (ไม่ใช้ chat.tool.web_search.done)', () => {
      render(
        <ToolActivityCard
          activity={activity({
            name: 'web_search',
            status: 'done',
            summary: { tool: 'web_search', status: 'done', count: 3, query: 'แอร์ 18000 บีทียู' },
          })}
        />,
      );
      expect(screen.getByText(/แอร์ 18000 บีทียู/)).toBeInTheDocument();
    });
  });
});
