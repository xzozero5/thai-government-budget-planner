/**
 * main thread (review ของ T-502): หน้า `/load` เป็นโหมดอ่านอย่างเดียว — เดิมส่งแค่ handler เปล่า ช่อง BOQ ยัง
 * กดเข้าโหมดพิมพ์ได้และปุ่ม "ให้ AI ทบทวน" ยังโผล่ → ต้องปิดจริงผ่าน `ProposalReadOnlyContext`
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { richProposalFixture } from './__fixtures__/proposal.fixture';
import { BoqTable } from './BoqTable';
import { ProposalReadOnlyContext } from './readOnlyContext';

function renderTable(readOnly: boolean, onEditLine = vi.fn(), onRequestReview = vi.fn()) {
  const firstLineId = richProposalFixture.boq[0]?.id ?? '';
  render(
    <ProposalReadOnlyContext.Provider value={readOnly}>
      <BoqTable
        proposal={richProposalFixture}
        editedLineIds={[firstLineId]}
        onEditLine={onEditLine}
        onRequestReview={onRequestReview}
        onOpenCitation={vi.fn()}
      />
    </ProposalReadOnlyContext.Provider>,
  );
  return { onEditLine, onRequestReview };
}

describe('โหมดอ่านอย่างเดียวของ BOQ (ProposalReadOnlyContext)', () => {
  async function clickEveryButton(): Promise<number> {
    const user = userEvent.setup();
    let inputsSeen = 0;
    for (const button of screen.getAllByRole('button')) {
      if (!document.body.contains(button)) continue;
      await user.click(button).catch(() => undefined);
      inputsSeen +=
        screen.queryAllByRole('spinbutton').length + screen.queryAllByRole('textbox').length;
      await user.keyboard('{Escape}');
    }
    return inputsSeen;
  }

  it('ปกติ: มีปุ่ม "ให้ AI ทบทวน" บนแถวที่ผู้ใช้แก้ และกดช่องตัวเลขแล้วเข้าโหมดพิมพ์ได้', async () => {
    renderTable(false);
    expect(
      screen.getAllByRole('button', { name: t('proposal.reviewWithAi') }).length,
    ).toBeGreaterThan(0);
    expect(await clickEveryButton()).toBeGreaterThan(0);
  });

  it('read-only: ไม่มีปุ่ม "ให้ AI ทบทวน" และกดปุ่มใดในตารางก็ไม่เกิดช่องพิมพ์/ไม่เรียก onEditLine', async () => {
    const { onEditLine, onRequestReview } = renderTable(true);
    expect(
      screen.queryByRole('button', { name: t('proposal.reviewWithAi') }),
    ).not.toBeInTheDocument();
    expect(await clickEveryButton()).toBe(0);
    expect(onEditLine).not.toHaveBeenCalled();
    expect(onRequestReview).not.toHaveBeenCalled();
  });
});
