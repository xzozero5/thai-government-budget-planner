import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryIllustrationSink } from '@/ai/illustrationSink';
import { sessionChatController } from '@/ai/session/chatController';
import { createToolLog } from '@/ai/toolLog';
import { ToastProvider } from '@/components/ui';
import type { BudgetLine } from '@/data';
import { saveSessionFile } from '@/features/export';
import {
  realAircondProposal,
  richProposalFixture,
} from '@/features/proposal/__fixtures__/proposal.fixture';
import { t } from '@/i18n';
import { useChatStore } from '@/stores/chatStore';
import { useProposalStore } from '@/stores/proposalStore';
import { useToolLogStore } from '@/stores/toolLogStore';
import { CitationDrawerContainer, ProposalPaneContainer, type CitationDrawerOpenState } from './slots';

const SVG_FIXTURES_DIR = join(__dirname, '../../lib/__fixtures__/svg');
const GOOD_ILLUSTRATIONS_DIR = join(__dirname, '../../../../docs/ui/illustrations');

function readSvgFixture(name: string): string {
  return readFileSync(join(SVG_FIXTURES_DIR, name), 'utf8');
}

function readGoodIllustration(name: string): string {
  return readFileSync(join(GOOD_ILLUSTRATIONS_DIR, name), 'utf8');
}

function makeBudgetLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    source_id: '69457f86e9f75890',
    dataset: 'pbo_disbursement',
    fiscal_year_be: 2568,
    gov_level: 'central',
    ministry: 'ศึกษาธิการ',
    ministry_code: null,
    agency: 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน',
    agency_code: null,
    province: null,
    local_gov_name: null,
    strategy: null,
    budget_group: null,
    plan: null,
    output_project: null,
    activity: null,
    budget_type: null,
    expense_category: null,
    is_capital: null,
    item_name_raw: 'เครื่องปรับอากาศแบบแยกส่วน',
    item_key: 'เครื่องปรับอากาศ',
    item_qty: 1,
    item_unit: 'เครื่อง',
    spec_tokens: [],
    amount_thb: 279000,
    unit_price_thb: 279000,
    revised_thb: null,
    po_thb: null,
    disbursed_thb: null,
    disbursed_incl_po_thb: null,
    reserved_thb: null,
    carryover_thb: null,
    disbursement_rate: null,
    description: null,
    legal_reference: null,
    source_path: 'เพราะ AI ไม่ใช่แค่ CHATBOT/PBO/x.xlsx',
    source_sheet: 'เบิกจ่าย68',
    source_row: 10,
    source_page: null,
    source_doc_id: 'doc-1',
    quality_flags: [],
    ...overrides,
  };
}

vi.mock('@/ai/session/chatController', () => ({
  sessionChatController: {
    requestReview: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

vi.mock('@/features/export', () => ({
  ExportDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="export-dialog-stub" /> : null,
  saveSessionFile: vi.fn(),
  downloadSessionFile: vi.fn(),
}));

// เก็บ mock ของ `data.getLines`/... ไว้ใน object แยก (ไม่ผูก type `DataFacade`) เพื่อเลี่ยง
// `@typescript-eslint/unbound-method`: เมธอดของ `DataFacade` ประกาศแบบ method-shorthand ใน interface
// (มี implicit `this`) การ extract `data.getLines` มาเทียบ/ตั้งค่าตรง ๆ จึงถูก eslint ฟ้อง — object นี้
// เป็น plain `vi.fn()` ล้วน ๆ ไม่มี `this` ให้ต้อง unbound
const dataMocks = vi.hoisted(() => ({
  getLines: vi.fn(),
  getNeighborLines: vi.fn(),
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

/** ประกอบ `ProposalPaneContainer` + `CitationDrawerContainer` แบบเดียวกับที่ `WorkspacePage` ทำจริง
 * (ยก state `drawerState` ขึ้นมาไว้ที่ผู้เรียกร่วมทั้งสอง) เพื่อทดสอบการเชื่อมต่อจริงระหว่างสองไฟล์ */
function Harness(): ReactElement {
  const [drawerState, setDrawerState] = useState<CitationDrawerOpenState | null>(null);
  return (
    <ToastProvider>
      <ProposalPaneContainer
        onOpenCitation={(citation, line) => {
          setDrawerState(line !== undefined ? { kind: 'citation', citation, contextLine: line } : { kind: 'citation', citation });
        }}
      />
      <CitationDrawerContainer
        state={drawerState}
        onClose={() => {
          setDrawerState(null);
        }}
      />
    </ToastProvider>
  );
}

beforeEach(() => {
  useProposalStore.getState().reset();
  useChatStore.getState().reset();
  useToolLogStore.getState().reset();
  vi.mocked(sessionChatController.requestReview).mockClear();
  vi.mocked(sessionChatController.sendMessage).mockClear();
  vi.mocked(saveSessionFile).mockReset();
  dataMocks.getLines.mockReset();
  dataMocks.getNeighborLines.mockReset();
  dataMocks.getPriceTrend.mockReset().mockResolvedValue(null);
});

describe('ProposalPaneContainer — ต่อกับ proposalStore', () => {
  it('push version เข้า proposalStore → แสดงข้อเสนอจริง', () => {
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);
    expect(screen.getByText(realAircondProposal.title)).toBeInTheDocument();
  });

  it('ยังไม่มี version → empty state (ไม่ throw)', () => {
    render(<Harness />);
    expect(screen.getByText(t('proposal.emptyTitle'))).toBeInTheDocument();
  });

  it('แก้ qty ในตาราง BOQ → proposalStore มี version ใหม่ source "user_edit" + badge แก้โดยผู้ใช้', async () => {
    const user = userEvent.setup();
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: /แก้จำนวนของ/ }));
    const input = within(desktop).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '10{Enter}');

    const state = useProposalStore.getState();
    const current = state.versions[state.currentIndex];
    expect(current?.source).toBe('user_edit');
    expect(current?.userEditedLineIds).toContain('AC-001');
    expect(within(desktop).getByText(t('proposal.boq.editedBadge'))).toBeInTheDocument();
  });

  it('แก้ qty สำเร็จ → toast แจ้งยอดใหม่', async () => {
    const user = userEvent.setup();
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: /แก้จำนวนของ/ }));
    const input = within(desktop).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '10{Enter}');

    expect(await screen.findByText(/แก้.*แล้ว/)).toBeInTheDocument();
  });

  it('กด "ให้ AI ทบทวน" บนบรรทัดที่แก้แล้ว → เรียก sessionChatController.requestReview ด้วย lineId', async () => {
    const user = userEvent.setup();
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: /แก้จำนวนของ/ }));
    const input = within(desktop).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '10{Enter}');

    await user.click(within(desktop).getByRole('button', { name: t('proposal.reviewWithAi') }));
    expect(sessionChatController.requestReview).toHaveBeenCalledWith('AC-001');
  });

  it('กด "ส่งออก PDF" → เปิด ExportDialog', async () => {
    const user = userEvent.setup();
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    expect(screen.queryByTestId('export-dialog-stub')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('proposal.actions.exportPdf') }));
    expect(screen.getByTestId('export-dialog-stub')).toBeInTheDocument();
  });

  it('กด "บันทึกไฟล์" สำเร็จ → เรียก saveSessionFile จาก @/features/export + toast สำเร็จ', async () => {
    const user = userEvent.setup();
    vi.mocked(saveSessionFile).mockResolvedValue({ ok: true, fileName: 'test.tgbp.json' });
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: t('proposal.actions.saveJson') }));
    expect(saveSessionFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t('toast.saved'))).toBeInTheDocument();
  });

  it('กด "บันทึกไฟล์" ล้มเหลว → toast แจ้ง error (ไม่ throw ไม่ทำแอปพัง)', async () => {
    const user = userEvent.setup();
    vi.mocked(saveSessionFile).mockResolvedValue({ ok: false, error: 'ดิสก์เต็ม' });
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: t('proposal.actions.saveJson') }));
    expect(await screen.findByText(t('errors.unknown', { detail: 'ดิสก์เต็ม' }))).toBeInTheDocument();
  });
});

describe('ProposalPaneContainer × CitationDrawerContainer — คลิก citation chip', () => {
  it('คลิก citation chip ของ budget_line → drawer เปิด + loader เรียก data.getLines ด้วย shard hint จาก ToolLog', async () => {
    const user = userEvent.setup();
    const toolLog = createToolLog();
    toolLog.recordSourceShard('69457f86e9f75890', 'data/pbo/shard-2568.parquet');
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());
    dataMocks.getLines.mockResolvedValue({
      rows: [makeBudgetLine()],
      shardPaths: ['data/pbo/shard-2568.parquet'],
      rowShards: {},
      coverageNotes: [],
      droppedRows: 0,
      warnings: [],
    });

    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: /โรงเรียนโสตศึกษาจังหวัดสุรินทร์/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => {
      expect(dataMocks.getLines).toHaveBeenCalledWith(['69457f86e9f75890'], ['data/pbo/shard-2568.parquet']);
    });
    expect(await screen.findByText('เครื่องปรับอากาศแบบแยกส่วน')).toBeInTheDocument();
  });

  it('ไม่มี shard hint ใน ToolLog (เช่น citation จากไฟล์เก่า) → ไม่เรียก getLines, แสดง "ไม่พบ" แทน', async () => {
    const user = userEvent.setup();
    useToolLogStore.getState().attach(createToolLog(), createInMemoryIllustrationSink());

    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: /โรงเรียนโสตศึกษาจังหวัดสุรินทร์/ }));

    expect(await screen.findByText(t('citation.notFoundTitle'))).toBeInTheDocument();
    expect(dataMocks.getLines).not.toHaveBeenCalled();
  });

  it('citation chip resolveCitationLabel ใช้ SourceFingerprint จาก ToolLog ถ้ามี', () => {
    const toolLog = createToolLog();
    toolLog.recordSourceFingerprint?.('69457f86e9f75890', {
      amountThb: 279000,
      unitPriceThb: 279000,
      itemQty: 1,
      itemUnit: 'เครื่อง',
      fiscalYearBe: 2568,
      agency: 'กรมพลังงาน',
      ministry: null,
      itemNameRaw: 'เครื่องปรับอากาศ',
      dataset: 'pbo_disbursement',
    });
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    expect(
      within(desktop).getByText(
        t('citation.budgetLine.chip', {
          source: t('citation.types.budget_line'),
          year: 2568,
          agency: 'กรมพลังงาน',
        }),
      ),
    ).toBeInTheDocument();
  });
});

describe('CitationDrawerContainer — tool activity fallback (T-405 เดิม)', () => {
  it('เปิดจาก tool activity (ไม่มี citation เดี่ยว) → คงข้อความ fallback เดิม', () => {
    function ToolActivityHarness(): ReactElement {
      return (
        <ToastProvider>
          <CitationDrawerContainer
            state={{ kind: 'toolActivity', context: { id: 't1', name: 'query_budget_lines', label: 'ค้นหา 5 แถว' } }}
            onClose={() => {
              /* noop */
            }}
          />
        </ToastProvider>
      );
    }
    render(<ToolActivityHarness />);
    expect(screen.getByText('ค้นหา 5 แถว')).toBeInTheDocument();
  });

  it('state=null → drawer ปิดอยู่', () => {
    render(
      <ToastProvider>
        <CitationDrawerContainer state={null} onClose={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ProposalPaneContainer — renderIllustration ผ่าน sanitizer', () => {
  it('SVG อันตราย (foreignObject) จาก IllustrationSink → fallback ไม่ mount SVG ใด ๆ', () => {
    const sink = createInMemoryIllustrationSink();
    sink.add({
      illustrationId: 'ill-1',
      title: richProposalFixture.illustrations[0]?.title ?? '',
      caption: richProposalFixture.illustrations[0]?.caption ?? '',
      kind: 'cross_section',
      svg: readSvgFixture('03-foreignObject.svg'),
      warnings: [],
    });
    useToolLogStore.getState().attach(createToolLog(), sink);
    useProposalStore.getState().pushVersion(richProposalFixture, [], 'ai');

    render(<Harness />);

    expect(screen.queryByTestId('illustration-svg-mount')).not.toBeInTheDocument();
    expect(document.querySelector('foreignObject')).toBeNull();
    expect(screen.getByText(/ไม่ผ่านการตรวจความปลอดภัย/)).toBeInTheDocument();
  });

  it('ไม่มี SVG ใน sink สำหรับ illustration_id นั้น (เช่นโหลดจากไฟล์เก่า) → ไม่ render/ไม่ throw', () => {
    useToolLogStore.getState().attach(createToolLog(), createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(richProposalFixture, [], 'ai');

    render(<Harness />);
    expect(screen.queryByTestId('illustration-svg-mount')).not.toBeInTheDocument();
  });

  describe('S9 (po-review ชุด B, US-7.1): ซ่อน/แสดง/สร้างภาพใหม่', () => {
    function attachGoodIllustration(): void {
      const sink = createInMemoryIllustrationSink();
      sink.add({
        illustrationId: richProposalFixture.illustrations[0]?.illustration_id ?? '',
        title: richProposalFixture.illustrations[0]?.title ?? '',
        caption: richProposalFixture.illustrations[0]?.caption ?? '',
        kind: 'cross_section',
        svg: readGoodIllustration('02-cross-section-weir.svg'),
        warnings: [],
      });
      useToolLogStore.getState().attach(createToolLog(), sink);
    }

    it('กด "ซ่อนภาพ" → ภาพหาย + ปุ่ม "แสดงภาพ" กด "แสดงภาพ" → ภาพกลับมา', async () => {
      const user = userEvent.setup();
      attachGoodIllustration();
      useProposalStore.getState().pushVersion(richProposalFixture, [], 'ai');
      render(<Harness />);

      expect(screen.getByTestId('illustration-svg-mount')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: t('proposal.illustration.hide') }));
      expect(screen.queryByTestId('illustration-svg-mount')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: t('proposal.illustration.show') }));
      expect(screen.getByTestId('illustration-svg-mount')).toBeInTheDocument();
    });

    it('กด "สร้างภาพใหม่" → เรียก sessionChatController.sendMessage ด้วยข้อความขอภาพใหม่จาก copy', async () => {
      const user = userEvent.setup();
      attachGoodIllustration();
      useProposalStore.getState().pushVersion(richProposalFixture, [], 'ai');
      render(<Harness />);

      await user.click(screen.getByRole('button', { name: t('proposal.illustration.regenerate') }));
      expect(sessionChatController.sendMessage).toHaveBeenCalledWith(
        t('proposal.illustration.regenerateRequest', {
          title: richProposalFixture.illustrations[0]?.title ?? '',
        }),
      );
    });

    it('AI กำลังรัน (isRunning) → ไม่มีปุ่ม "สร้างภาพใหม่"', () => {
      attachGoodIllustration();
      useProposalStore.getState().pushVersion(richProposalFixture, [], 'ai');
      useChatStore.getState().setIsRunning(true);
      render(<Harness />);

      expect(
        screen.queryByRole('button', { name: t('proposal.illustration.regenerate') }),
      ).not.toBeInTheDocument();
    });
  });
});

describe('M2 (po-review ชุด B): badge "อ้างอิงไม่พบ" ต่อกับ ToolLog จริง', () => {
  it('source_id ไม่เคยปรากฏใน ToolLog ของบทสนทนานี้ → CitationChip แสดงป้าย "อ้างอิงไม่พบ"', () => {
    // ToolLog ว่างเปล่า (ไม่เคย record source_id ของ B-1 เลย) — เหมือน citation ที่หลุดรอดมาโดยไม่เคยเห็นจริง
    useToolLogStore.getState().attach(createToolLog(), createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    expect(within(desktop).getAllByText(new RegExp(t('proposal.citationUnresolved'))).length).toBeGreaterThan(0);
  });

  it('source_id เคย record ไว้ใน ToolLog → ไม่แสดงป้าย "อ้างอิงไม่พบ"', () => {
    const toolLog = createToolLog();
    // fixture จริงอ้าง budget_line 2 แถว — ต้อง record ครบทุกตัว ไม่งั้นตัวที่เหลือก็ควรขึ้นป้าย (ถูกต้องแล้ว)
    for (const line of realAircondProposal.boq) {
      for (const citation of line.citations) {
        if (citation.kind === 'budget_line') toolLog.recordSourceId(citation.source_id);
      }
    }
    useToolLogStore.getState().attach(toolLog, createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(realAircondProposal, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    expect(within(desktop).queryByText(new RegExp(t('proposal.citationUnresolved')))).not.toBeInTheDocument();
  });
});

describe('S10 (po-review ชุด B, US-4.3): "ไม่เอาราคานี้" ของ web citation', () => {
  it('กด "ไม่เอาราคานี้" → เรียก sessionChatController.sendMessage + toast ยืนยันด้วยชื่อโดเมน', async () => {
    const user = userEvent.setup();
    useToolLogStore.getState().attach(createToolLog(), createInMemoryIllustrationSink());
    useProposalStore.getState().pushVersion(richProposalFixture, [], 'ai');
    render(<Harness />);

    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: t('citation.drawerTitle') }));

    await user.click(await screen.findByRole('button', { name: t('citation.web.reject') }));

    expect(sessionChatController.sendMessage).toHaveBeenCalledWith(
      t('citation.web.rejectRequest', { url: 'https://shopee.co.th/เหล็กเส้น-DB12-SD40' }),
    );
    expect(await screen.findByText(t('toast.citationRejected', { domain: 'shopee.co.th' }))).toBeInTheDocument();
  });
});
