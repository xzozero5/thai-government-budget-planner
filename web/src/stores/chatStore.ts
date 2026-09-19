/**
 * T-403 — `chatStore`: ข้อความแชทสำหรับ UI เท่านั้น (04 §D7 slice `chat`)
 *
 * N2/09 §1: ไม่มี `persist`/`devtools` middleware ใด ๆ ในไฟล์นี้ — ข้อความหายเมื่อปิด/รีเฟรชแท็บ
 * (ตั้งใจ) ประวัติที่ใช้เรียก Anthropic API จริง (`Anthropic.MessageParam[]`) ไม่ได้อยู่ใน store นี้
 * (อยู่ใน closure ของ `ai/session/chatController.ts`) — store นี้ถือแค่รูปแบบที่ UI render เท่านั้น
 * (ไม่มี field ใดที่มาจาก/อ้างถึง Anthropic client หรือ key)
 *
 * ห้าม import React (module boundary) — ใช้ hook ที่ zustand ให้มาตรง ๆ จาก component
 */
import { create } from 'zustand';
import { createId } from './id';

export type ChatRole = 'user' | 'assistant';
export type ChatMessageStatus = 'streaming' | 'done' | 'error' | 'cancelled';
export type ToolActivityStatus = 'running' | 'done' | 'error';

/** สถานะการเรียกเครื่องมือ 1 รายการ (client tool หรือ server tool `web_search`) — `inputSummary`
 * รวม query ของ `web_search` ด้วย (T-307 §9 ข้อ 6: "web_search โปร่งใส — แสดง query ทุกครั้ง") */
export interface ToolActivity {
  id: string;
  name: string;
  status: ToolActivityStatus;
  inputSummary?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** ข้อความที่ stream เข้ามาทีละ delta (เริ่มว่างสำหรับข้อความ assistant ที่กำลังพิมพ์) */
  text: string;
  status: ChatMessageStatus;
  toolActivities: ToolActivity[];
  warnings: string[];
}

export interface NewChatMessageInput {
  role: ChatRole;
  text?: string;
  status?: ChatMessageStatus;
}

export interface ChatStoreState {
  messages: ChatMessage[];
  isRunning: boolean;

  /** เพิ่มข้อความใหม่ต่อท้าย — คืน id ที่สร้างให้ (ใช้ต่อกับ `appendText`/`upsertToolActivity` ทันที) */
  addMessage: (input: NewChatMessageInput) => string;
  appendText: (id: string, delta: string) => void;
  updateMessageStatus: (id: string, status: ChatMessageStatus) => void;
  /** เพิ่ม/แทนที่ tool activity ตาม `activity.id` (id เดียวกับ `tool_use_id`/id สังเคราะห์ของ web_search) */
  upsertToolActivity: (messageId: string, activity: ToolActivity) => void;
  addWarning: (messageId: string, warning: string) => void;
  setIsRunning: (running: boolean) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStoreState>((set) => ({
  messages: [],
  isRunning: false,

  addMessage(input) {
    const id = createId('msg');
    const message: ChatMessage = {
      id,
      role: input.role,
      text: input.text ?? '',
      status: input.status ?? 'done',
      toolActivities: [],
      warnings: [],
    };
    set((state) => ({ messages: [...state.messages, message] }));
    return id;
  },

  appendText(id, delta) {
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)),
    }));
  },

  updateMessageStatus(id, status) {
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, status } : m)),
    }));
  },

  upsertToolActivity(messageId, activity) {
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== messageId) {
          return m;
        }
        const exists = m.toolActivities.some((a) => a.id === activity.id);
        const toolActivities = exists
          ? m.toolActivities.map((a) => (a.id === activity.id ? activity : a))
          : [...m.toolActivities, activity];
        return { ...m, toolActivities };
      }),
    }));
  },

  addWarning(messageId, warning) {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, warnings: [...m.warnings, warning] } : m,
      ),
    }));
  },

  setIsRunning(running) {
    set({ isRunning: running });
  },

  reset() {
    set({ messages: [], isRunning: false });
  },
}));
