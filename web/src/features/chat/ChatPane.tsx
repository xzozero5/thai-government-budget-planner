import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { sessionChatController } from '@/ai/session/chatController';
import { t } from '@/i18n';
import { useChatStore, type ChatMessageStatus } from '@/stores/chatStore';
import { useSessionStore } from '@/stores/sessionStore';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { MessageBubble, type MessageBubbleContext } from './MessageBubble';
import { ModeToggle } from './ModeToggle';
import { QuickReplies } from './QuickReplies';

export interface ChatPaneProps {
  /** เปิด citation drawer แสดงผลลัพธ์ของ tool call (T-407 ยังไม่เสร็จ — main thread ต่อ slot จริงทีหลัง) */
  onOpenToolResults?: ((ctx: MessageBubbleContext) => void) | undefined;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

/**
 * T-405 — Chat pane (06 §4.2): รายการข้อความ + streaming + tool activity + quick replies + composer
 *
 * Keyboard shortcuts (06 §4.6): `/` โฟกัส composer (เมื่อไม่ได้พิมพ์อยู่ในช่องอื่น), `Esc` ยกเลิก turn ที่
 * กำลังรัน, `Ctrl/Cmd+Enter` ส่งข้อความ (เมื่อโฟกัสอยู่ที่ composer) — ใช้ ref เก็บค่าล่าสุดแทนการใส่ลง
 * dependency array เพื่อไม่ต้อง add/remove listener ทุกครั้งที่พิมพ์ (motion.md #6: throttle การอัปเดต)
 */
export function ChatPane({ onOpenToolResults }: ChatPaneProps): ReactElement {
  const messages = useChatStore((s) => s.messages);
  const isRunning = useChatStore((s) => s.isRunning);
  const mode = useSessionStore((s) => s.mode);

  const [draft, setDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevStatusRef = useRef<Map<string, ChatMessageStatus>>(new Map());

  function handleSend(): void {
    const text = draft.trim();
    if (text.length === 0 || isRunning) {
      return;
    }
    setDraft('');
    isAtBottomRef.current = true;
    void sessionChatController.sendMessage(text);
  }

  function handleCancel(): void {
    sessionChatController.cancel();
  }

  function handleRetryLastUserMessage(): void {
    if (isRunning) {
      return;
    }
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      void sessionChatController.sendMessage(lastUser.text);
    }
  }

  // เก็บค่าล่าสุดไว้ให้ global keydown listener อ่าน (ลงทะเบียนครั้งเดียว — ดู docstring ด้านบน)
  const latestRef = useRef({ handleSend, handleCancel, isRunning });
  latestRef.current = { handleSend, handleCancel, isRunning };

  // aria-live=polite ประกาศ "ครั้งเดียวตอนจบ" ไม่อ่านทุก token ระหว่างสตรีม (06 §6, motion.md #6)
  useEffect(() => {
    for (const message of messages) {
      const prevStatus = prevStatusRef.current.get(message.id);
      if (prevStatus === 'streaming' && message.status !== 'streaming') {
        setAnnouncement(message.text.length > 0 ? message.text : t('chat.thinking'));
      }
      prevStatusRef.current.set(message.id, message.status);
    }
  }, [messages]);

  // auto-scroll เฉพาะเมื่อผู้ใช้อยู่ท้ายรายการอยู่แล้ว (06 §4.2)
  useEffect(() => {
    const el = listRef.current;
    if (el && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      const isEditable =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === '/' && !isEditable) {
        event.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && latestRef.current.isRunning) {
        latestRef.current.handleCancel();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && target === textareaRef.current) {
        event.preventDefault();
        latestRef.current.handleSend();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  function handleScroll(): void {
    const el = listRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX;
  }

  function handlePickExample(text: string): void {
    setDraft(text);
    textareaRef.current?.focus();
  }

  function handleQuickReply(text: string): void {
    if (isRunning) {
      return;
    }
    isAtBottomRef.current = true;
    void sessionChatController.sendMessage(text);
  }

  const lastMessage = messages[messages.length - 1];
  const showQuickReplies = !isRunning && lastMessage?.role === 'assistant' && lastMessage.status === 'done';

  return (
    <section aria-label={t('a11y.chatRegion')} className="flex h-full min-h-0 flex-col">
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
      <div
        ref={listRef}
        onScroll={handleScroll}
        aria-label={t('a11y.chatLog')}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <EmptyState onPickExample={handlePickExample} />
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onViewToolResults={onOpenToolResults}
              onRetry={message.status === 'error' ? handleRetryLastUserMessage : undefined}
            />
          ))
        )}
      </div>
      {showQuickReplies && <QuickReplies onPick={handleQuickReply} />}
      <ModeToggle />
      <Composer
        ref={textareaRef}
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onCancel={handleCancel}
        isRunning={isRunning}
        placeholder={mode === 'audit' ? t('chat.placeholderAudit') : t('chat.placeholder')}
      />
    </section>
  );
}
