/**
 * T-404 — KeyGate page (06 §4.1, wireframes.md 4.1)
 *
 * N2/09 §1: ค่า key อยู่ใน local component state ชั่วคราวระหว่างพิมพ์เท่านั้น ถูกล้าง (`setApiKey('')`)
 * ทันทีหลัง submit ไม่ว่าผลจะสำเร็จหรือล้มเหลว — ไม่เคยเก็บ key ไว้ใน store/ref ที่ค้างอยู่ ไม่ log
 * ค่า key ที่ไหนเลย (รวม console.*)
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, ExternalLink, IconButton, Input, Select } from '@/components/ui';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';
import { MODEL_LIST, getModelCapability, isModelId } from '@/ai/models';
import { redactSecrets } from '@/ai/session/redactSecrets';
import { getKeyGateErrorMessage } from '@/features/keygate/errorCopy';
import { validateApiKeyFormat } from '@/features/keygate/validateApiKey';

const API_KEY_INPUT_ID = 'keygate-api-key';
const MODEL_SELECT_ID = 'keygate-model';
const BUDGET_INPUT_ID = 'keygate-budget';
const CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys';

function EyeIcon({ open }: { open: boolean }): ReactElement {
  if (open) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
      >
        <path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" strokeLinejoin="round" />
        <circle cx="10" cy="10" r="2.5" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path
        d="M2 2l16 16M6.2 6.4C3.6 8 1 10 1 10s3.5 6 9 6c1.7 0 3.2-.5 4.5-1.3M15.8 13.6C17.7 12.1 19 10 19 10s-3.5-6-9-6c-.8 0-1.6.1-2.3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KeyGatePage(): ReactElement {
  const navigate = useNavigate();
  const hasKey = useSessionStore((s) => s.hasKey);
  const keyStatus = useSessionStore((s) => s.keyStatus);
  const keyErrorKind = useSessionStore((s) => s.keyErrorKind);
  const keyErrorMessage = useSessionStore((s) => s.keyErrorMessage);
  const model = useSessionStore((s) => s.model);
  const setModel = useSessionStore((s) => s.setModel);
  const maxCostUsdPerSession = useSessionStore((s) => s.maxCostUsdPerSession);
  const setMaxCostUsdPerSession = useSessionStore((s) => s.setMaxCostUsdPerSession);
  const submitKey = useSessionStore((s) => s.submitKey);

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isVerifying = keyStatus === 'verifying';

  // ถ้ามี key อยู่แล้ว (submit สำเร็จ หรือ session ที่มีอยู่ก่อน) → redirect ไป workspace ทันที (06 §4.1)
  useEffect(() => {
    if (hasKey) {
      void navigate('/workspace', { replace: true });
    }
  }, [hasKey, navigate]);

  // focus แรกที่ช่อง key (06 §4.1)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const modelCapability = getModelCapability(model);
  const modelOptions = MODEL_LIST.map((m) => ({ value: m.id, label: m.labelTh }));

  const errorMessage =
    keyStatus === 'error' && keyErrorKind !== null
      ? redactSecrets(
          getKeyGateErrorMessage(
            keyErrorKind,
            keyErrorMessage !== null
              ? { modelLabel: modelCapability.labelTh, detail: keyErrorMessage }
              : { modelLabel: modelCapability.labelTh },
          ),
        )
      : null;

  function handleModelChange(e: ChangeEvent<HTMLSelectElement>): void {
    if (isModelId(e.target.value)) {
      setModel(e.target.value);
    }
  }

  function handleBudgetChange(e: ChangeEvent<HTMLInputElement>): void {
    const value = Number(e.target.value);
    if (Number.isFinite(value) && value > 0) {
      setMaxCostUsdPerSession(value);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const issue = validateApiKeyFormat(apiKey);
    if (issue) {
      setFormatError(issue);
      return;
    }
    setFormatError(null);
    const keyToSubmit = apiKey;
    // N2: ล้างค่าออกจาก state ทันที ก่อนรอผล verify — ไม่ปล่อยให้ค่า key ค้างใน component state
    // ระหว่างรอ network round-trip
    setApiKey('');
    await submitKey(keyToSubmit);
    // สำเร็จ: useEffect ที่ watch `hasKey` ข้างบนจะ navigate ให้เอง
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-fg">{t('common.appName')}</h1>
        <p className="text-lg text-fg">{t('common.appTagline')}</p>
        <p className="text-fg-muted">{t('keygate.heroSubtitle')}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={API_KEY_INPUT_ID} className="text-sm font-medium text-fg">
                {t('keygate.apiKeyLabel')}
              </label>
              <div className="relative">
                <Input
                  ref={inputRef}
                  id={API_KEY_INPUT_ID}
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                  }}
                  placeholder={t('keygate.apiKeyPlaceholder')}
                  {...(formatError ? { error: formatError } : {})}
                  disabled={isVerifying}
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  className="pr-12"
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  label={showKey ? t('keygate.apiKeyHide') : t('keygate.apiKeyShow')}
                  aria-pressed={showKey}
                  icon={<EyeIcon open={showKey} />}
                  disabled={isVerifying}
                  className="absolute right-0 top-0"
                  onClick={() => {
                    setShowKey((v) => !v);
                  }}
                />
              </div>
              {!formatError && <p className="text-sm text-fg-muted">{t('keygate.apiKeyHelp')}</p>}
              <ExternalLink href={CONSOLE_KEYS_URL}>console.anthropic.com</ExternalLink>
            </div>

            <Select
              id={MODEL_SELECT_ID}
              label={t('keygate.modelLabel')}
              value={model}
              onChange={handleModelChange}
              options={modelOptions}
              helperText={t('keygate.modelHelp')}
              disabled={isVerifying}
            />

            <Input
              id={BUDGET_INPUT_ID}
              type="number"
              inputMode="decimal"
              min={0.1}
              step={0.1}
              label={t('keygate.budgetLabel')}
              value={String(maxCostUsdPerSession)}
              onChange={handleBudgetChange}
              helperText={t('keygate.budgetHelp')}
              disabled={isVerifying}
              className="text-right tabular-nums"
            />

            {errorMessage && (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-md border border-danger bg-surface p-3 text-sm"
              >
                <p className="font-medium text-danger">{t('keygate.errorTitle')}</p>
                <p className="text-fg">{errorMessage}</p>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              status={isVerifying ? 'loading' : 'idle'}
              loadingLabel={t('keygate.submitTesting')}
              successLabel={t('keygate.submitSuccess')}
              className="w-full"
            >
              {t('keygate.submit')}
            </Button>

            <Link
              to="/load"
              className="text-center text-sm text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t('keygate.openExisting')}
            </Link>
          </Card>
        </form>

        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-fg">{t('keygate.privacyTitle')}</h2>
          <ul className="flex flex-col gap-2 text-sm text-fg-muted">
            <li>{t('keygate.privacyBullet1')}</li>
            <li>{t('keygate.privacyBullet2')}</li>
            <li>{t('keygate.privacyBullet3')}</li>
          </ul>
          <Link
            to="/about"
            className="text-sm text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t('keygate.privacyLink')}
          </Link>
        </Card>
      </div>
    </main>
  );
}
