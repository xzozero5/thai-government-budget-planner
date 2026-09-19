import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * T-402 — focus trap ใช้ร่วมกันระหว่าง `Drawer`/`Dialog` (06 §6: focus trap, Esc ปิด, คืน focus)
 * ไม่ export ผ่าน barrel — เป็น implementation detail ภายใน `components/ui`
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  // หมายเหตุ: ไม่กรองด้วย `offsetParent` (jsdom ไม่มี layout engine จึงเป็น null เสมอ) — คาดหวังว่า
  // caller ไม่ render element ที่ซ่อนด้วย `display:none`/`hidden` ไว้ข้างในกล่องที่ trap focus
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export interface UseFocusTrapOptions {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/** เปิด focus trap เมื่อ `active`: โฟกัสแรกเข้า element ในกล่อง, ดัก Tab ให้วนในกล่อง, Esc เรียก `onClose`, คืน focus ตอนปิด */
export function useFocusTrap(options: UseFocusTrapOptions): void {
  const { active, containerRef, onClose } = options;
  // เก็บ onClose ล่าสุดไว้ใน ref แทนการใส่ใน dependency array — กัน stale closure โดยไม่ต้อง re-trap
  // (re-focus element แรก) ทุกครั้งที่ parent re-render แล้วส่ง callback ใหม่มา
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = getFocusable(container);
    (focusables[0] ?? container).focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !container) {
        return;
      }
      const items = getFocusable(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        return;
      }
      const current = document.activeElement;
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef เป็น ref คงที่, onClose ต้อง fresh ทุก render ได้โดยไม่ re-trap
  }, [active]);
}
