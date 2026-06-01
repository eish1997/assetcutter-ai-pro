import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
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
  type StoryboardBulkParseResult,
} from '../../services/storyboardTableBulkImport';
import {
  normalizeStoryboardBulkWithAi,
  parseStoryboardBulkTextWithAiFallback,
} from '../../services/storyboardTableBulkAiDetect';
import type { CapabilityExecuteContext } from '../../services/capabilityExecutor';
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { STORYBOARD_FIELD_INPUT } from './storyboardTableUi';

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

const PIPE_PLACEHOLDER = `粘贴分镜脚本，支持任意格式。点击「识别解析并填充」自动识别并写入镜头表。`;

function draftStorageKey(assetId: string): string {
  return storyboardBulkDraftStorageKey(assetId);
}

function defaultDraft(): StoryboardBulkDraft {
  return defaultStoryboardBulkDraft();
}

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
    const busy = importBusy || aiBusy;

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

        const hasExisting = rows.some(
          (row) =>
            (row.shotRaw || '').trim() ||
            Object.values(row.shotFields || {}).some((value) => String(value || '').trim())
        );
        const replace =
          !hasExisting ||
          typeof window === 'undefined' ||
          window.confirm(`将导入 ${parsed.rows.length} 镜。覆盖当前 ${rows.length} 镜？取消则追加到末尾。`);

        const result = applyStoryboardBulkImport(
          fieldCatalog,
          rows,
          parsed.rows,
          replace ? 'replace' : 'append'
        );
        onImport(result);
        const detail = { rowCount: parsed.rows.length, appended: !replace };
        const sourceHint = parsed.source === 'ai' ? '（AI）' : '';
        const warn = parsed.errors[0];
        onNotify?.(
          'info',
          `已填充 ${parsed.rows.length} 镜${sourceHint}${replace ? '' : '（追加）'}${warn ? `；${warn}` : ''}`
        );
        queueMicrotask(() => onParseComplete?.(detail));
      } finally {
        setImportBusy(false);
      }
    }, [
      aiRejectReason,
      busy,
      canUseAi,
      fieldCatalog,
      onImport,
      onNotify,
      onParseComplete,
      readOnly,
      resolveParsedForImport,
      rows,
      runAiNormalize,
      pipeText,
    ]);

    useImperativeHandle(ref, () => ({ parseAndFill }), [parseAndFill]);

    const statusHint = preview?.rows.length
      ? `已识别 ${preview.rows.length} 镜${normalizedByAi ? ' · AI' : ''}`
      : null;

    return (
      <>
        <div className="relative">
          <textarea
            value={pipeText}
            readOnly={readOnly}
            placeholder={PIPE_PLACEHOLDER}
            onChange={(event) => handleTextChange(event.target.value)}
            className={`${STORYBOARD_FIELD_INPUT} h-44 w-full resize-none text-[11px] leading-relaxed sm:h-48`}
          />
          {statusHint ? (
            <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/50 px-2 py-0.5 text-[9px] text-gray-400 ring-1 ring-white/[0.08]">
              {statusHint}
            </span>
          ) : null}
        </div>

        {aiRejectReason ? (
          <p className="-mt-2 text-[10px] text-amber-300/90">{aiRejectReason}</p>
        ) : preview?.errors.length ? (
          <p className="-mt-2 text-[10px] text-amber-300/90">{preview.errors[0]}</p>
        ) : null}
      </>
    );
  }
);

export default StoryboardTableBulkInput;
