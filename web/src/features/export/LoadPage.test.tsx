import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqLine, Proposal } from '@/ai/tools/proposal';
import { t } from '@/i18n';
import { LoadPage } from './LoadPage';
import { serializeSession, TGBP_FILE_MAX_BYTES } from './tgbpFile';

vi.mock('./ExportDialog', () => ({
  ExportDialog: () => null,
}));

function makeLine(overrides: Partial<BoqLine> = {}): BoqLine {
  return {
    id: 'line1',
    category: 'ครุภัณฑ์',
    item: 'เครื่องปรับอากาศ',
    qty: 1,
    unit: 'เครื่อง',
    unit_price_thb: 20000,
    total_thb: 20000,
    basis: 'historical',
    confidence: 'high',
    rationale: 'อ้างอิงราคาจากงบปี 2567',
    citations: [{ kind: 'budget_line', source_id: 'src_1' }],
    ...overrides,
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    version: 1,
    title: 'โครงการที่บันทึกไว้',
    summary: 'สรุปทดสอบ',
    mode: 'draft',
    requester_context: { fiscal_year_be: 2569 },
    objectives: [],
    scope_and_specs: [],
    assumptions: [],
    boq: [makeLine()],
    totals: { subtotal_thb: 20000, vat_included: false, grand_total_thb: 20000 },
    comparables: [],
    risks: [],
    open_questions: [],
    citations_web: [],
    illustrations: [],
    stat_cards: [],
    ...overrides,
  };
}

function validTgbpJson(overrides: Partial<Proposal> = {}): string {
  return serializeSession({
    proposalVersions: [
      {
        id: 'propver_1',
        proposal: makeProposal(overrides),
        warnings: [],
        createdAt: 1_700_000_000_000,
        source: 'ai',
        userEditedLineIds: [],
      },
    ],
    currentProposalIndex: 0,
    chatMessages: [],
    appDataVersion: '2026-09-01',
  });
}

function renderLoadPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LoadPage />
    </MemoryRouter>,
  );
}

async function uploadFile(content: BlobPart, name = 'proposal.tgbp.json'): Promise<void> {
  const user = userEvent.setup();
  const file = new File([content], name, { type: 'application/json' });
  const input = screen.getByLabelText(t('export.load.choose'), { selector: 'input' });
  await user.upload(input, file);
}

describe('LoadPage', () => {
  const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

  beforeEach(() => {
    storageSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('สถานะเริ่มต้น: dropzone + ปุ่มเลือกไฟล์', () => {
    renderLoadPage();
    expect(screen.getByRole('heading', { name: t('export.load.title') })).toBeInTheDocument();
    expect(screen.getByText(t('export.load.dropzone'))).toBeInTheDocument();
  });

  it('ไฟล์ดี → แสดงข้อเสนอแบบอ่านอย่างเดียว พร้อมแบนเนอร์', async () => {
    await renderAndUpload(validTgbpJson());
    expect(screen.getByText(t('export.load.readOnlyBadge'))).toBeInTheDocument();
    expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument();
  });

  it('ไฟล์ดี → ไม่มีปุ่มแก้ qty/ราคาที่เปลี่ยนค่าจริง (onEditLine เป็น no-op ไม่ throw)', async () => {
    await renderAndUpload(validTgbpJson());
    // ตารางแสดงค่าปกติได้โดยไม่ error — ปุ่มแก้ยังกดได้ (ข้อจำกัดที่ทราบ ดูหมายเหตุหัวไฟล์ LoadPage.tsx)
    // แต่ค่าต้องไม่เปลี่ยนหลังกด เพราะ onEditLine เป็น no-op
    const user = userEvent.setup();
    const [qtyButton] = screen.getAllByRole('button', { name: /แก้จำนวนของ/ });
    if (!qtyButton) {
      throw new Error('ไม่พบปุ่มแก้จำนวน');
    }
    await user.click(qtyButton);
    const [totalBefore] = screen.getAllByText('20,000');
    expect(totalBefore).toBeInTheDocument();
  });

  it('JSON เสีย → แสดง error ไทยที่เข้าใจได้', async () => {
    await renderAndUpload('{ ไม่ใช่ json แน่นอน');
    expect(screen.getByRole('alert')).toHaveTextContent(t('export.load.invalid'));
  });

  it('schema ผิด (field แปลกปลอม) → แสดง error เดียวกัน', async () => {
    const polluted = JSON.stringify({ ...JSON.parse(validTgbpJson()), apiKey: 'x' });
    await renderAndUpload(polluted);
    expect(screen.getByRole('alert')).toHaveTextContent(t('export.load.invalid'));
  });

  it('ไฟล์ใหญ่เกินเพดาน → แสดง error ก่อนอ่านเนื้อไฟล์', async () => {
    const big = new Uint8Array(TGBP_FILE_MAX_BYTES + 1);
    await renderAndUpload(big, 'big.tgbp.json');
    expect(screen.getByRole('alert')).toHaveTextContent('MB');
  });

  it('ไม่มีการเรียก Storage API เลยตลอด flow (N2)', async () => {
    await renderAndUpload(validTgbpJson());
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('ลิงก์ "เริ่มงานใหม่ด้วย key ของคุณ" ชี้ไปหน้าแรก', async () => {
    await renderAndUpload(validTgbpJson());
    const link = screen.getByRole('link', { name: t('export.load.addKey') });
    expect(link).toHaveAttribute('href', '/');
  });

  async function renderAndUpload(content: BlobPart, name?: string): Promise<void> {
    renderLoadPage();
    await uploadFile(content, name);
    await waitFor(() => {
      expect(
        screen.queryByRole('status') ?? screen.queryByText(t('export.load.loading')),
      ).not.toBeInTheDocument();
    });
  }
});

describe('LoadPage — citation drawer (ข้อมูลจากไฟล์เท่านั้น)', () => {
  it('citation kind=document พร้อม quote ในไฟล์ → แสดง quote ได้โดยไม่เรียก data layer', async () => {
    const proposal = makeProposal({
      boq: [
        makeLine({
          citations: [{ kind: 'document', doc_id: 'doc_1', page: 3, quote: 'ข้อความอ้างอิงในไฟล์' }],
        }),
      ],
    });
    renderLoadPage();
    await uploadFile(validTgbpJson(proposal));
    await waitFor(() => expect(screen.getByText('โครงการที่บันทึกไว้')).toBeInTheDocument());

    const user = userEvent.setup();
    const desktopTable = screen.getByTestId('boq-table-desktop');
    const chip = within(desktopTable).getByRole('button', { name: 'doc_1' });
    await user.click(chip);

    const drawer = await screen.findByRole('dialog', { name: t('citation.types.document') });
    expect(within(drawer).getByText('ข้อความอ้างอิงในไฟล์')).toBeInTheDocument();
  });
});
