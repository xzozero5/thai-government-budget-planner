import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Citation } from '@/ai/tools/proposal';
import { t } from '@/i18n';
import { CitationChip } from './CitationChip';

describe('CitationChip', () => {
  it('kind อื่นที่ไม่ใช่ web: ทั้ง chip เป็นปุ่มเดียว เรียก onOpenDrawer', async () => {
    const user = userEvent.setup();
    const onOpenDrawer = vi.fn();
    const citation: Citation = { kind: 'econ', indicator: 'cpi', year_be: 2567 };
    render(<CitationChip citation={citation} onOpenDrawer={onOpenDrawer} />);

    const button = screen.getByRole('button', { name: 'CPI 2567' });
    await user.click(button);
    expect(onOpenDrawer).toHaveBeenCalledTimes(1);
  });

  it('label override ใช้แทนค่าที่คำนวณเอง', () => {
    const citation: Citation = { kind: 'budget_line', source_id: 'bl_1' };
    render(<CitationChip citation={citation} onOpenDrawer={vi.fn()} label="PBO 2568 · กรมชลประทาน" />);
    expect(screen.getByRole('button', { name: 'PBO 2568 · กรมชลประทาน' })).toBeInTheDocument();
  });

  it('kind=web https: เป็นลิงก์เปิดแท็บใหม่ + มีปุ่มเปิด drawer แยกต่างหาก', async () => {
    const user = userEvent.setup();
    const onOpenDrawer = vi.fn();
    const citation: Citation = {
      kind: 'web',
      url: 'https://www.shopee.co.th/x',
      retrieved_at: '2026-09-01',
    };
    render(<CitationChip citation={citation} onOpenDrawer={onOpenDrawer} />);

    const link = screen.getByRole('link', { name: /shopee\.co\.th/ });
    expect(link).toHaveAttribute('href', 'https://www.shopee.co.th/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));

    const drawerButton = screen.getByRole('button', { name: t('a11y.citationDrawer') });
    await user.click(drawerButton);
    expect(onOpenDrawer).toHaveBeenCalledTimes(1);
    // ปุ่มเปิด drawer ต้องไม่ทำให้ลิงก์ถูกกดไปด้วย (สอง target แยกกัน)
    expect(link).toBeInTheDocument();
  });

  it('kind=web http:// (ไม่ใช่ https): ไม่มี role=link แต่ปุ่มเปิด drawer ยังกดได้', async () => {
    const user = userEvent.setup();
    const onOpenDrawer = vi.fn();
    const citation: Citation = { kind: 'web', url: 'http://example.com/x', retrieved_at: '2026-09-01' };
    render(<CitationChip citation={citation} onOpenDrawer={onOpenDrawer} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('a11y.citationDrawer') }));
    expect(onOpenDrawer).toHaveBeenCalledTimes(1);
  });

  it('unresolved=true แสดงป้าย "อ้างอิงไม่พบ" ที่มองเห็นได้', () => {
    const citation: Citation = { kind: 'document', doc_id: 'doc-1', page: 5 };
    render(<CitationChip citation={citation} onOpenDrawer={vi.fn()} unresolved />);
    expect(
      screen.getByText((_, element) => element?.textContent === `· ${t('citation.notFoundBadge')}`),
    ).toBeInTheDocument();
  });
});
