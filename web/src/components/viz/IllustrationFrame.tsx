/**
 * T-412 — IllustrationFrame: กรอบภาพประกอบ SVG ที่ AI สร้าง (N9) render ผ่าน `sanitizeSvg(...).node()`
 * เท่านั้น — ห้าม `dangerouslySetInnerHTML`/`innerHTML` (บล็อกด้วย ESLint แล้วทั้ง repo, T-307)
 *
 * Lightbox mount node เป็นคนละ instance จากกรอบหลักเสมอ: เรียก `sanitizeSvg(svgText)` ใหม่ทุกครั้งที่
 * เปิด lightbox (ไม่ใช้ node เดิมจากกรอบหลัก) — DOM node ย้ายที่ไม่ได้อยู่แล้ว (`appendChild` จะดึง
 * node ออกจาก parent เดิม) แต่การ sanitize ซ้ำทำให้ path นี้ไม่ต้องพึ่ง state ที่แชร์กับกรอบหลักเลย
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
import { Button, Dialog, IconButton, Popover } from '@/components/ui';
import { t } from '@/i18n';
import { sanitizeSvg } from '@/lib/svgSanitizer';
import { cx } from './utils';

export interface IllustrationFrameProps {
  svgText: string;
  title: string;
  caption?: string;
  onRegenerate?: () => void;
  onHide?: () => void;
  className?: string;
}

function ExpandIcon(): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** mount SVG node ที่ sanitize แล้วเข้า container — เรียก `.node()` ใหม่ทุกครั้งที่ dependency เปลี่ยน
 * (สร้าง DOM node ใหม่เสมอ ไม่แชร์ node เดียวกันระหว่าง 2 container) */
function useSvgMount(containerRef: RefObject<HTMLDivElement | null>, svgNode: SVGSVGElement | null): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (svgNode) {
      container.replaceChildren(svgNode);
    } else {
      container.replaceChildren();
    }
    return () => {
      container.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef เป็น ref เสถียร ไม่ต้องใส่ dep
  }, [svgNode]);
}

/**
 * กรอบภาพประกอบ + lightbox (N9): sanitize ไม่ผ่าน → ไม่ render อะไรจาก SVG เลย แสดง fallback แทน
 * ป้าย "ภาพประกอบโดย AI" ต้องเห็นเสมอ ห้ามซ่อนตอน hover (06 §ui/components.md #24)
 */
export function IllustrationFrame({
  svgText,
  title,
  caption,
  onRegenerate,
  onHide,
  className,
}: IllustrationFrameProps): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const lightboxMountRef = useRef<HTMLDivElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const mainResult = useMemo(() => sanitizeSvg(svgText), [svgText]);
  // sanitize ใหม่อีกครั้งเฉพาะตอน lightbox เปิด (ไม่ผูกกับ node ของกรอบหลัก)
  const lightboxResult = useMemo(
    () => (lightboxOpen ? sanitizeSvg(svgText) : null),
    [lightboxOpen, svgText],
  );

  // `.node()` สร้าง DOM node ใหม่ทุกครั้งที่เรียก (by design ของ sanitizeSvg) — memo ไว้ให้ node นิ่ง
  // ระหว่าง re-render ปกติ (มิเช่นนั้น useEffect ด้านล่างจะ replaceChildren ทุกครั้งที่ component render)
  const mainNode = useMemo(() => (mainResult.ok ? mainResult.node() : null), [mainResult]);
  const lightboxNode = useMemo(
    () => (lightboxResult?.ok ? lightboxResult.node() : null),
    [lightboxResult],
  );

  useSvgMount(mountRef, mainNode);
  useSvgMount(lightboxMountRef, lightboxNode);

  if (!mainResult.ok) {
    return (
      <div
        className={cx(
          'flex aspect-video flex-col items-center justify-center gap-3 rounded-md border border-line bg-surface-2 p-4 text-center',
          className,
        )}
      >
        <p className="text-sm text-danger">{t('proposal.illustration.failed')}</p>
        {onRegenerate && (
          <Button variant="secondary" onClick={onRegenerate}>
            {t('proposal.illustration.regenerate')}
          </Button>
        )}
      </div>
    );
  }

  const warnings = mainResult.warnings;

  return (
    <figure
      className={cx(
        'relative overflow-hidden rounded-md border border-line bg-surface-2 [contain:content]',
        className,
      )}
    >
      <div
        ref={mountRef}
        role="img"
        aria-label={title}
        data-testid="illustration-svg-mount"
        className="aspect-video [&_svg]:pointer-events-none [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
      />

      {/* ป้าย "ภาพประกอบโดย AI" — เห็นเสมอ ไม่ซ่อนตอน hover (N9) */}
      <span className="absolute bottom-2 left-2 rounded-sm bg-surface/90 px-2 py-0.5 text-xs text-fg-muted">
        {t('proposal.illustration.aiBadge')}
      </span>

      <div className="absolute right-2 top-2">
        <IconButton
          label={t('proposal.illustration.openLightbox')}
          icon={<ExpandIcon />}
          onClick={() => {
            setLightboxOpen(true);
          }}
        />
      </div>

      {caption && <figcaption className="p-2 text-sm text-fg-muted">{caption}</figcaption>}

      {warnings.length > 0 && (
        <div className="px-2 pb-2">
          <Popover triggerLabel={t('proposal.illustration.sanitizedDetail')}>
            <p className="mb-2">
              {t('proposal.illustration.sanitized', { count: warnings.length })}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-fg-muted">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Popover>
        </div>
      )}

      {(onRegenerate ?? onHide) && (
        <div className="flex gap-2 p-2">
          {onRegenerate && (
            <Button variant="ghost" onClick={onRegenerate}>
              {t('proposal.illustration.regenerate')}
            </Button>
          )}
          {onHide && (
            <Button variant="ghost" onClick={onHide}>
              {t('proposal.illustration.hide')}
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={lightboxOpen}
        onClose={() => {
          setLightboxOpen(false);
        }}
        title={title}
        closeLabel={t('proposal.illustration.closeLightbox')}
      >
        {lightboxResult?.ok ? (
          <div
            ref={lightboxMountRef}
            role="img"
            aria-label={t('a11y.illustration', { title })}
            data-testid="illustration-lightbox-svg-mount"
            className="max-h-[80vh] [&_svg]:pointer-events-none [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
          />
        ) : (
          <p className="text-sm text-danger">{t('proposal.illustration.failed')}</p>
        )}
      </Dialog>
    </figure>
  );
}
