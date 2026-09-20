import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { ProposalEmptyState } from './ProposalEmptyState';

describe('ProposalEmptyState (S11, po-review ชุด B)', () => {
  it('แสดงหัวข้อ/เนื้อหา empty เดิม', () => {
    render(<ProposalEmptyState />);
    expect(screen.getByText(t('proposal.emptyTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('proposal.emptyBody'))).toBeInTheDocument();
  });

  it('แสดง checklist ข้อมูลที่ผู้ช่วยยังต้องการจาก proposal.checklist*', () => {
    render(<ProposalEmptyState />);
    expect(screen.getByText(t('proposal.checklistTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('proposal.checklistWhat'))).toBeInTheDocument();
    expect(screen.getByText(t('proposal.checklistQty'))).toBeInTheDocument();
    expect(screen.getByText(t('proposal.checklistSpec'))).toBeInTheDocument();
    expect(screen.getByText(t('proposal.checklistWhere'))).toBeInTheDocument();
    expect(screen.getByText(t('proposal.checklistWhen'))).toBeInTheDocument();
    expect(screen.getByText(t('proposal.checklistWho'))).toBeInTheDocument();
  });
});
