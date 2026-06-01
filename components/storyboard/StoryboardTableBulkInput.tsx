import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardRoleAsset, StoryboardTableRow } from '../../types';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import StoryboardRoleAssetStrip from './StoryboardRoleAssetStrip';

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  roleAssets: StoryboardRoleAsset[];
  roleAssetBusyId?: string | null;
  parsePreset?: CustomAppModule | null;
  parseCtx?: CapabilityExecuteContext;
  readOnly?: boolean;
  onImport: (result: { catalog: StoryboardParseFieldDef[]; rows: StoryboardTableRow[] }) => void;
  onDraftChange?: () => void;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
  onAddRoleAsset: () => void;
  onRemoveRoleAsset: (id: string) => void;
  onRenameRoleAsset: (id: string, name: string) => void;
  onAssignRoleAssetImage: (id: string, file: File) => void;
  onClearRoleAssetImage: (id: string) => void;
  onPreviewRoleAssetImage?: (src: string) => void;
};

const PIPE_PLACEHOLDER = `可直接粘贴任意格式分镜文本，点「AI 识别」会先判定是否为分镜脚本，再规范化为表格。

示例（规范化后）：
镜头号 | 景别 | 角度 | 运镜 | 时长 | 画面内容 | 对白 | 服化道建议 | 光影设计
SC01_SH001 | 大远景 | 平视 | 固定 | 3.0s | 清北市夜景全景，万家灯火，高楼林立 | - | - | 暖黄色城市灯光`;

function draftStorageKey(assetId: string): string {
  return storyboardBulkDraftStorageKey(assetId);
}

function defaultDraft(): StoryboardBulkDraft {
  return defaultStoryboardBulkDraft();
}

export default function StoryboardTableBulkInput({
  assetId,
  rows,
  fieldCatalog,
  roleAssets,
  roleAssetBusyId = null,
  parsePreset = null,
  parseCtx,
  readOnly = false,
  onImport,
  onDraftChange,
  onNotify,
  onAddRoleAsset,
  onRemoveRoleAsset,
  onRenameRoleAsset,
  onAssignRoleAssetImage,
  onClearRoleAssetImage,
  onPreviewRoleAssetImage,
}: Props) {
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
      onNotify?.('info', `已规范化为 ${result.parsed.rows.length} 镜，可核对后导入`);
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

  const handleAiDetect = () => {
    if (readOnly || aiBusy || importBusy) return;
    void runAiNormalize();
  };

  const handleImport = () => {
    if (readOnly || importBusy || aiBusy) return;

    const importParsed = async () => {
      const parsed = await resolveParsedForImport();
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

      setImportBusy(true);
      try {
        const result = applyStoryboardBulkImport(
          fieldCatalog,
          rows,
          parsed.rows,
          replace ? 'replace' : 'append'
        );
        onImport(result);
        const sourceHint = parsed.source === 'ai' ? '（AI 规范化）' : '';
        const warn = parsed.errors[0];
        onNotify?.(
          'info',
          `已导入 ${parsed.rows.length} 镜${sourceHint}${replace ? '' : '（追加）'}${warn ? `；${warn}` : ''}`
        );
      } finally {
        setImportBusy(false);
      }
    };

    void importParsed();
  };

  const busy = importBusy || aiBusy;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2.5">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold text-gray-400">解析</span>
        <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-gray-200 ring-1 ring-white/12">
          分镜文本
        </span>
        {preview?.rows.length ? (
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-gray-400">
            已识别 {preview.rows.length} 镜
            {normalizedByAi ? ' · AI' : ''}
          </span>
        ) : null}
        {canUseAi ? (
          <button
            type="button"
            disabled={readOnly || busy || !pipeText.trim()}
            onClick={handleAiDetect}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} ml-auto h-7 px-2.5 text-[10px]`}
          >
            {aiBusy ? 'AI 识别中…' : 'AI 识别'}
          </button>
        ) : null}
        <button
          type="button"
          disabled={readOnly || busy}
          onClick={handleImport}
          className={`${STORYBOARD_TOOL_BTN_PRIMARY} ${canUseAi ? '' : 'ml-auto'} h-7 px-2.5 text-[10px]`}
        >
          {importBusy ? '导入中…' : '导入到镜头'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col space-y-1.5 overflow-hidden">
          <textarea
            value={pipeText}
            readOnly={readOnly}
            placeholder={PIPE_PLACEHOLDER}
            onChange={(event) => handleTextChange(event.target.value)}
            className={`${STORYBOARD_FIELD_INPUT} min-h-[8rem] flex-1 resize-none font-mono text-[10px] leading-relaxed`}
          />
          {aiRejectReason ? (
            <p className="shrink-0 text-[9px] text-amber-300/90">{aiRejectReason}</p>
          ) : preview?.errors.length ? (
            <p className="shrink-0 text-[9px] text-amber-300/90">{preview.errors[0]}</p>
          ) : null}
          {canUseAi ? (
            <p className="shrink-0 text-[9px] text-gray-600">
              「AI 识别」：先判定是否为分镜脚本，是则规范化为管道符表格；已是标准表格可直接导入。导入时若规则未识别会自动走 AI。
            </p>
          ) : (
            <p className="shrink-0 text-[9px] text-gray-600">管道符分隔；首行可为列名；「-」视为空。</p>
          )}
        </div>

        <div className="mt-2 shrink-0 border-t border-white/[0.06] pt-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-400">角色资产</span>
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-gray-400">
              {roleAssets.length} 个
            </span>
          </div>
          <StoryboardRoleAssetStrip
            roleAssets={roleAssets}
            readOnly={readOnly}
            busyId={roleAssetBusyId}
            onAdd={onAddRoleAsset}
            onRemove={onRemoveRoleAsset}
            onRename={onRenameRoleAsset}
            onAssignImage={onAssignRoleAssetImage}
            onClearImage={onClearRoleAssetImage}
            onPreviewImage={onPreviewRoleAssetImage}
          />
        </div>
      </div>
    </div>
  );
}
