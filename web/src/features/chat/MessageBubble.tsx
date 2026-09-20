import type { ReactElement } from 'react';
import { Button } from '@/components/ui';
import { FadeSlideIn } from '@/components/motion';
import { t } from '@/i18n';
import type { ChatMessage } from '@/stores/chatStore';
import { ToolActivityCard } from './ToolActivityCard';

export interface MessageBubbleContext {
  id: string;
  name: string;
  label: string;
}

export interface MessageBubbleProps {
  message: ChatMessage;
  onViewToolResults?: ((ctx: MessageBubbleContext) => void) | undefined;
  /** ปุ่ม "ให้ตอบใหม่" — ผู้เรียก (ChatPane) ตัดสินใจว่าจะส่งอะไรซ้ำ (ปกติคือข้อความ user ล่าสุด) */
  onRetry?: (() => void) | undefined;
}

/**
 * T-405 — ข้อความ 1 รายการในแชท
 *
 * N9/T-307 (บังคับทั้ง repo): `message.text` เป็นข้อมูลจากโมเดล — render เป็น **text node เท่านั้น**
 * (children ของ JSX ธรรมดา) ห้าม parse เป็น HTML/markdown→HTML และห้าม `dangerouslySetInnerHTML`
 * เด็ดขาด แม้เนื้อหาจะมีอักขระ `<`/`>` ที่ดูเหมือน HTML tag (เช่น payload ทดสอบ
 * `<img src=x onerror=...>`) React จะ escape ให้เป็นตัวอักษรธรรมดาเสมอเมื่อ render แบบนี้
 */
export function MessageBubble({ message, onViewToolResults, onRetry }: MessageBubbleProps): ReactElement {
  const isUser = message.role === 'user';
  const roleLabel = isUser ? t('chat.you') : t('chat.assistant');
  const showPlaceholder = message.text.length === 0 && message.status === 'streaming';

  return (
    // motion.md #6: ข้อความแชทใหม่ fade+slide-up ตอนเข้ามาครั้งแรก (`FadeSlideIn` เล่นแค่ตอน mount —
    // ไม่ replay ทุกครั้งที่ token สตรีมเข้ามาอัปเดต เพราะ React ใช้ instance เดิมของ component นี้ต่อ
    // `message.id` เดียวกันเสมอ ดู `ChatPane` ที่ใช้ `key={message.id}`)
    <FadeSlideIn>
      <article className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        <span className="text-xs font-medium text-fg-muted">{roleLabel}</span>
        <div
          className={`max-w-[85%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm ${
            isUser ? 'bg-primary text-primary-contrast' : 'bg-surface-2 text-fg'
          }`}
        >
          {showPlaceholder ? t('chat.thinking') : message.text}
          {message.status === 'streaming' && (
            <span aria-hidden="true" className="ml-0.5 inline-block animate-pulse">
              ▌
            </span>
          )}
        </div>

        {message.toolActivities.length > 0 && (
          <div className="flex w-full max-w-[85%] flex-col gap-2">
            {message.toolActivities.map((activity) => (
              <ToolActivityCard
                key={activity.id}
                activity={activity}
                onViewResults={
                  onViewToolResults
                    ? () => {
                        onViewToolResults({
                          id: activity.id,
                          name: activity.name,
                          label: activity.inputSummary ?? activity.name,
                        });
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {message.warnings.length > 0 && (
          <div className="flex w-full max-w-[85%] flex-col gap-1">
            {message.warnings.map((warning, index) => (
              <p
                key={`${message.id}-warning-${String(index)}`}
                role="alert"
                className="rounded-sm border-l-4 border-warn bg-surface-2 px-3 py-2 text-sm text-fg"
              >
                {warning}
              </p>
            ))}
          </div>
        )}

        {message.status === 'cancelled' && <p className="text-sm text-fg-muted">{t('errors.cancelled')}</p>}

        {message.status === 'error' && onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('chat.regenerate')}
          </Button>
        )}
      </article>
    </FadeSlideIn>
  );
}
