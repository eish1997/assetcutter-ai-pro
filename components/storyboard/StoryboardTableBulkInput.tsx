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
  parseStoryboardBulkText,
  resolveStoryboardBulkLineCharRange,
  rowHasStoryboardBulkImportBaseline,
  scrollTextareaToCharRange,
  type StoryboardBulkParseLineError,
  type StoryboardBulkParseResult,
} from '../../services/storyboardTableBulkImport';
import { storyboardRowHasFrameRef } from '../../services/storyboardFrameImageUrl';
import {
  normalizeStoryboardBulkWithAi,
  parseStoryboardBulkTextWithAiFallback,
} from '../../services/storyboardTableBulkAiDetect';
import type { CapabilityExecuteContext } from '../../services/capabilityExecutor';
import {
  mergeBulkStructuredParseIntoTable,
  parseStoryboardBulkStructuredWithPreset,
  parseStoryboardRowsBatch,
  rowHasStructuredFieldValues,
  STORYBOARD_BULK_PARSE_MAX_CHARS,
} from '../../services/storyboardTableParse';
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { STORYBOARD_FIELD_INPUT, STORYBOARD_TOOL_BTN_NEUTRAL, STORYBOARD_TOOL_BTN_PRIMARY } from './storyboardTableUi';

export type StoryboardTableBulkInputHandle = {
  parseAndFill: () => Promise<void>;
};

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  parsePreset?: CustomAppModule | null;
  parseCtx?: CapabilityExecuteContext;
  readOnly?: boolean;
  onImport: (result: { catalog: StoryboardParseFieldDef[]; rows: StoryboardTableRow[] }) => void;
  onDraftChange?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onParseComplete?: (detail: { rowCount: number; appended: boolean }) => void;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
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

function focusBulkLineError(
  textarea: HTMLTextAreaElement | null,
  text: string,
  entry: StoryboardBulkParseLineError
): void {
  focusBulkLineByNo(textarea, text, entry.lineNo);
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

const PIPE_PLACEHOLDER = `粘贴分镜脚本（可重复粘贴完整脚本）。解析后按镜号合并：同镜号更新，新镜号按顺序插入。`;

const StoryboardTableBulkInput = forwardRef<StoryboardTableBulkInputHandle, Props>(
  function StoryboardTableBulkInput(
    {
      assetId,
      rows,
      fieldCatalog,
      parsePreset = null,
      parseCtx,
      readOnly = false,
      onImport,
      onDraftChange,
      onBusyChange,
      onParseComplete,
      onNotify,
    },
    ref
  ) {
    const [pipeText, setPipeText] = useState('');
    const [importBusy, setImportBusy] = useState(false);
    const [aiBusy, setAiBusy] = useState(false);
    const [normalizedByAi, setNormalizedByAi] = useState(false);
    const [aiRejectReason, setAiRejectReason] = useState<string | null>(null);
    const [pendingImport, setPendingImport] = useState<PendingBulkImport | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const rowsRef = useRef(rows);

    useEffect(() => {
      rowsRef.current = rows;
    }, [rows]);

    useEffect(() => {
      const draft = readLocalJson(draftStorageKey(assetId), defaultDraft());
      setPipeText(draft.pipeText);
      setNormalizedByAi(false);
      setAiRejectReason(null);
    }, [assetId]);

    const persistDraft = useCallback(
      (patch: Partial<StoryboardBulkDraft>) => {
        const current = readLocalJson(draftStorageKey(assetId), defaultDraft());
        const next: StoryboardBulkDraft = {
          mode: 'pipe',
          pipeText: patch.pipeText ?? current.pipeText,
          tsvText: patch.tsvText ?? current.tsvText,
          imageDataUrl: patch.imageDataUrl !== undefined ? patch.imageDataUrl : current.imageDataUrl,
        };
        writeLocalJson(draftStorageKey(assetId), next);
        onDraftChange?.();
      },
      [assetId, onDraftChange]
    );

    const preview = useMemo(() => {
      if (!pipeText.trim()) return null;
      return parseStoryboardBulkText(pipeText, 'pipe');
    }, [pipeText]);

    const handleTextChange = (value: string) => {
      setPipeText(value);
      setNormalizedByAi(false);
      setAiRejectReason(null);
      persistDraft({ pipeText: value });
    };

    const canUseAi = Boolean(parsePreset && parseCtx);
    const busy = importBusy || aiBusy || Boolean(pendingImport);

    useEffect(() => {
      onBusyChange?.(busy);
    }, [busy, onBusyChange]);

    const runAiNormalize = useCallback(async (): Promise<StoryboardBulkParseResult | null> => {
      if (!pipeText.trim()) return null;
      if (!parsePreset || !parseCtx) {
        onNotify?.('warn', '未配置解析预设，无法使用 AI 识别');
        return null;
      }
      setAiBusy(true);
      try {
        const result = await normalizeStoryboardBulkWithAi(pipeText, parsePreset, parseCtx);
        if (!result.isStoryboard) {
          setAiRejectReason(result.reason);
          setNormalizedByAi(false);
          onNotify?.('warn', result.reason);
          return null;
        }
        setAiRejectReason(null);
        setNormalizedByAi(true);
        setPipeText(result.normalizedText);
        persistDraft({ pipeText: result.normalizedText });
        onNotify?.('info', `已规范化为 ${result.parsed.rows.length} 镜`);
        return result.parsed;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setAiRejectReason(message);
        onNotify?.('error', message);
        return null;
      } finally {
        setAiBusy(false);
      }
    }, [onNotify, parseCtx, parsePreset, persistDraft, pipeText]);

    const resolveParsedForImport = useCallback(async (): Promise<
      (StoryboardBulkParseResult & { source?: 'local' | 'ai' }) | null
    > => {
      if (preview?.rows.length) {
        return { ...preview, source: normalizedByAi ? 'ai' : 'local' };
      }
      if (!parsePreset || !parseCtx) return preview;
      setAiBusy(true);
      try {
        const result = await parseStoryboardBulkTextWithAiFallback(pipeText, 'pipe', parsePreset, parseCtx);
        if (result.source === 'ai') {
          setNormalizedByAi(true);
          setAiRejectReason(null);
          setPipeText(result.normalizedText);
          persistDraft({ pipeText: result.normalizedText });
        }
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setAiRejectReason(message);
        onNotify?.('warn', message);
        return null;
      } finally {
        setAiBusy(false);
      }
    }, [parseCtx, parsePreset, persistDraft, pipeText, preview, normalizedByAi, onNotify]);

    const commitImport = useCallback(
      async (parsed: PendingBulkImport, mode: 'replace' | 'append') => {
        const replace = mode === 'replace';
        const latestRows = rowsRef.current;
        let result = applyStoryboardBulkImport(
          fieldCatalog,
          latestRows,
          parsed.rows,
          replace ? 'replace' : 'append'
        );

        let structuredOk = 0;
        let structuredFail = 0;
        let structuredSkipped = 0;
        if (parsePreset && parseCtx && result.touchedRowIds.length) {
          const touched = new Set(result.touchedRowIds);
          const needsLlm = result.rows.filter(
            (row) =>
              touched.has(row.id) &&
              (row.shotRaw || '').trim() &&
              !rowHasStructuredFieldValues(result.catalog, row)
          );
          structuredSkipped = result.rows.filter(
            (row) => touched.has(row.id) && rowHasStructuredFieldValues(result.catalog, row)
          ).length;
          if (needsLlm.length) {
            const strictCatalog = !replace && fieldCatalog.length > 0;
            const bulkSource = pipeText.trim();
            onNotify?.(
              'info',
              bulkSource.length <= STORYBOARD_BULK_PARSE_MAX_CHARS
                ? `结构化解析中（${needsLlm.length} 镜，单次请求）…`
                : `结构化解析中（${needsLlm.length} 镜，文本较长分批处理）…`
            );
            try {
              if (bulkSource.length <= STORYBOARD_BULK_PARSE_MAX_CHARS) {
                const bulkParsed = await parseStoryboardBulkStructuredWithPreset(
                  bulkSource,
                  parsePreset,
                  parseCtx,
                  {
                    fieldCatalog: result.catalog,
                    strictCatalog,
                  }
                );
                const merged = mergeBulkStructuredParseIntoTable(
                  result.rows,
                  result.catalog,
                  bulkParsed,
                  {
                    targetRowIds: touched,
                    preserveCatalog: strictCatalog,
                    skipIfHasStructuredFields: true,
                  }
                );
                result = {
                  ...result,
                  catalog: merged.catalog,
                  rows: merged.rows,
                };
                structuredOk = merged.results.filter((item) => item.ok).length;
                structuredFail = merged.results.filter((item) => !item.ok).length;
              } else {
                const batch = await parseStoryboardRowsBatch(
                  result.rows,
                  result.catalog,
                  parsePreset,
                  parseCtx,
                  {
                    shouldSkip: (row) =>
                      !touched.has(row.id) ||
                      !(row.shotRaw || '').trim() ||
                      rowHasStructuredFieldValues(result.catalog, row),
                    strictCatalog,
                  }
                );
                result = {
                  ...result,
                  catalog: batch.catalog,
                  rows: batch.rows,
                };
                structuredOk = batch.results.filter((item) => item.ok).length;
                structuredFail = batch.results.filter((item) => !item.ok).length;
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              onNotify?.('warn', `结构化解析未完成：${message}`);
            }
          }
        }

        onImport({ catalog: result.catalog, rows: result.rows });
        const detail = { rowCount: parsed.rows.length, appended: !replace };
        const sourceHint = parsed.source === 'ai' ? '（AI）' : '';
        const warnParts: string[] = [];
        if (parsed.errors[0]) warnParts.push(parsed.errors[0]);
        if (parsed.duplicateShotNos.length) {
          warnParts.push(`重复镜号：${parsed.duplicateShotNos.join('、')}`);
        }
        if (structuredFail) warnParts.push(`${structuredFail} 镜结构化解析失败`);
        if (!parsePreset || !parseCtx) {
          warnParts.push('未配置解析预设，仅写入原文与规则字段');
        }
        onNotify?.(
          parsed.duplicateShotNos.length || warnParts.length ? 'warn' : 'info',
          `已填充 ${parsed.rows.length} 镜${sourceHint}${replace ? '' : '（按镜号合并）'}${structuredOk ? `，AI 结构化 ${structuredOk} 镜` : ''}${structuredSkipped && !structuredOk ? `，${structuredSkipped} 镜规则解析` : ''}${warnParts.length ? `；${warnParts.join('；')}` : ''}`
        );
        queueMicrotask(() => onParseComplete?.(detail));
      },
      [fieldCatalog, onImport, onNotify, onParseComplete, parseCtx, parsePreset, pipeText]
    );

    const parseAndFill = useCallback(async () => {
      if (readOnly || busy) return;
      if (!pipeText.trim()) {
        onNotify?.('warn', '请先输入分镜文本');
        return;
      }

      setImportBusy(true);
      try {
        let parsed = await resolveParsedForImport();
        if (!parsed?.rows.length && canUseAi) {
          const aiParsed = await runAiNormalize();
          if (aiParsed?.rows.length) {
            parsed = { ...aiParsed, source: 'ai' };
          }
        }
        if (!parsed?.rows.length) {
          onNotify?.('warn', parsed?.errors[0] || aiRejectReason || '未解析到有效镜头');
          return;
        }

        const latestRows = rowsRef.current;
        const hasTextBaseline = latestRows.some(
          (row) =>
            (row.shotRaw || '').trim() ||
            Object.values(row.shotFields || {}).some((value) => String(value || '').trim())
        );
        const hasFrameBaseline = latestRows.some(storyboardRowHasFrameRef);
        const hasExisting = latestRows.some(rowHasStoryboardBulkImportBaseline);

        if (hasTextBaseline) {
          setPendingImport(parsed);
          return;
        }
        if (hasFrameBaseline && latestRows.length > 0) {
          await commitImport(parsed, 'append');
          return;
        }
        if (hasExisting) {
          setPendingImport(parsed);
          return;
        }

        await commitImport(parsed, 'replace');
      } finally {
        setImportBusy(false);
      }
    }, [
      aiRejectReason,
      busy,
      canUseAi,
      commitImport,
      onNotify,
      readOnly,
      resolveParsedForImport,
      runAiNormalize,
      pipeText,
    ]);

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

    useImperativeHandle(ref, () => ({ parseAndFill }), [parseAndFill]);

    const statusHint = preview?.rows.length
      ? `已识别 ${preview.rows.length} 镜${normalizedByAi ? ' · AI' : ''}${
          preview.duplicateShotNos.length
            ? ` · 重复 ${preview.duplicateShotNos.join('、')}`
            : ''
        }`
      : null;

    const hasBulkIssues = Boolean(
      preview?.duplicateShotGroups.length || preview?.lineErrors.length || preview?.errors[0]
    );

    return (
      <>
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

        {aiRejectReason ? (
          <p className="-mt-2 text-[10px] text-amber-300/90">{aiRejectReason}</p>
        ) : hasBulkIssues ? (
          <div className="-mt-2 space-y-1 text-[10px] text-amber-300/90">
            {preview?.duplicateShotGroups.slice(0, BULK_ISSUE_PREVIEW_LIMIT).map((group) => (
              <p key={group.shotNo}>
                重复镜号 {group.shotNo}：
                {group.lines.map((line, index) => (
                  <span key={`${group.shotNo}-${line.lineNo}`}>
                    {index > 0 ? ' · ' : ' '}
                    第 {line.lineNo} 行
                    <BulkLocateButton
                      readOnly={readOnly}
                      onClick={() => focusBulkLineByNo(textareaRef.current, pipeText, line.lineNo)}
                    />
                  </span>
                ))}
              </p>
            ))}
            {preview && preview.duplicateShotGroups.length > BULK_ISSUE_PREVIEW_LIMIT ? (
              <p>另有 {preview.duplicateShotGroups.length - BULK_ISSUE_PREVIEW_LIMIT} 组重复镜号</p>
            ) : null}

            {preview?.lineErrors.slice(0, BULK_ISSUE_PREVIEW_LIMIT).map((entry) => (
              <p key={`${entry.lineNo}-${entry.charStart}`}>
                第 {entry.lineNo} 行{entry.message}（空白行不计）：「{entry.preview}」
                <BulkLocateButton
                  readOnly={readOnly}
                  onClick={() => focusBulkLineError(textareaRef.current, pipeText, entry)}
                />
              </p>
            ))}
            {preview && preview.lineErrors.length > BULK_ISSUE_PREVIEW_LIMIT ? (
              <p>另有 {preview.lineErrors.length - BULK_ISSUE_PREVIEW_LIMIT} 行无效</p>
            ) : null}

            {!preview?.duplicateShotGroups.length &&
            !preview?.lineErrors.length &&
            preview?.errors[0] ? (
              <p>{preview.errors[0]}</p>
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
