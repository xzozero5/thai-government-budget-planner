/**
 * T-602 NEW-H1 — React error boundary (09-SECURITY §1, T-307 §9 ข้อ 7)
 *
 * เดิมทั้ง repo ไม่มี boundary: error ระหว่าง render จากข้อมูลที่คนนอกคุมได้ (ไฟล์ `.tgbp.json` ที่ผู้ใช้เปิด,
 * ค่าจากโมเดล) ทำให้ทั้งแท็บขาว — เสียงานที่ยังไม่ได้บันทึก และ React จะ log error ดิบโดยไม่ผ่านตัวกรอง key
 *
 * กติกา: ข้อความ error ต้องผ่าน `redactSecrets` ก่อนแสดง/ก่อน log เสมอ และ **ห้าม log object error ดิบ**
 * (อาจมี request/headers ติดมากับ error ของ SDK)
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { redactSecrets } from '@/ai/session/redactSecrets';
import { t } from '@/i18n';
import { isChunkLoadError } from '@/lib/chunkLoad';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 'page' = ครอบทั้งหน้า (มีลิงก์กลับหน้าแรก), 'section' = ครอบเฉพาะส่วน (ส่วนอื่นของหน้ายังใช้ได้) */
  variant?: 'page' | 'section';
  /** เปลี่ยนค่านี้ = ล้างสถานะ error อัตโนมัติ (เช่น ผู้ใช้เลือกไฟล์/เวอร์ชันใหม่) */
  resetKey?: string | number;
}

interface ErrorBoundaryState {
  message: string | null;
  resetKey: string | number | undefined;
}

const MAX_MESSAGE_CHARS = 300;

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw).slice(0, MAX_MESSAGE_CHARS);
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { message: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { message: safeMessage(error) };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { message: null, resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // log เฉพาะข้อความที่กรองแล้ว + component stack (ไม่มีข้อมูลผู้ใช้) — ไม่ log object error ดิบ
    console.error(`[ErrorBoundary] ${safeMessage(error)}`, info.componentStack ?? '');
  }

  private readonly handleRetry = (): void => {
    this.setState({ message: null });
  };

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { message } = this.state;
    if (message === null) {
      return this.props.children;
    }
    const isPage = (this.props.variant ?? 'section') === 'page';
    // ไฟล์ JS ของเวอร์ชันที่เปิดค้างถูกแทนที่หลัง deploy — "ลองใหม่" ไม่มีทางสำเร็จ (ดู `lib/chunkLoad.ts`) ทางออกจริงคือ
    // รีเฟรช; งานที่ค้างยังอยู่ในหน่วยความจำของแท็บจนกว่าจะรีเฟรช จึงบอกให้กลับไปบันทึกไฟล์ก่อน
    const isStaleVersion = isChunkLoadError(message);
    return (
      <div
        role="alert"
        className={
          isPage
            ? 'mx-auto flex max-w-xl flex-col gap-3 p-6'
            : 'flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-4'
        }
      >
        <h2 className="text-base font-semibold text-danger">
          {isStaleVersion ? t('errors.staleVersionTitle') : t('errors.title')}
        </h2>
        <p className="whitespace-pre-wrap break-words text-sm text-fg">
          {isStaleVersion ? t('errors.staleVersionBody') : t('errors.unknown', { detail: message })}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={isStaleVersion ? this.handleReload : this.handleRetry}
            className="inline-flex min-h-9 items-center rounded-sm bg-primary px-3 text-sm font-medium text-primary-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {isStaleVersion ? t('errors.staleVersionReload') : t('common.retry')}
          </button>
          {isPage ? (
            <a
              href="#/"
              className="inline-flex min-h-9 items-center text-sm text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t('common.back')}
            </a>
          ) : null}
        </div>
      </div>
    );
  }
}
