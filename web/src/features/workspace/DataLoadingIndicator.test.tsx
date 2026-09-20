import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { useDataStore } from '@/stores/dataStore';
import { DataLoadingIndicator } from './DataLoadingIndicator';

beforeEach(() => {
  useDataStore.getState().reset();
});

describe('DataLoadingIndicator (06 §4.6 มุมล่างซ้าย)', () => {
  it('ไม่แสดงอะไรเมื่อทุกแหล่งยัง idle', () => {
    render(<DataLoadingIndicator />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('แสดงข้อความกำลังโหลดเมื่อมีแหล่งใดแหล่งหนึ่ง loading', () => {
    useDataStore.getState().setStatus('duckdb', 'loading');
    render(<DataLoadingIndicator />);
    expect(screen.getByText(t('data.loadingEngine'))).toBeInTheDocument();
  });

  it('แสดงข้อความ error เมื่อมีแหล่งใดแหล่งหนึ่ง error', () => {
    useDataStore.getState().setStatus('searchIndex', 'error', 'เครือข่ายขัดข้อง');
    render(<DataLoadingIndicator />);
    expect(screen.getByText(t('data.failed', { reason: 'เครือข่ายขัดข้อง' }))).toBeInTheDocument();
  });
});
