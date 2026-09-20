import type { ReactElement } from 'react';
import { Button, Spinner } from '@/components/ui';
import { t } from '@/i18n';
import type { ToolActivity } from '@/stores/chatStore';
import { renderToolTemplate } from './toolCopy';
import { isKnownToolName, RUNNING_KEY } from './toolNames';

export interface ToolActivityCardProps {
  activity: ToolActivity;
  /** เปิด citation drawer แสดงผลลัพธ์ (≤ 50 แถว) — `undefined` เมื่อยังไม่มีที่ให้เปิด (T-407 ยังไม่เสร็จ) */
  onViewResults?: (() => void) | undefined;
}

function messageFor(activity: ToolActivity): string {
  const { name, status, inputSummary } = activity;

  // T-307: web_search ต้องแสดง query ทุกครั้ง — `inputSummary` ของ web_search คือ query ดิบ (ดู
  // `ai/session/chatController.ts#handleAgentEvent` case 'server_tool') ไม่ใช่ประโยคสำเร็จรูปแบบ tool อื่น
  if (name === 'web_search') {
    return renderToolTemplate('chat.tool.web_search.running', { query: inputSummary ?? '' });
  }

  if (status === 'running') {
    const key = isKnownToolName(name) ? RUNNING_KEY[name] : undefined;
    return key ? renderToolTemplate(key) : t('chat.thinking');
  }

  // done/error: `ai/agent.ts#summarizeToolResult` เตรียมประโยคไทยพร้อมใช้มาให้แล้วใน `inputSummary`
  return inputSummary ?? (status === 'error' ? t('errors.toolFailed', { tool: name }) : t('common.loading'));
}

function StatusIcon({ status }: { status: ToolActivity['status'] }): ReactElement {
  if (status === 'running') {
    return <Spinner size="sm" label={t('a11y.spinner')} />;
  }
  if (status === 'error') {
    return (
      <span aria-hidden="true" className="text-base font-bold leading-none text-danger">
        !
      </span>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 text-success"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** การ์ดกิจกรรม tool ต่อ 1 การเรียก (06 §7 #25) — ต้องบอกว่าค้นอะไร/ได้กี่แถวทุกครั้ง (โปร่งใส N3/T-307) */
export function ToolActivityCard({ activity, onViewResults }: ToolActivityCardProps): ReactElement {
  const isWebSearch = activity.name === 'web_search';
  const canViewResults = !isWebSearch && activity.status === 'done' && onViewResults !== undefined;

  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-surface-2 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <StatusIcon status={activity.status} />
        </span>
        <span className={activity.status === 'error' ? 'text-danger' : 'text-fg'}>{messageFor(activity)}</span>
      </div>
      {isWebSearch && <p className="pl-6 text-xs text-fg-muted">{t('chat.tool.web_search.notice')}</p>}
      {canViewResults && (
        <div className="pl-6">
          <Button variant="secondary" size="sm" onClick={onViewResults}>
            {t('chat.tool.viewResults')}
          </Button>
        </div>
      )}
    </div>
  );
}
