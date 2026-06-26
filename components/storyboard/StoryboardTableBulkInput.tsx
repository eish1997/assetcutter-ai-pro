import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  readLocalJson,
  writeLocalJson,
} from '../../services/clientPersist';
import {
  defaultStoryboardBulkDraft,
  storyboardBulkDraftStorageKey,
  type StoryboardBulkDraft,
} from '../../services/storyboardTableInput';
import {
  applyStoryboardBulkImport,
  buildDuplicateStoryboardShotGroups,
  resolveStoryboardBulkLineCharRange,
  rowHasStoryboardBulkImportBaseline,
  scrollTextareaToCharRange,
  type StoryboardBulkParseResult,
} from '../../services/storyboardTableBulkImport';
import { storyboardRowHasFrameRef } from '../../services/storyboardFrameImageUrl';
import {
  parseStoryboardRawShotsFromText,
  STORYBOARD_PARSE_PAGE_NO_SHOT_HINT,
  type StoryboardRawShotParseSuccess,
} from '../../services/storyboardParsePageCore';
import { importStoryboardTextFromCompanionFile } from '../../services/storyboardCompanionOcrImport';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { STORYBOARD_FIELD_INPUT, STORYBOARD_TOOL_BTN_NEUTRAL, STORYBOARD_TOOL_BTN_PRIMARY } from './storyboardTableUi';

export type StoryboardTableBulkInputHandle = {
  /** @deprecated 解析页已改为规则识别，保留兼容 */
  convertFormat: () => Promise<boolean>;
  importToTable: () => Promise<void>;
  /** @deprecated 等同 importToTable */
  parseFields: () => Promise<boolean>;
  /** @deprecated 始终 false */
  generateCanonical: () => boolean;
  /** @deprecated 等同 importToTable */
  parseAndFill: () => Promise<void>;
};

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  readOnly?: boolean;
  onImport: (result: { catalog: StoryboardParseFieldDef[]; rows: StoryboardTableRow[] }) => void;
  onDraftChange?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onParseComplete?: (detail: { rowCount: number; appended: boolean }) => void;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

type PendingBulkImport = StoryboardBulkParseResult & { source?: 'local' | 'ai' };

function StoryboardBulkImportModeModal({
  open,
  importCount,
  existingCount,
  busy,
  onReplace,
  onMerge,
  onCancel,
}: {
  open: boolean;
  importCount: number;
  existingCount: number;
  busy?: boolean;
  onReplace: () => void;
  onMerge: () => void;
  onCancel: () => void;
}) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2175] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#121212] p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storyboard-bulk-import-mode-title"
      >
        <h3 id="storyboard-bulk-import-mode-title" className="text-[13px] font-semibold text-white">
          导入方式
        </h3>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          将导入 {importCount} 镜，当前表内 {existingCount} 镜。可粘贴完整脚本：同镜号更新，新镜号按镜号顺序插入。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-8 px-3 text-[10px]`}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onMerge}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-8 px-3 text-[10px]`}
          >
            按镜号合并
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReplace}
            className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-8 px-3 text-[10px]`}
          >
            覆盖整表
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
const BULK_ISSUE_PREVIEW_LIMIT = 5;

function focusBulkLineByNo(
  textarea: HTMLTextAreaElement | null,
  text: string,
  lineNo: number
): void {
  if (!textarea) return;
  const range = resolveStoryboardBulkLineCharRange(text, lineNo);
  if (!range) return;
  scrollTextareaToCharRange(textarea, range.charStart, range.charEnd);
}

function buildPendingFromRawParse(raw: StoryboardRawShotParseSuccess): PendingBulkImport {
  const duplicateShotGroups = buildDuplicateStoryboardShotGroups(
    raw.importRows.map((row, index) => ({
      lineNo: raw.previews.filter((preview) => preview.ready)[index]?.lineStart ?? index + 1,
      shotNo: row.shotNo || '',
      preview: (row.shotRaw || '').slice(0, 48),
    }))
  );
  return {
    headers: [],
    rows: raw.importRows,
    errors: raw.skippedMissingDuration
      ? [`${raw.skippedMissingDuration} 镜未识别到时长，已跳过`]
      : [],
    lineErrors: [],
    duplicateShotNos: raw.duplicateShotNos,
    duplicateShotGroups,
  };
}

function BulkLocateButton({
  readOnly,
  onClick,
}: {
  readOnly: boolean;
  onClick: () => void;
}) {
  if (readOnly) return null;
  return (
    <button
      type="button"
      className="ml-1 text-amber-200 underline decoration-amber-200/40 underline-offset-2 hover:text-white"
      onClick={onClick}
    >
      定位
    </button>
  );
}

function draftStorageKey(assetId: string): string {
  return storyboardBulkDraftStorageKey(assetId);
}

function defaultDraft(): StoryboardBulkDraft {
  return defaultStoryboardBulkDraft();
}

const PIPE_PLACEHOLDER = `粘贴分镜原文。按行首镜号自动切块，识别镜号与时长后可创建镜头；每镜仅保留该段原文，不拆字段。`;

const StoryboardTableBulkInput = forwardRef<StoryboardTableBulkInputHandle, Props>(
  function StoryboardTableBulkInput(
    {
      assetId,
      rows,
      fieldCatalog,
      readOnly = false,
      onImport,
      onDraftChange,
      onBusyChange,
      onParseComplete,
      onNotify,
      companionBaseUrl = '',
      companionProjectId = '',
    },
    ref
  ) {
    const [pipeText, setPipeText] = useState('');
    const [importBusy, setImportBusy] = useState(false);
    const [ocrImportBusy, setOcrImportBusy] = useState(false);
    const [pendingImport, setPendingImport] = useState<PendingBulkImport | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const ocrFileInputRef = useRef<HTMLInputElement>(null);
    const rowsRef = useRef(rows);

    useEffect(() => {
      rowsRef.current = rows;
    }, [rows]);

    useEffect(() => {
      const draft = readLocalJson(draftStorageKey(assetId), defaultDraft());
      setPipeText(draft.pipeText);
    }, [assetId]);

    const persistDraft = useCallback(
      (patch: Partial<StoryboardBulkDraft>) => {
        const current = readLocalJson(draftStorageKey(assetId), defaultDraft());
        const next: StoryboardBulkDraft = {
          mode: 'pipe',
          pipeText: patch.pipeText ?? current.pipeText,
          tsvText: patch.tsvText ?? current.tsvText,
          imageDataUrl: patch.imageDataUrl !== undefined ? patch.imageDataUrl : current.imageDataUrl,
          canonicalText: patch.canonicalText !== undefined ? patch.canonicalText : current.canonicalText,
        };
        writeLocalJson(draftStorageKey(assetId), next);
        onDraftChange?.();
      },
      [assetId, onDraftChange]
    );

    const rawParse = useMemo(() => parseStoryboardRawShotsFromText(pipeText), [pipeText]);

    const readyShotCount = rawParse.ok ? rawParse.importRows.length : 0;
    const totalShotCount = rawParse.ok ? rawParse.previews.length : 0;
    const missingDurationPreviews = rawParse.ok
      ? rawParse.previews.filter((preview) => !preview.ready)
      : [];

    const handleTextChange = (value: string) => {
      setPipeText(value);
      persistDraft({ pipeText: value });
    };

    const busy = importBusy || ocrImportBusy || Boolean(pendingImport);

    const canUseCompanionOcr = Boolean(companionProjectId.trim());

    useEffect(() => {
      onBusyChange?.(busy);
    }, [busy, onBusyChange]);

    const commitImport = useCallback(
      async (parsed: PendingBulkImport, mode: 'replace' | 'append') => {
        const replace = mode === 'replace';
        const latestRows = rowsRef.current;
        const result = applyStoryboardBulkImport(
          replace ? [] : fieldCatalog,
          latestRows,
          parsed.rows,
          replace ? 'replace' : 'append'
        );

        onImport({ catalog: result.catalog, rows: result.rows });
        const detail = { rowCount: parsed.rows.length, appended: !replace };
        const warnParts: string[] = [];
        if (parsed.errors[0]) warnParts.push(parsed.errors[0]);
        if (parsed.duplicateShotNos.length) {
          warnParts.push(`重复镜号：${parsed.duplicateShotNos.join('、')}`);
        }
        onNotify?.(
          parsed.duplicateShotNos.length || warnParts.length ? 'warn' : 'info',
          `已创建 ${parsed.rows.length} 镜${replace ? '' : '（按镜号合并）'}${warnParts.length ? `；${warnParts.join('；')}` : ''}`
        );
        queueMicrotask(() => onParseComplete?.(detail));
      },
      [fieldCatalog, onImport, onNotify, onParseComplete]
    );

    const createShots = useCallback(async () => {
      if (readOnly || busy) return;
      if (!rawParse.ok) {
        onNotify?.('warn', rawParse.message);
        return;
      }
      if (!rawParse.importRows.length) {
        onNotify?.('warn', '请先识别到镜号与时长');
        return;
      }

      const pending = buildPendingFromRawParse(rawParse);

      setImportBusy(true);
      try {
        const latestRows = rowsRef.current;
        const hasTextBaseline = latestRows.some(
          (row) =>
            (row.shotRaw || '').trim() ||
            Object.values(row.shotFields || {}).some((value) => String(value || '').trim())
        );
        const hasFrameBaseline = latestRows.some(storyboardRowHasFrameRef);
        const hasExisting = latestRows.some(rowHasStoryboardBulkImportBaseline);

        if (hasTextBaseline) {
          setPendingImport(pending);
          return;
        }
        if (hasFrameBaseline && latestRows.length > 0) {
          await commitImport(pending, 'append');
          return;
        }
        if (hasExisting) {
          setPendingImport(pending);
          return;
        }

        await commitImport(pending, 'replace');
      } finally {
        setImportBusy(false);
      }
    }, [busy, commitImport, onNotify, rawParse, readOnly]);

    const confirmPendingImport = useCallback(
      (mode: 'replace' | 'append') => {
        if (!pendingImport || importBusy) return;
        const parsed = pendingImport;
        setPendingImport(null);
        setImportBusy(true);
        void commitImport(parsed, mode).finally(() => {
          setImportBusy(false);
        });
      },
      [commitImport, importBusy, pendingImport]
    );

    useImperativeHandle(
      ref,
      () => ({
        convertFormat: async () => readyShotCount > 0,
        importToTable: createShots,
        parseFields: async () => readyShotCount > 0,
        generateCanonical: () => false,
        parseAndFill: createShots,
      }),
      [createShots, readyShotCount]
    );

    const handleOcrFilePicked = useCallback(
      async (file: File | null) => {
        if (!file || readOnly || ocrImportBusy) return;
        const pid = companionProjectId.trim();
        if (!pid) {
          onNotify?.('warn', '本机 OCR 需要工作区项目；请先在网站连接本地伴侣并选择项目');
          return;
        }
        setOcrImportBusy(true);
        try {
          onNotify?.('info', file.name.toLowerCase().endsWith('.pdf') ? 'PDF 解析中…' : '图片 OCR 中…');
          const res = await importStoryboardTextFromCompanionFile({
            projectId: pid,
            file,
            companionBaseUrl,
          });
          if (res.ok === false) {
            onNotify?.('warn', res.error);
            return;
          }
          setPipeText(res.text);
          persistDraft({ pipeText: res.text });
          onNotify?.(
            'info',
            res.source === 'pdf'
              ? 'PDF 已转为文本，请确认镜号与时长后点击「创建镜头」'
              : `图片 OCR 完成（${res.blockCount ?? 0} 段），请确认镜号与时长后点击「创建镜头」`,
          );
        } finally {
          setOcrImportBusy(false);
        }
      },
      [companionBaseUrl, companionProjectId, ocrImportBusy, onNotify, persistDraft, readOnly],
    );

    const statusHint = !pipeText.trim()
      ? null
      : !rawParse.ok
        ? STORYBOARD_PARSE_PAGE_NO_SHOT_HINT
        : readyShotCount
          ? `识别 ${totalShotCount} 镜 · 可创建 ${readyShotCount} 镜${
              missingDurationPreviews.length ? ` · ${missingDurationPreviews.length} 镜缺时长` : ''
            }`
          : totalShotCount
            ? `识别 ${totalShotCount} 镜 · 请先补全时长`
            : null;

    const hasIssues = Boolean(
      (rawParse.ok && rawParse.duplicateShotNos.length) ||
        missingDurationPreviews.length ||
        (!rawParse.ok && pipeText.trim())
    );

    return (
      <>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            ref={ocrFileInputRef}
            type="file"
            accept=".pdf,application/pdf,image/*"
            className="hidden"
            onChange={(event) => {
              const f = event.target.files?.[0] ?? null;
              event.target.value = '';
              void handleOcrFilePicked(f);
            }}
          />
          <button
            type="button"
            disabled={readOnly || busy || !canUseCompanionOcr}
            onClick={() => ocrFileInputRef.current?.click()}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-8 px-3 text-[10px]`}
            title={
              canUseCompanionOcr
                ? '经本地伴侣 PaddleOCR：PDF 用文档解析，图片用 OCR'
                : '需要工作区项目与本地伴侣 OCR 服务'
            }
          >
            {ocrImportBusy ? '识别中…' : '导入 PDF/图片'}
          </button>
          {!canUseCompanionOcr ? (
            <span className="text-[9px] text-gray-500">本机 OCR 需已配对伴侣并选择工作区项目</span>
          ) : null}
        </div>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={pipeText}
            readOnly={readOnly}
            wrap="off"
            placeholder={PIPE_PLACEHOLDER}
            onChange={(event) => handleTextChange(event.target.value)}
            className={`${STORYBOARD_FIELD_INPUT} h-44 w-full resize-none overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed sm:h-48`}
          />
          {statusHint ? (
            <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/50 px-2 py-0.5 text-[9px] text-gray-400 ring-1 ring-white/[0.08]">
              {statusHint}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={readOnly || busy || !readyShotCount}
            onClick={() => void createShots()}
            className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-8 flex-1 px-3 text-[10px] sm:max-w-[9rem] sm:flex-none`}
          >
            {importBusy ? '创建中…' : `创建镜头${readyShotCount ? ` (${readyShotCount})` : ''}`}
          </button>
        </div>

        {hasIssues ? (
          <div className="-mt-2 space-y-1 text-[10px] text-amber-300/90">
            {!rawParse.ok && pipeText.trim() ? <p>{rawParse.message}</p> : null}
            {rawParse.ok && rawParse.duplicateShotNos.length ? (
              <p>重复镜号：{rawParse.duplicateShotNos.join('、')}</p>
            ) : null}
            {missingDurationPreviews.slice(0, BULK_ISSUE_PREVIEW_LIMIT).map((preview) => (
              <p key={`${preview.lineStart}-${preview.shotNo}`}>
                镜 {preview.shotNo} 缺少时长（第 {preview.lineStart} 行起）
                <BulkLocateButton
                  readOnly={readOnly}
                  onClick={() => focusBulkLineByNo(textareaRef.current, pipeText, preview.lineStart)}
                />
              </p>
            ))}
            {missingDurationPreviews.length > BULK_ISSUE_PREVIEW_LIMIT ? (
              <p>另有 {missingDurationPreviews.length - BULK_ISSUE_PREVIEW_LIMIT} 镜缺少时长</p>
            ) : null}
          </div>
        ) : null}

        <StoryboardBulkImportModeModal
          open={Boolean(pendingImport)}
          importCount={pendingImport?.rows.length ?? 0}
          existingCount={rows.length}
          busy={importBusy}
          onReplace={() => confirmPendingImport('replace')}
          onMerge={() => confirmPendingImport('append')}
          onCancel={() => setPendingImport(null)}
        />
      </>
    );
  }
);

export default StoryboardTableBulkInput;
