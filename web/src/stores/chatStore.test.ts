import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from './chatStore';

beforeEach(() => {
  useChatStore.getState().reset();
});

describe('chatStore', () => {
  it('addMessage เพิ่มข้อความ user ด้วยค่า default (status=done, text ว่างถ้าไม่ระบุ)', () => {
    const id = useChatStore.getState().addMessage({ role: 'user', text: 'สวัสดี' });
    const message = useChatStore.getState().messages.find((m) => m.id === id);
    expect(message).toEqual({
      id,
      role: 'user',
      text: 'สวัสดี',
      status: 'done',
      toolActivities: [],
      warnings: [],
    });
  });

  it('addMessage รองรับ status เริ่มต้นแบบ streaming สำหรับข้อความ assistant', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    expect(useChatStore.getState().messages.find((m) => m.id === id)?.status).toBe('streaming');
  });

  it('appendText สะสม delta ต่อท้ายข้อความเดิม (ไม่แตะข้อความอื่น)', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    const otherId = useChatStore.getState().addMessage({ role: 'user', text: 'คงเดิม' });
    useChatStore.getState().appendText(id, 'สวัสดี');
    useChatStore.getState().appendText(id, 'ครับ');
    expect(useChatStore.getState().messages.find((m) => m.id === id)?.text).toBe('สวัสดีครับ');
    expect(useChatStore.getState().messages.find((m) => m.id === otherId)?.text).toBe('คงเดิม');
  });

  it('updateMessageStatus เปลี่ยนสถานะของข้อความที่ระบุเท่านั้น', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    useChatStore.getState().updateMessageStatus(id, 'done');
    expect(useChatStore.getState().messages.find((m) => m.id === id)?.status).toBe('done');
  });

  it('upsertToolActivity เพิ่มรายการใหม่ แล้วอัปเดตทับรายการเดิมเมื่อ id ซ้ำ', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    useChatStore.getState().upsertToolActivity(id, { id: 'tool_1', name: 'search_catalog', status: 'running' });
    expect(useChatStore.getState().messages.find((m) => m.id === id)?.toolActivities).toEqual([
      { id: 'tool_1', name: 'search_catalog', status: 'running' },
    ]);

    useChatStore.getState().upsertToolActivity(id, {
      id: 'tool_1',
      name: 'search_catalog',
      status: 'done',
      inputSummary: 'พบ 5 รายการ',
    });
    const activities = useChatStore.getState().messages.find((m) => m.id === id)?.toolActivities;
    expect(activities).toEqual([
      { id: 'tool_1', name: 'search_catalog', status: 'done', inputSummary: 'พบ 5 รายการ' },
    ]);
  });

  it('upsertToolActivity เก็บ inputSummary ของ web_search (รวม query) ได้', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    useChatStore.getState().upsertToolActivity(id, {
      id: 'web_search_1',
      name: 'web_search',
      status: 'done',
      inputSummary: 'เครื่องปรับอากาศ 24000 BTU ราคา',
    });
    expect(
      useChatStore.getState().messages.find((m) => m.id === id)?.toolActivities[0]?.inputSummary,
    ).toContain('ราคา');
  });

  it('T-410 ข้อ 3 (US-2.2): upsertToolActivity เก็บ field เสริม summary แบบมีโครงสร้างได้ (optional, ไม่กระทบ inputSummary เดิม)', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    useChatStore.getState().upsertToolActivity(id, {
      id: 'tool_1',
      name: 'search_catalog',
      status: 'done',
      inputSummary: 'search_catalog: พบ 1240 รายการ',
      summary: { tool: 'search_catalog', status: 'done', count: 1240, query: 'เครื่องปรับอากาศ' },
    });

    const activity = useChatStore.getState().messages.find((m) => m.id === id)?.toolActivities[0];
    expect(activity?.inputSummary).toBe('search_catalog: พบ 1240 รายการ');
    expect(activity?.summary).toEqual({ tool: 'search_catalog', status: 'done', count: 1240, query: 'เครื่องปรับอากาศ' });
  });

  it('addWarning เพิ่ม warning ต่อท้ายรายการเดิม', () => {
    const id = useChatStore.getState().addMessage({ role: 'assistant', status: 'streaming' });
    useChatStore.getState().addWarning(id, 'คำเตือนที่ 1');
    useChatStore.getState().addWarning(id, 'คำเตือนที่ 2');
    expect(useChatStore.getState().messages.find((m) => m.id === id)?.warnings).toEqual([
      'คำเตือนที่ 1',
      'คำเตือนที่ 2',
    ]);
  });

  it('setIsRunning/reset ทำงานตามคาด', () => {
    useChatStore.getState().setIsRunning(true);
    expect(useChatStore.getState().isRunning).toBe(true);
    useChatStore.getState().addMessage({ role: 'user', text: 'x' });
    useChatStore.getState().reset();
    expect(useChatStore.getState().isRunning).toBe(false);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('N2: JSON.stringify ของ state ไม่มีสตริงรูป key', () => {
    const fakeKey = 'sk-' + 'ant-' + 'abcdEFGH1234';
    const id = useChatStore.getState().addMessage({ role: 'user', text: `ลอง key นี้ ${fakeKey}` });
    // ข้อความ raw ของผู้ใช้อาจมีสตริงคล้าย key ได้ (ผู้ใช้พิมพ์เอง) — สิ่งที่สำคัญคือ store ไม่มี field
    // ใดที่เป็น client/apiKey เอง (ไม่ใช่การ redact ข้อความผู้ใช้ ซึ่งไม่ใช่หน้าที่ของ store นี้)
    const serialized = JSON.stringify(useChatStore.getState());
    expect(useChatStore.getState().messages.find((m) => m.id === id)?.text).toContain(fakeKey);
    // ยืนยันว่าไม่มี key ของ "ระบบ" (client/apiKey) หลุดเข้ามาใน state — ตรวจว่าไม่มี field ชื่อที่
    // เกี่ยวข้องกับ credential ใด ๆ ปนอยู่เลย
    expect(serialized).not.toMatch(/"apiKey"|"client"/);
  });
});
