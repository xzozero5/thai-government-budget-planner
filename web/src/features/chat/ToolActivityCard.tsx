import type { ReactElement } from 'react';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';
import { Button, Spinner } from '@/components/ui';
import { t } from '@/i18n';
import type { ToolActivity } from '@/stores/chatStore';
import { renderToolTemplate, renderToolTemplateIfComplete } from './toolCopy';
import { isKnownToolName, RUNNING_KEY, STATUS_KEY } from './toolNames';

export interface ToolActivityCardProps {
  activity: ToolActivity;
  /** เปิด citation drawer แสดงผลลัพธ์ (≤ 50 แถว) — `undefined` เมื่อยังไม่มีที่ให้เปิด (T-407 ยังไม่เสร็จ) */
  onViewResults?: (() => void) | undefined;
}

/** T-410 M4 (po-review ชุด B, US-2.2): `activity.summary` แบบมีโครงสร้าง (ชุด A) → map เข้า
 * `chat.tool.<tool>.<status>` เป็นภาษาไทยล้วน (ไม่มีชื่อ tool ภาษาอังกฤษปน) เมื่อ placeholder ของ key
 * นั้นมีค่าจริงครบ (เท่าที่ `ToolResultSummary` มี: `count`/`query`) — ไม่ครบ (เช่น key ต้องการ `{from}`/
 * `{item}` ที่ยังไม่มีใน `ToolResultSummary` ปัจจุบัน) → คืน `null` ให้ผู้เรียก fallback ไปใช้ `inputSummary`
 * เดิม (ai/agent.ts เตรียมมาให้แล้ว ซึ่งบาง tool มีค่าจริงครบกว่า) */
function messageFromStructuredSummary(activity: ToolActivity): string | null {
  const { name, summary } = activity;
  if (!summary || !isKnownToolName(name) || name === 'web_search') {
    return null;
  }
  const key = STATUS_KEY[name][summary.status];
  if (!key) {
    return null;
  }
  const params: Record<string, string | number> = {};
  if (summary.count !== undefined) {
    params['count'] = summary.count;
  }
  if (summary.query !== undefined) {
    params['query'] = summary.query;
  }
  // T-410 ข้อ 1 (หลัง demo จริง 2569-09-20) — `chat.tool.<tool>.error` มี `{reason}` อยู่แล้วในทุก tool
  // (ดู docs/ui/copy.th.json) แต่ไม่เคยมีค่าจริงส่งมาให้ก่อนหน้านี้ (ToolResultSummary ไม่มี field นี้) —
  // ไม่มีค่า (`reason` undefined) → placeholder ไม่ครบ → `renderToolTemplateIfComplete` คืน `null` แล้ว
  // ผู้เรียก fallback ไปใช้ `inputSummary` เดิม ("X: เรียกใช้ไม่สำเร็จ") ตามที่ตั้งใจ (ไม่ถือว่าถอยหลัง)
  if (summary.reason !== undefined) {
    params['reason'] = summary.reason;
  }
  return renderToolTemplateIfComplete(key, params);
}

function messageFor(activity: ToolActivity): string {
  const { name, status, inputSummary, summary } = activity;

  // T-307: web_search ต้องแสดง query ทุกครั้ง (ไม่ว่าจะมี `summary` แบบมีโครงสร้างหรือไม่) —
  // `inputSummary` ของ web_search คือ query ดิบ (ดู `ai/session/chatController.ts#handleAgentEvent`
  // case 'server_tool') ไม่ใช่ประโยคสำเร็จรูปแบบ tool อื่น
  if (name === 'web_search') {
    return renderToolTemplate('chat.tool.web_search.running', { query: inputSummary ?? summary?.query ?? '' });
  }

  if (status === 'running') {
    const key = isKnownToolName(name) ? RUNNING_KEY[name] : undefined;
    return key ? renderToolTemplate(key) : t('chat.thinking');
  }

  const structured = messageFromStructuredSummary(activity);
  if (structured !== null) {
    return structured;
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
    // motion.md #9: ไอคอน tool activity เมื่อเสร็จ crossfade + scale 0.9→1 (150ms ease-out) — keyframe
    // ล้วน เล่นครั้งเดียวตอน element นี้ mount (สลับมาจาก Spinner) เคารพ reduced-motion ผ่าน global
    // override ใน tokens.css โดยอัตโนมัติ (สลับไอคอนทันทีตามตาราง)
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 animate-check-pop text-success"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** motion.md #8: แถบ progress ด้านล่างการ์ด pulse วนลูปขณะ tool กำลังรัน — reduced-motion fallback:
 * แถบคงที่ 30% (ข้อความ "กำลัง…" ข้าง ๆ สื่อสถานะอยู่แล้วผ่าน `messageFor`) */
function RunningProgressBar({ reducedMotion }: { reducedMotion: boolean }): ReactElement {
  if (reducedMotion) {
    return (
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
        <div className="h-full w-[30%] bg-accent" />
      </div>
    );
  }
  return (
    <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
      <div className="h-full w-1/3 animate-tool-progress rounded-full bg-accent" />
    </div>
  );
}

/** การ์ดกิจกรรม tool ต่อ 1 การเรียก (06 §7 #25) — ต้องบอกว่าค้นอะไร/ได้กี่แถวทุกครั้ง (โปร่งใส N3/T-307) */
export function ToolActivityCard({ activity, onViewResults }: ToolActivityCardProps): ReactElement {
  const isWebSearch = activity.name === 'web_search';
  const canViewResults = !isWebSearch && activity.status === 'done' && onViewResults !== undefined;
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      className="flex flex-col gap-1 rounded-sm border border-line bg-surface-2 px-3 py-2 text-sm"
      data-testid="tool-activity"
      data-tool={activity.name}
      data-status={activity.status}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <StatusIcon status={activity.status} />
        </span>
        <span className={activity.status === 'error' ? 'text-danger' : 'text-fg'}>{messageFor(activity)}</span>
      </div>
      {activity.status === 'running' && <RunningProgressBar reducedMotion={reducedMotion} />}
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
