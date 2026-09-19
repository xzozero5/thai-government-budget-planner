import { useId, useState } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { cn, FOCUS_RING } from '@/components/ui/utils';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  defaultTabId?: string;
  className?: string;
}

/** Tabs (06 §7): roving tabindex + arrow key navigation + role tablist/tab/tabpanel */
export function Tabs({ items, defaultTabId, className }: TabsProps): ReactElement {
  const [activeId, setActiveId] = useState(defaultTabId ?? items[0]?.id ?? '');
  const baseId = useId();
  const activeIndex = items.findIndex((item) => item.id === activeId);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (items.length === 0) {
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (activeIndex + delta + items.length) % items.length;
      const next = items[nextIndex];
      if (next) {
        setActiveId(next.id);
        document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
      }
    }
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="flex gap-1 border-b border-line"
      >
        {items.map((item) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              id={`${baseId}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setActiveId(item.id);
              }}
              className={cn(
                'px-3 py-2 text-sm font-medium',
                FOCUS_RING,
                selected ? 'border-b-2 border-accent text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== activeId}
          className="py-3"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
