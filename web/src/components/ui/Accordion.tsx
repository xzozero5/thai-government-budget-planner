import { useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
// import ไฟล์ตรง (ไม่ผ่าน barrel `@/components/motion`) — `Collapse` ไม่มี dependency ของ `motion/react`
// เลย แต่ barrel นั้น re-export `FadeSlideIn`/`MotionProvider` ที่มีด้วย ถ้า import ผ่าน barrel จะดึง
// `motion/react` เข้ามาด้วยทั้งที่ `Accordion` ถูกใช้จาก `/load` (route ที่ไม่ได้ lazy-load)
import { Collapse } from '@/components/motion/Collapse';
import { cn, FOCUS_RING } from '@/components/ui/utils';

export interface AccordionItemData {
  id: string;
  title: string;
  content: ReactNode;
  /** เปิดอยู่ตั้งแต่แรก — ค่าเริ่มต้น `true` (06 §4.3: "เปิดหมดโดย default บน desktop") */
  defaultOpen?: boolean;
}

export interface AccordionProps {
  items: AccordionItemData[];
  className?: string;
}

/** Accordion หลายส่วนเปิดพร้อมกันได้ (สรุป/วัตถุประสงค์/BOQ/... 06 §4.3) */
export function Accordion({ items, className }: AccordionProps): ReactElement {
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.defaultOpen ?? true).map((i) => i.id)),
  );

  function toggle(id: string): void {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className={cn('flex flex-col divide-y divide-line', className)}>
      {items.map((item) => (
        <AccordionRow key={item.id} item={item} open={openIds.has(item.id)} onToggle={toggle} />
      ))}
    </div>
  );
}

function AccordionRow({
  item,
  open,
  onToggle,
}: {
  item: AccordionItemData;
  open: boolean;
  onToggle: (id: string) => void;
}): ReactElement {
  const panelId = useId();
  return (
    <div>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            onToggle(item.id);
          }}
          className={cn(
            'flex w-full items-center justify-between gap-2 py-3 text-left font-medium text-fg',
            FOCUS_RING,
          )}
        >
          <span>{item.title}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={cn(
              'h-4 w-4 shrink-0 transition duration-fast ease-out',
              open && 'rotate-180',
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h3>
      {open && (
        // motion.md #24: เปิด → height auto→content + fade (200ms ease-out) — animate เฉพาะตอน "เปิด"
        // เท่านั้น ปิดให้ unmount ทันที (ดูคอมเมนต์หัวไฟล์ `Collapse.tsx`) — ไม่กระทบ role/aria-label เดิม
        <Collapse>
          <div id={panelId} role="region" aria-label={item.title} className="pb-3 text-fg">
            {item.content}
          </div>
        </Collapse>
      )}
    </div>
  );
}
