import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { richProposalFixture } from './__fixtures__/proposal.fixture';
import { BoqTable } from './BoqTable';

describe('BoqTable', () => {
  it('render ทุกบรรทัดของ BOQ (desktop table)', () => {
    render(
      <BoqTable
        proposal={richProposalFixture}
        editedLineIds={[]}
        onEditLine={vi.fn()}
        onRequestReview={vi.fn()}
        onOpenCitation={vi.fn()}
      />,
    );
    const desktop = screen.getByTestId('boq-table-desktop');
    expect(within(desktop).getByText('คอนกรีตผสมเสร็จ 240 ksc')).toBeInTheDocument();
    // "เหล็กเส้น DB12 SD40" ปรากฏสองครั้งในแถวเดียวกัน (ชื่อรายการ + label ของ citation เว็บที่ชื่อเดียวกัน)
    expect(within(desktop).getAllByText('เหล็กเส้น DB12 SD40').length).toBeGreaterThan(0);
    expect(within(desktop).getByText('ค่าขนส่งวัสดุ')).toBeInTheDocument();
  });

  it('แสดงยอดรวมของแต่ละบรรทัดด้วยตัวคั่นหลักพันแบบไทย', () => {
    render(
      <BoqTable
        proposal={richProposalFixture}
        editedLineIds={[]}
        onEditLine={vi.fn()}
        onRequestReview={vi.fn()}
        onOpenCitation={vi.fn()}
      />,
    );
    const desktop = screen.getByTestId('boq-table-desktop');
    expect(within(desktop).getByText('199,750')).toBeInTheDocument();
    expect(within(desktop).getByText('104,580')).toBeInTheDocument();
  });

  it('แสดง subtotal ต่อหมวด (group by category)', () => {
    render(
      <BoqTable
        proposal={richProposalFixture}
        editedLineIds={[]}
        onEditLine={vi.fn()}
        onRequestReview={vi.fn()}
        onOpenCitation={vi.fn()}
      />,
    );
    const desktop = screen.getByTestId('boq-table-desktop');
    // งานโครงสร้าง = 199750 + 104580 = 304330
    expect(within(desktop).getByText('304,330')).toBeInTheDocument();
  });

  it('บรรทัดที่แก้แล้วมีป้าย "แก้โดยผู้ใช้" และปุ่ม "ให้ AI ทบทวน"', () => {
    render(
      <BoqTable
        proposal={richProposalFixture}
        editedLineIds={['B-2']}
        onEditLine={vi.fn()}
        onRequestReview={vi.fn()}
        onOpenCitation={vi.fn()}
      />,
    );
    const desktop = screen.getByTestId('boq-table-desktop');
    expect(within(desktop).getByText('แก้โดยผู้ใช้')).toBeInTheDocument();
    expect(within(desktop).getByRole('button', { name: 'ให้ AI ทบทวน' })).toBeInTheDocument();
  });

  it('คลิกปุ่ม "ให้ AI ทบทวน" ของแถวเรียก onRequestReview ด้วย lineId', async () => {
    const user = userEvent.setup();
    const onRequestReview = vi.fn();
    render(
      <BoqTable
        proposal={richProposalFixture}
        editedLineIds={['B-2']}
        onEditLine={vi.fn()}
        onRequestReview={onRequestReview}
        onOpenCitation={vi.fn()}
      />,
    );
    const desktop = screen.getByTestId('boq-table-desktop');
    await user.click(within(desktop).getByRole('button', { name: 'ให้ AI ทบทวน' }));
    expect(onRequestReview).toHaveBeenCalledWith('B-2');
  });

  describe('inline edit', () => {
    it('คลิกค่า qty เข้าโหมดแก้ → Enter ยืนยัน → เรียก onEditLine', async () => {
      const user = userEvent.setup();
      const onEditLine = vi.fn();
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={onEditLine}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      const qtyButton = within(desktop).getByRole('button', {
        name: 'แก้จำนวนของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.click(qtyButton);
      const input = within(desktop).getByRole('textbox', {
        name: 'แก้จำนวนของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.clear(input);
      await user.type(input, '100{Enter}');
      expect(onEditLine).toHaveBeenCalledWith('B-1', { qty: 100 });
    });

    it('Esc ยกเลิกโดยไม่เรียก onEditLine', async () => {
      const user = userEvent.setup();
      const onEditLine = vi.fn();
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={onEditLine}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      const qtyButton = within(desktop).getByRole('button', {
        name: 'แก้จำนวนของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.click(qtyButton);
      const input = within(desktop).getByRole('textbox', {
        name: 'แก้จำนวนของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.clear(input);
      await user.type(input, '999{Escape}');
      expect(onEditLine).not.toHaveBeenCalled();
      // กลับไปแสดงค่าเดิม (85) ในโหมดดู
      expect(
        within(desktop).getByRole('button', { name: 'แก้จำนวนของ คอนกรีตผสมเสร็จ 240 ksc' }),
      ).toHaveTextContent('85');
    });

    it('ใส่ค่า 0 → แสดง error inline และไม่เรียก onEditLine', async () => {
      const user = userEvent.setup();
      const onEditLine = vi.fn();
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={onEditLine}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      const qtyButton = within(desktop).getByRole('button', {
        name: 'แก้จำนวนของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.click(qtyButton);
      const input = within(desktop).getByRole('textbox', {
        name: 'แก้จำนวนของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.clear(input);
      await user.type(input, '0{Enter}');
      expect(onEditLine).not.toHaveBeenCalled();
      expect(screen.getByText('ใส่ตัวเลขที่มากกว่า 0')).toBeInTheDocument();
    });

    it('แก้ราคาต่อหน่วยได้เช่นกัน', async () => {
      const user = userEvent.setup();
      const onEditLine = vi.fn();
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={onEditLine}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      const priceButton = within(desktop).getByRole('button', {
        name: 'แก้ราคาต่อหน่วยของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.click(priceButton);
      const input = within(desktop).getByRole('textbox', {
        name: 'แก้ราคาต่อหน่วยของ คอนกรีตผสมเสร็จ 240 ksc',
      });
      await user.clear(input);
      await user.type(input, '2500{Enter}');
      expect(onEditLine).toHaveBeenCalledWith('B-1', { unit_price_thb: 2500 });
    });
  });

  describe('citations', () => {
    it('คลิก citation ของ budget_line เรียก onOpenCitation ด้วย citation และ line ที่ถูกต้อง', async () => {
      const user = userEvent.setup();
      const onOpenCitation = vi.fn();
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={vi.fn()}
          onRequestReview={vi.fn()}
          onOpenCitation={onOpenCitation}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      await user.click(within(desktop).getByRole('button', { name: /กรมชลประทาน ปี 2566/ }));
      expect(onOpenCitation).toHaveBeenCalledTimes(1);
      const [citation, line] = onOpenCitation.mock.calls[0] as [unknown, unknown];
      expect(citation).toEqual({
        kind: 'budget_line',
        source_id: 'bl_concrete_001',
        note: 'กรมชลประทาน ปี 2566',
      });
      expect((line as { id: string }).id).toBe('B-1');
    });

    it('citation เว็บเปิดเป็นลิงก์ https ในแท็บใหม่ + ปุ่มเล็กเปิด drawer แยกกัน', async () => {
      const user = userEvent.setup();
      const onOpenCitation = vi.fn();
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={vi.fn()}
          onRequestReview={vi.fn()}
          onOpenCitation={onOpenCitation}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      const link = within(desktop).getByRole('link', { name: /เหล็กเส้น DB12 SD40/ });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // `ExternalLink` ผ่าน `new URL(...).href` ซึ่ง encode อักขระไทยเป็น percent-encoding — ตรวจแค่ scheme
      expect(link.getAttribute('href')).toMatch(/^https:\/\/shopee\.co\.th\//);

      const drawerButton = within(desktop).getByRole('button', { name: 'ที่มาของตัวเลข' });
      await user.click(drawerButton);
      expect(onOpenCitation).toHaveBeenCalledTimes(1);
    });

    it('บรรทัดที่ไม่มี citation แสดง "—" แทนรายการว่าง', () => {
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={vi.fn()}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      const row = within(desktop).getByText('ค่าขนส่งวัสดุ').closest('tr');
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText('—')).toBeInTheDocument();
    });
  });

  describe('ⓘ เหตุผล', () => {
    it('เปิด popover แสดง rationale เต็มของบรรทัด', async () => {
      const user = userEvent.setup();
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={vi.fn()}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
        />,
      );
      const desktop = screen.getByTestId('boq-table-desktop');
      const [itemCell] = within(desktop).getAllByText('เหล็กเส้น DB12 SD40');
      if (!itemCell) throw new Error('ไม่พบข้อความ "เหล็กเส้น DB12 SD40" ในตาราง');
      const row = itemCell.closest('tr') as HTMLElement;
      // แถวนี้มี "ⓘ" สองปุ่ม (popover เหตุผล + ปุ่มเปิด drawer ของ citation เว็บ) — ตัวแรกตามลำดับ DOM
      // คือปุ่ม popover เหตุผล (คอลัมน์ "เหตุผล" มาก่อนคอลัมน์ "อ้างอิง")
      const [reasonPopoverTrigger] = within(row).getAllByText('ⓘ');
      if (!reasonPopoverTrigger) throw new Error('ไม่พบปุ่ม popover เหตุผล');
      await user.click(reasonPopoverTrigger);
      expect(
        screen.getByText('ราคาตลาดปัจจุบันจากร้านค้าออนไลน์ที่ขายส่งเหล็กเส้นมาตรฐาน SD40'),
      ).toBeInTheDocument();
      // price_derivation ต้องโผล่ใน popover ด้วย (N3)
      expect(screen.getByText(/construction_material_price_index/)).toBeInTheDocument();
    });
  });

  describe('trend slot', () => {
    it('renderTrend ถูกเรียกด้วย trend_ref ของบรรทัดที่มี', () => {
      const renderTrend = vi.fn(() => <span>trend-mock</span>);
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={vi.fn()}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
          renderTrend={renderTrend}
        />,
      );
      expect(renderTrend).toHaveBeenCalledWith({ kind: 'item', key: 'concrete_240ksc' });
    });

    it('ไม่มี trend_ref → แสดงข้อความไม่มีข้อมูลแนวโน้ม', () => {
      render(
        <BoqTable
          proposal={richProposalFixture}
          editedLineIds={[]}
          onEditLine={vi.fn()}
          onRequestReview={vi.fn()}
          onOpenCitation={vi.fn()}
        />,
      );
      expect(screen.getAllByText('ไม่มีข้อมูลแนวโน้มของรายการนี้').length).toBeGreaterThan(0);
    });
  });

  it('proposal.boq ว่าง → แสดง empty state', () => {
    render(
      <BoqTable
        proposal={{ ...richProposalFixture, boq: [] }}
        editedLineIds={[]}
        onEditLine={vi.fn()}
        onRequestReview={vi.fn()}
        onOpenCitation={vi.fn()}
      />,
    );
    expect(screen.getByText('ยังไม่มีรายการค่าใช้จ่าย')).toBeInTheDocument();
  });

  it('ข้อความจากโมเดลที่มี markup อันตราย render เป็น text เฉย ๆ (ไม่มี element จริง)', () => {
    const [firstLine] = richProposalFixture.boq;
    if (!firstLine) throw new Error('fixture ต้องมีอย่างน้อยหนึ่งบรรทัด');
    const malicious = {
      ...richProposalFixture,
      boq: [
        {
          ...firstLine,
          item: '<img src=x onerror=alert(1)>',
          rationale: '<script>alert(1)</script>เหตุผลปลอม',
        },
      ],
    };
    const { container } = render(
      <BoqTable
        proposal={malicious}
        editedLineIds={[]}
        onEditLine={vi.fn()}
        onRequestReview={vi.fn()}
        onOpenCitation={vi.fn()}
      />,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
  });
});
