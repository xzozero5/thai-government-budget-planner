import { useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { Button, Dialog, Input, Select, Switch } from '@/components/ui';
import { formatNumber, formatUsd } from '@/lib/format';
import { t } from '@/i18n';
import { getModelCapability, isModelId, MODEL_LIST, type EffortLevel } from '@/ai/models';
import { COST_ESTIMATE_CHECKED_AT_TH, getCostEstimate, usdToThbApprox } from '@/ai/session/costEstimates';
import { sessionChatController } from '@/ai/session/chatController';
import { useSessionStore } from '@/stores/sessionStore';
import { markManualClear } from '@/features/workspace/manualClearFlag';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** เพดานตามโจทย์ T-405: validate `> 0` และ `≤ 20` ดอลลาร์ */
const MIN_BUDGET_USD = 0;
const MAX_BUDGET_USD = 20;

const EFFORT_OPTIONS: { value: EffortLevel; labelKey: 'settings.effortLow' | 'settings.effortMedium' | 'settings.effortHigh' }[] =
  [
    { value: 'low', labelKey: 'settings.effortLow' },
    { value: 'medium', labelKey: 'settings.effortMedium' },
    { value: 'high', labelKey: 'settings.effortHigh' },
  ];

function isKnownEffort(value: string): value is EffortLevel {
  return EFFORT_OPTIONS.some((option) => option.value === value);
}

function parseBudget(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= MIN_BUDGET_USD || value > MAX_BUDGET_USD) {
    return null;
  }
  return value;
}

/**
 * T-405 — Settings dialog (06 §4.6): model, effort (ซ่อนเมื่อโมเดลไม่รองรับ), web search on/off,
 * เพดานเงินต่อคำถาม/session, ยอดใช้สะสม, สถานะ/ล้าง API key
 *
 * ขอบเขตที่ยังไม่ครบ (ไม่มีข้อมูลให้แสดง ไม่ใช่ของ T-405): breakdown โทเค็นเข้า/ออก/จำนวนครั้งค้นเว็บ
 * (`settings.usageBreakdown`) ต้องการตัวนับสะสมที่ยังไม่มีใน `sessionStore` (มีแค่ `spentUsd` รวม) —
 * แถบ "แคชข้อมูลในเครื่อง" (`settings.dataTitle`/...) ก็เช่นกัน (ต้องมีขนาด/จำนวนไฟล์แคชจาก data layer)
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps): ReactElement {
  const model = useSessionStore((s) => s.model);
  const setModel = useSessionStore((s) => s.setModel);
  const effort = useSessionStore((s) => s.effort);
  const setEffort = useSessionStore((s) => s.setEffort);
  const enableWebSearch = useSessionStore((s) => s.enableWebSearch);
  const setEnableWebSearch = useSessionStore((s) => s.setEnableWebSearch);
  const maxCostUsdPerTurn = useSessionStore((s) => s.maxCostUsdPerTurn);
  const setMaxCostUsdPerTurn = useSessionStore((s) => s.setMaxCostUsdPerTurn);
  const maxCostUsdPerSession = useSessionStore((s) => s.maxCostUsdPerSession);
  const setMaxCostUsdPerSession = useSessionStore((s) => s.setMaxCostUsdPerSession);
  const spentUsd = useSessionStore((s) => s.spentUsd);
  const hasKey = useSessionStore((s) => s.hasKey);

  const [turnDraft, setTurnDraft] = useState(String(maxCostUsdPerTurn));
  const [turnError, setTurnError] = useState<string | null>(null);
  const [sessionDraft, setSessionDraft] = useState(String(maxCostUsdPerSession));
  const [sessionError, setSessionError] = useState<string | null>(null);

  const supportsEffort = getModelCapability(model).supportsEffort;
  const costEstimate = getCostEstimate(model);

  function commitTurn(): void {
    const value = parseBudget(turnDraft);
    if (value === null) {
      setTurnError(t('settings.budgetInvalid'));
      return;
    }
    setTurnError(null);
    setMaxCostUsdPerTurn(value);
  }

  function commitSession(): void {
    const value = parseBudget(sessionDraft);
    if (value === null) {
      setSessionError(t('settings.budgetInvalid'));
      return;
    }
    setSessionError(null);
    setMaxCostUsdPerSession(value);
  }

  function handleClearKey(): void {
    markManualClear();
    sessionChatController.reset();
    useSessionStore.getState().clearKey('manual');
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('settings.title')}>
      <div className="flex flex-col gap-4">
        <Select
          label={t('settings.modelLabel')}
          helperText={t('settings.modelHelp')}
          value={model}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            if (isModelId(event.target.value)) {
              setModel(event.target.value);
            }
          }}
          options={MODEL_LIST.map((m) => ({ value: m.id, label: m.labelTh }))}
        />

        <div className="flex flex-col gap-0.5 text-xs text-fg-muted">
          <p>{t('settings.modelCostHint')}</p>
          <p>
            {t('common.costPerProposalEstimate', {
              usd: formatNumber(costEstimate.usd, { fractionDigits: 2 }),
              thb: formatNumber(usdToThbApprox(costEstimate.usd), { fractionDigits: 0 }),
              date: COST_ESTIMATE_CHECKED_AT_TH,
            })}
          </p>
          {costEstimate.unverified && <p className="text-warn">{t('common.costEstimateUnverified')}</p>}
        </div>

        {supportsEffort && (
          <Select
            label={t('settings.effortLabel')}
            helperText={t('settings.effortHelp')}
            value={effort}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              if (isKnownEffort(event.target.value)) {
                setEffort(event.target.value);
              }
            }}
            options={EFFORT_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-fg">{t('settings.webSearchLabel')}</p>
            <p className="text-xs text-fg-muted">
              {enableWebSearch ? t('settings.webSearchOn') : t('settings.webSearchOff')} · {t('settings.webSearchHelp')}
            </p>
            {!enableWebSearch && <p className="text-xs text-warn">{t('settings.webSearchOffNotice')}</p>}
          </div>
          <Switch checked={enableWebSearch} onChange={setEnableWebSearch} label={t('settings.webSearchLabel')} />
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <p className="text-sm font-medium text-fg">{t('settings.budgetTitle')}</p>
          <Input
            label={t('settings.budgetTurnLabel')}
            {...(turnError ? { error: turnError } : { helperText: t('settings.budgetTurnHelp') })}
            inputMode="decimal"
            value={turnDraft}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setTurnDraft(event.target.value);
            }}
            onBlur={commitTurn}
          />
          <Input
            label={t('settings.budgetSessionLabel')}
            {...(sessionError ? { error: sessionError } : { helperText: t('settings.budgetSessionHelp') })}
            inputMode="decimal"
            value={sessionDraft}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setSessionDraft(event.target.value);
            }}
            onBlur={commitSession}
          />
        </div>

        <div className="border-t border-line pt-3">
          <p className="text-sm font-medium text-fg">{t('settings.usageTitle')}</p>
          <p className="text-lg tabular-nums text-fg">{t('settings.usageValue', { amount: formatUsd(spentUsd, { fractionDigits: 2 }) })}</p>
          <p className="text-xs text-fg-muted">{t('settings.usageEstimateNote')}</p>
        </div>

        <div className="border-t border-line pt-3">
          <p className="text-sm font-medium text-fg">{t('settings.keyTitle')}</p>
          <p className="text-sm text-fg">{hasKey ? t('settings.keyStatusActive') : t('settings.keyStatusNone')}</p>
          <p className="text-xs text-fg-muted">{t('settings.keyNeverStored')}</p>
          {hasKey && (
            <Button variant="danger" size="sm" className="mt-2" onClick={handleClearKey}>
              {t('settings.keyClear')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
