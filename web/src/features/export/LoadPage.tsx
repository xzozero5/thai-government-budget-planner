/**
 * T-502 — หน้า `/load` (06-UI-SPEC §3/§4.5): เปิดไฟล์ `.tgbp.json` ที่เคยบันทึกไว้ แล้วแสดง**อ่านอย่าง
 * เดียว** โดยไม่ต้องใส่ API key และไม่โหลด data layer (DuckDB/manifest) เลย
 *
 * "อ่านอย่างเดียว": `ProposalPane` (T-406) ไม่มี prop `readOnly` ของตัวเอง (บันทึกไว้ท้ายไฟล์นี้/รายงาน
 * ท้ายงาน — ไม่ได้รับอนุญาตให้แก้ `features/proposal/**` เอง) จึงส่ง `onEditLine`/`onRequestReview` แบบ
 * no-op + แสดงแบนเนอร์ "อ่านอย่างเดียว" กำกับไว้ชัดเจนแทน — ข้อจำกัดที่ทราบ: ช่อง qty/ราคาต่อหน่วยในตาราง
 * BOQ ยังคลิกเข้าโหมดพิมพ์ได้ (แค่กด "ยืนยัน" แล้วไม่มีผลอะไรเพราะ onEditLine เป็น no-op)
 *
 * citation ที่คลิกแสดงได้แค่เท่าที่ `Citation` schema เก็บไว้ในไฟล์ (source_id/doc_id+quote/indicator
 * ฯลฯ — ดูคอมเมนต์หัวไฟล์ `pdf/types.ts`) ไม่มีการเรียก `@/data`/DuckDB ใด ๆ ในหน้านี้เลย
 *
 * ไฟล์ที่โหลด **ไม่ถูกเขียนลง storage ใด ๆ** — เก็บใน React state (`useState`) ของ component นี้เท่านั้น
 * หายเมื่อออกจากหน้า/รีเฟรช (เหมือนพฤติกรรม N2 ของ store อื่น ๆ ในแอป)
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Citation } from '@/ai/tools/proposal';
import { Button, Card, ErrorBoundary, Spinner } from '@/components/ui';
import { CitationDrawer, type CitationDrawerLoaders } from '@/features/citations';
import { ProposalPane } from '@/features/proposal/ProposalPane';
import { ProposalReadOnlyContext } from '@/features/proposal/readOnlyContext';
import type { ProposalVersionInfo } from '@/features/proposal/types';
import { t } from '@/i18n';
import { downloadBlob } from './downloadBlob';
import { ExportDialog, type ExportSource } from './ExportDialog';
import { buildTgbpFileName } from './fileNames';
import { formatThaiBuddhistDate } from './pdf/thaiDate';
import { parseTgbpFile, serializeTgbpFile, TGBP_FILE_MAX_BYTES, type TgbpFile } from './tgbpFile';

type LoadStatus = 'idle' | 'loading' | 'error' | 'loaded';

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** อ่านเนื้อไฟล์เป็นข้อความด้วย `FileReader` แทน `Blob.prototype.text()` — รองรับกว้างกว่า (jsdom/
 * เบราว์เซอร์เก่าบางตัวไม่มี `.text()` บน `File`) */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('อ่านไฟล์ไม่สำเร็จ'));
    };
    reader.readAsText(file);
  });
}

function versionInfosFrom(file: TgbpFile): ProposalVersionInfo[] {
  return file.proposalVersions.map((v, index) => ({
    index,
    label: t('proposal.versionItem', { n: index + 1 }),
    createdAt: formatThaiBuddhistDate(new Date(v.createdAt)),
    source: v.source,
  }));
}

export function LoadPage(): ReactElement {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [file, setFile] = useState<TgbpFile | null>(null);
  // T-602 (NEW-M5) — URL ที่ไม่ผ่าน `isSafeHttpsUrl` ในไฟล์ที่โหลดมา (ยังคง citation ไว้ ไม่ลบ — UI/PDF
  // render เป็น text อยู่แล้วเพราะใช้ตัวตรวจเดียวกัน) แสดงเป็นแถบเตือนให้ผู้ใช้เห็น
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(async (picked: File): Promise<void> => {
    setErrorMessage(null);
    if (picked.size > TGBP_FILE_MAX_BYTES) {
      setStatus('error');
      setErrorMessage(t('export.load.tooLarge', { limit: formatBytes(TGBP_FILE_MAX_BYTES) }));
      return;
    }
    setStatus('loading');
    try {
      const text = await readFileAsText(picked);
      const result = parseTgbpFile(text);
      if (!result.ok) {
        setStatus('error');
        setErrorMessage(t('export.load.invalid'));
        return;
      }
      setFile(result.file);
      setLoadWarnings(result.loadWarnings);
      setSelectedIndex(Math.max(0, result.file.currentProposalIndex));
      setStatus('loaded');
    } catch {
      setStatus('error');
      setErrorMessage(t('export.load.invalid'));
    }
  }, []);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const picked = event.target.files?.[0];
    if (picked) {
      void loadFile(picked);
    }
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    const picked = event.dataTransfer.files[0];
    if (picked) {
      void loadFile(picked);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(): void {
    setDragActive(false);
  }

  const selectedVersion = file?.proposalVersions[selectedIndex];

  const citationLoaders: CitationDrawerLoaders = useMemo(
    () => ({
      // ไฟล์ `.tgbp.json` ไม่เก็บ `BudgetLine` เต็ม (แค่ `source_id`) — "ไม่พบ" ตรงนี้แปลว่า "ไม่มีในไฟล์
      // นี้" จริง ๆ ไม่ใช่ error (ดูหมายเหตุหัวไฟล์)
      loadBudgetLine: () => Promise.resolve(null),
      loadDocumentChunk: (docId, page) => {
        if (selectedCitation?.kind === 'document' && selectedCitation.doc_id === docId) {
          return Promise.resolve({
            title: docId,
            page: page ?? selectedCitation.page ?? null,
            text: selectedCitation.quote ?? '',
            isScanned: selectedCitation.quote === undefined,
          });
        }
        return Promise.resolve(null);
      },
      loadEconPoint: (indicator, yearBe) => {
        if (
          selectedCitation?.kind === 'econ' &&
          selectedCitation.indicator === indicator &&
          selectedCitation.year_be === yearBe
        ) {
          return Promise.resolve({ label: indicator, value: null, unit: '', verified: false });
        }
        return Promise.resolve(null);
      },
    }),
    [selectedCitation],
  );

  if (status !== 'loaded' || !file || !selectedVersion) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <Card className="w-full max-w-md text-center">
          <h1 className="text-lg font-semibold text-fg">{t('export.load.title')}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t('export.load.intro')}</p>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`mt-4 rounded-md border-2 border-dashed p-6 text-sm text-fg-muted transition-colors ${
              dragActive ? 'border-accent bg-surface-2' : 'border-line'
            }`}
          >
            {status === 'loading' ? (
              <div className="flex flex-col items-center gap-2">
                <Spinner label={t('export.load.loading')} />
                <span>{t('export.load.loading')}</span>
              </div>
            ) : (
              <>
                <p>{t('export.load.dropzone')}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                >
                  {t('export.load.choose')}
                </Button>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.tgbp.json,application/json"
            onChange={handleInputChange}
            className="sr-only"
            aria-label={t('export.load.choose')}
          />

          {status === 'error' && errorMessage !== null && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {errorMessage}
            </p>
          )}

          <Link
            to="/"
            className="mt-4 inline-block text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t('common.back')}
          </Link>
        </Card>
      </main>
    );
  }

  const exportSource: ExportSource = {
    proposal: selectedVersion.proposal,
    warnings: selectedVersion.warnings,
    editedLineIds: selectedVersion.userEditedLineIds,
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-sm bg-surface px-2 py-0.5 text-xs font-medium text-fg">
            {t('export.load.readOnlyBadge')}
          </span>
          <span className="text-sm text-fg-muted">{t('export.load.readOnlyBody')}</span>
        </div>
        <Link
          to="/"
          className="text-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('export.load.addKey')}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadWarnings.length > 0 && (
          <div role="alert" className="m-4 flex flex-col gap-1 rounded-md border border-warn bg-surface-2 p-3 text-sm text-fg">
            {loadWarnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        )}
        <ProposalReadOnlyContext.Provider value={true}>
          {/* T-602 (NEW-H1 ส่วนที่เหลือ) — ครอบ ProposalPane ด้วย boundary ย่อย: error จากข้อมูลในไฟล์ที่
              ผู้ใช้เปิดเอง (ไม่ผ่านการตรวจโดยเราเอง) ต้องไม่ทำให้ทั้งหน้าขาว — `resetKey` ผูกกับ id ของ
              เวอร์ชันที่กำลังแสดง เปลี่ยนเวอร์ชัน/เปิดไฟล์ใหม่แล้ว error เดิมต้องหายไปเอง */}
          <ErrorBoundary variant="section" resetKey={selectedVersion.id}>
            <ProposalPane
              proposal={selectedVersion.proposal}
              warnings={selectedVersion.warnings}
              versions={versionInfosFrom(file)}
              currentVersionIndex={selectedIndex}
              onSelectVersion={setSelectedIndex}
              editedLineIds={selectedVersion.userEditedLineIds}
              onEditLine={() => undefined}
              onRequestReview={() => undefined}
              onOpenCitation={(citation) => {
                setSelectedCitation(citation);
              }}
              onExport={() => {
                setExportOpen(true);
              }}
              onSave={() => {
                // T-602 (NEW-L8) — re-serialize จาก `TgbpFile` ที่ parse แล้ว (whitelist ทีละ field เหมือน
                // `serializeSession`) แทนการเขียน `rawText` ดิบของไฟล์ต้นทางกลับออกไป (กัน field แปลกปลอม
                // ที่หลุดมาจากนอกระบบก่อน `.strict()` ตัดทิ้งตอน parse ไม่ให้ย้อนกลับเข้ามาอีกรอบตอนบันทึกซ้ำ)
                downloadBlob(
                  new Blob([serializeTgbpFile(file)], { type: 'application/json' }),
                  buildTgbpFileName(selectedVersion.proposal.title),
                );
              }}
              isAiRunning={false}
            />
          </ErrorBoundary>
        </ProposalReadOnlyContext.Provider>
      </div>

      <CitationDrawer
        open={selectedCitation !== null}
        onClose={() => {
          setSelectedCitation(null);
        }}
        citation={selectedCitation}
        loaders={citationLoaders}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
        }}
        source={exportSource}
      />
    </div>
  );
}
