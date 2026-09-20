import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { KeyGatePage } from '@/features/keygate/KeyGatePage';
import * as keyHolder from '@/ai/session/keyHolder';

// N: ห้ามเขียนสตริงรูป key จริง/ปลอมแบบ `sk-ant-` + อักขระ >= 8 ตัวตรง ๆ ในไฟล์ — ประกอบจาก parts
const FAKE_KEY = ['sk', 'ant', 'fake-key-for-unit-test'].join('-');

const verifyKeyMock = vi.fn();

vi.mock('@/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/client')>();
  return {
    ...actual,
    // mock เฉพาะ verifyKey — createClient ของจริงไม่แตะ network (สร้าง Anthropic instance เฉย ๆ)
    verifyKey: (...args: Parameters<typeof actual.verifyKey>) =>
      verifyKeyMock(...args) as ReturnType<typeof actual.verifyKey>,
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<KeyGatePage />} />
        <Route path="/workspace" element={<div>WORKSPACE_OK</div>} />
        <Route path="/about" element={<div>ABOUT_OK</div>} />
        <Route path="/load" element={<div>LOAD_OK</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  // เหตุผลเดียวกับ sessionStore.test.ts: ใช้ clearKey ไม่ใช่ __resetForTests เพราะ sessionStore
  // ลงทะเบียน onClear ครั้งเดียวตอน import โมดูล
  keyHolder.clearKey('manual');
  verifyKeyMock.mockReset();
});

describe('KeyGatePage', () => {
  it('flow สำเร็จ: setKey ถูกเรียก (keyHolder มี key), navigate ไป /workspace, ไม่มี key หลงเหลือใน DOM', async () => {
    verifyKeyMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText('API key ของ Anthropic');
    await user.type(input, FAKE_KEY);
    await user.click(screen.getByRole('button', { name: 'ทดสอบและเริ่ม' }));

    await waitFor(() => {
      expect(screen.getByText('WORKSPACE_OK')).toBeInTheDocument();
    });

    expect(keyHolder.hasKey()).toBe(true);
    expect(document.body.innerHTML).not.toContain(FAKE_KEY);
  });

  it.each([
    ['auth', 'key ใช้ไม่ได้ (401)'],
    ['permission', 'ไม่มีสิทธิ์เรียกโมเดล'],
    ['rate_limit', 'ถูกจำกัดอัตราการเรียก'],
    ['network', 'ต่อ api.anthropic.com ไม่ได้'],
  ] as const)(
    'error kind=%s → แสดงข้อความที่ถูกต้องจาก copy, ล้าง input, ไม่มี key ใน DOM, ไม่ navigate',
    async (kind, expectedSubstring) => {
      verifyKeyMock.mockResolvedValue({ ok: false, kind, messageTh: 'ผิดพลาด' });
      const user = userEvent.setup();
      renderPage();

      const input = screen.getByLabelText<HTMLInputElement>('API key ของ Anthropic');
      await user.type(input, FAKE_KEY);
      await user.click(screen.getByRole('button', { name: 'ทดสอบและเริ่ม' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(expectedSubstring);
      expect(input.value).toBe('');
      expect(document.body.innerHTML).not.toContain(FAKE_KEY);
      expect(keyHolder.hasKey()).toBe(false);
      expect(screen.queryByText('WORKSPACE_OK')).not.toBeInTheDocument();
    },
  );

  it('validate รูปแบบ inline: key ผิดรูปแบบ → ไม่ยิง verifyKey เลย, โชว์ error ทันที', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('API key ของ Anthropic'), 'not-a-real-key');
    await user.click(screen.getByRole('button', { name: 'ทดสอบและเริ่ม' }));

    expect(await screen.findByText(/sk-ant-/)).toBeInTheDocument();
    expect(verifyKeyMock).not.toHaveBeenCalled();
  });

  it('validate รูปแบบ inline: ปล่อยว่างแล้วกดส่ง → บอกให้ใส่ key ก่อน', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ทดสอบและเริ่ม' }));

    expect(await screen.findByText('ใส่ API key ก่อนถึงจะเริ่มได้')).toBeInTheDocument();
    expect(verifyKeyMock).not.toHaveBeenCalled();
  });

  it('ไม่มีการเรียก Storage API ตลอด flow (สำเร็จ)', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    verifyKeyMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('API key ของ Anthropic'), FAKE_KEY);
    await user.click(screen.getByRole('button', { name: 'ทดสอบและเริ่ม' }));
    await waitFor(() => expect(screen.getByText('WORKSPACE_OK')).toBeInTheDocument());

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it('a11y: label ผูก input (type=password เริ่มต้น), ปุ่มแสดง/ซ่อนมี aria-pressed สลับได้', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText('API key ของ Anthropic');
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'แสดง key' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'ซ่อน key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('มี key อยู่แล้ว (hasKey=true) → redirect /workspace ทันทีโดยไม่ต้องกดอะไร', async () => {
    verifyKeyMock.mockResolvedValue({ ok: true });
    const { useSessionStore } = await import('@/stores/sessionStore');
    await useSessionStore.getState().submitKey(FAKE_KEY);

    renderPage();

    await waitFor(() => expect(screen.getByText('WORKSPACE_OK')).toBeInTheDocument());
  });

  it('T-410 ข้อ 1 (US-1.2): แสดงประมาณการต้นทุนต่อข้อเสนอ ใต้ตัวเลือกโมเดล พร้อมป้าย "ยังไม่ได้วัดจริง" สำหรับ Sonnet (ค่าเริ่มต้น)', () => {
    renderPage();

    expect(screen.getByText(/ข้อเสนอหนึ่งฉบับใช้ประมาณ/)).toBeInTheDocument();
    expect(screen.getByText(t('common.costEstimateUnverified'))).toBeInTheDocument();
  });

  it('T-410 ข้อ 1: เปลี่ยนไปโมเดล Haiku (วัดจริงแล้ว) → ป้าย "ยังไม่ได้วัดจริง" หายไป', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('โมเดลที่ใช้'), 'claude-haiku-4-5-20251001');

    expect(screen.queryByText(t('common.costEstimateUnverified'))).not.toBeInTheDocument();
  });
});
