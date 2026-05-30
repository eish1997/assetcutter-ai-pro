import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomAppModule, StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { CustomDropdown } from '../ui/CustomDropdown';
import {
  readLocalJson,
  scopedStorageKey,
  writeLocalJson,
} from '../../services/clientPersist';
import type { StoryboardSheetGenBatchRequest } from '../../services/storyboardTableSheetGen';
import type { StoryboardSheetPreviewItem } from '../../services/storyboardSheetPreview';
import { readStoryboardFrameFromFile } from './storyboardFrameImage';
import type { StoryboardBulkTextMode } from '../../services/storyboardTableBulkImport';
import {
  defaultStoryboardBulkDraft,
  storyboardBulkDraftStorageKey,
  type StoryboardBulkDraft,
} from '../../services/storyboardTableInput';
import {
  normalizeShotsPerSheet,
  planStoryboardSheetGenTasks,
  resolveSheetGenSourceRows,
  sheetGenTaskCount,
  STORYBOARD_SHEET_GEN_EXTRA_PROMPT_KEY,
  STORYBOARD_SHEET_SHOTS_PER_IMAGE_KEY,
  STORYBOARD_SHEET_SHOTS_PER_IMAGE_OPTIONS,
} from '../../services/storyboardTableSheetGen';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_LABEL,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';

function sheetShotsStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_SHEET_SHOTS_PER_IMAGE_KEY}__${assetId}`, null);
}

function sheetPromptStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_SHEET_GEN_EXTRA_PROMPT_KEY}__${assetId}`, null);
}

type Props = {
  assetId: string;
  draftTick?: number;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  redrawPresets: CustomAppModule[];
  effectiveRedrawPresetId: string;
  readOnly?: boolean;
  busy?: boolean;
  progress?: { done: number; total: number } | null;
  dropdownZIndex?: { backdrop: number; list: number };
  onPresetChange: (presetId: string) => void;
  onRun: (request: StoryboardSheetGenBatchRequest) => Promise<void>;
  sheetPreviews?: StoryboardSheetPreviewItem[];
  sheetSplitBusyId?: string | null;
  onPreviewImage?: (src: string) => void;
  onUploadSheet?: (dataUrl: string) => void;
  onApplySheet?: (previewId: string) => Promise<void>;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
};

function readBulkDraft(assetId: string): StoryboardBulkDraft {
  return readLocalJson(storyboardBulkDraftStorageKey(assetId), defaultStoryboardBulkDraft());
}

export default function StoryboardTableSheetGen({
  assetId,
  draftTick = 0,
  rows,
  fieldCatalog,
  redrawPresets,
  effectiveRedrawPresetId,
  readOnly = false,
  busy = false,
  progress = null,
  dropdownZIndex,
  onPresetChange,
  onRun,
  sheetPreviews = [],
  sheetSplitBusyId = null,
  onPreviewImage,
  onUploadSheet,
  onApplySheet,
  onNotify,
}: Props) {
  const refFileInput = useRef<HTMLInputElement>(null);
  const sheetUploadRef = useRef<HTMLInputElement>(null);
  const [shotsPerSheet, setShotsPerSheet] = useState(25);
  const [promptExtra, setPromptExtra] = useState('');
  const [localRefImage, setLocalRefImage] = useState<string | undefined>();
  const bulkDraft = useMemo(() => readBulkDraft(assetId), [assetId, draftTick]);

  useEffect(() => {
    setShotsPerSheet(
      normalizeShotsPerSheet(readLocalJson(sheetShotsStorageKey(assetId), 25, (v) => v))
    );
    setPromptExtra(readLocalJson(sheetPromptStorageKey(assetId), '', (v) => (typeof v === 'string' ? v : null)));
    setLocalRefImage(undefined);
  }, [assetId]);

  const bulkText = bulkDraft.pipeText;
  const bulkMode: StoryboardBulkTextMode = 'pipe';

  const source = useMemo(
    () => resolveSheetGenSourceRows(rows, bulkText, bulkMode, fieldCatalog),
    [bulkMode, bulkText, fieldCatalog, rows]
  );

  const tasks = useMemo(
    () => planStoryboardSheetGenTasks(source.rows, shotsPerSheet),
    [shotsPerSheet, source.rows]
  );

  const referenceImage = localRefImage || bulkDraft.imageDataUrl;

  const presetOptions = useMemo(
    () => redrawPresets.map((preset) => ({ value: preset.id, label: preset.label || preset.id })),
    [redrawPresets]
  );

  const shotsOptions = useMemo(
    () =>
      STORYBOARD_SHEET_SHOTS_PER_IMAGE_OPTIONS.map((value) => ({
        value: String(value),
        label: `每图 ${value} 镜`,
      })),
    []
  );

  const handleShotsChange = (value: string) => {
    const next = normalizeShotsPerSheet(value);
    setShotsPerSheet(next);
    writeLocalJson(sheetShotsStorageKey(assetId), next);
  };

  const handlePromptChange = (value: string) => {
    setPromptExtra(value);
    writeLocalJson(sheetPromptStorageKey(assetId), value);
  };

  const handlePresetChange = (value: string) => {
    onPresetChange(value);
  };

  const handleRefFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      onNotify?.('warn', '请选择图片文件');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      onNotify?.('warn', '图片过大，请小于 12MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (dataUrl) setLocalRefImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRun = useCallback(async () => {
    if (readOnly || busy) return;
    if (!effectiveRedrawPresetId) {
      onNotify?.('warn', '请选择生图能力');
      return;
    }
    if (!source.rows.length) {
      onNotify?.('warn', '请先在左侧输入分镜文本并导入，或填写可生成提示词的镜头');
      return;
    }
    if (!tasks.length) {
      onNotify?.('warn', '没有可执行的生成任务');
      return;
    }

    const preset = redrawPresets.find((item) => item.id === effectiveRedrawPresetId);
    if (!preset) {
      onNotify?.('warn', '生图能力无效');
      return;
    }
    if (preset.category === 'image_to_image' && !referenceImage) {
      onNotify?.('warn', '图生图需上传参考分镜图（本区参考图）');
      return;
    }

    await onRun({
      presetId: effectiveRedrawPresetId,
      shotsPerSheet,
      promptExtra,
      referenceImageDataUrl: referenceImage,
      sourceRows: source.rows,
      fieldCatalog: source.catalog,
    });
  }, [
    busy,
    effectiveRedrawPresetId,
    onNotify,
    onRun,
    promptExtra,
    readOnly,
    redrawPresets,
    referenceImage,
    shotsPerSheet,
    source.catalog,
    source.rows,
    tasks.length,
  ]);

  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!sheetPreviews.length) {
      setSelectedPreviewId(null);
      return;
    }
    if (!selectedPreviewId || !sheetPreviews.some((item) => item.id === selectedPreviewId)) {
      setSelectedPreviewId(sheetPreviews[0]!.id);
    }
  }, [selectedPreviewId, sheetPreviews]);

  const taskTotal = sheetGenTaskCount(source.rows.length, shotsPerSheet);
  const activePreview =
    sheetPreviews.find((item) => item.id === selectedPreviewId) ?? sheetPreviews[0] ?? null;

  const handleSheetUpload = async (file: File | undefined) => {
    if (!file || readOnly || busy) return;
    try {
      const dataUrl = await readStoryboardFrameFromFile(file);
      onUploadSheet?.(dataUrl);
    } catch (error) {
      onNotify?.('warn', error instanceof Error ? error.message : '上传失败');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2.5">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold text-gray-400">生图</span>
        {source.rows.length > 0 ? (
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-gray-400">
            {source.rows.length} 镜 ÷ {shotsPerSheet} = {taskTotal} 张图
            {source.source === 'draft' ? ' · 来自草稿' : ''}
          </span>
        ) : (
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-gray-600">
            等待分镜输入
          </span>
        )}
        {busy && progress ? (
          <span className="text-[9px] text-violet-300/90">
            生成中 {progress.done}/{progress.total}
          </span>
        ) : null}
        <button
          type="button"
          disabled={readOnly || busy || !tasks.length || !redrawPresets.length}
          onClick={() => void handleRun()}
          className={`${STORYBOARD_TOOL_BTN_PRIMARY} ml-auto h-7 px-2.5 text-[10px]`}
        >
          {busy ? '生成中…' : `执行 ${tasks.length || taskTotal} 个任务`}
        </button>
      </div>

      <div className="mb-2 flex min-h-[12rem] flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-black/30">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-2.5 py-1.5">
          <span className="text-[10px] font-semibold text-gray-300">AI 拼图</span>
          <div className="flex items-center gap-1.5">
            <input
              ref={sheetUploadRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void handleSheetUpload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={() => sheetUploadRef.current?.click()}
              className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-6 px-2 text-[9px]`}
            >
              上传拼图
            </button>
            {activePreview && onApplySheet ? (
              <button
                type="button"
                disabled={readOnly || busy || sheetSplitBusyId != null}
                onClick={() => void onApplySheet(activePreview.id)}
                className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-6 px-2 text-[9px]`}
              >
                {sheetSplitBusyId === activePreview.id ? '切分中…' : '切分回填'}
              </button>
            ) : null}
            {activePreview && onPreviewImage ? (
              <button
                type="button"
                onClick={() => onPreviewImage(activePreview.imageDataUrl)}
                className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-6 px-2 text-[9px]`}
              >
                放大
              </button>
            ) : null}
          </div>
        </div>

        {activePreview ? (
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black/40">
            <img
              src={activePreview.imageDataUrl}
              alt={activePreview.label}
              className="h-full w-full object-contain"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-2.5 py-1.5">
              <span className="text-[9px] text-gray-200">{activePreview.label}</span>
              <span className="text-[9px] text-gray-400">
                回填 {activePreview.matchedCount}/{activePreview.shotNos.length || activePreview.rowIds.length} 镜
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-3 py-4 text-center text-[10px] text-gray-600">
            AI 手绘拼图：点「执行生图」或「上传拼图」后在此预览与切分回填
          </div>
        )}

        {sheetPreviews.length > 0 ? (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-white/[0.06] px-2 py-1.5">
            {sheetPreviews.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedPreviewId(item.id)}
                className={`shrink-0 overflow-hidden rounded-md border ${
                  activePreview?.id === item.id
                    ? 'border-violet-500/60 ring-1 ring-violet-500/30'
                    : 'border-white/[0.08]'
                }`}
              >
                <img src={item.imageDataUrl} alt={item.label} className="h-10 w-16 object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 max-h-[min(42%,16rem)] shrink-0 overflow-y-auto border-t border-white/[0.06] pt-2 no-scrollbar">
        <div className="flex flex-col gap-2">
          <div>
            <label className={STORYBOARD_LABEL}>每张图镜头数</label>
            <CustomDropdown
              value={String(shotsPerSheet)}
              options={shotsOptions}
              onChange={handleShotsChange}
              disabled={readOnly || busy}
              triggerClassName="h-8 w-full rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
              portalZIndex={dropdownZIndex}
            />
          </div>
          <div>
            <label className={STORYBOARD_LABEL}>生图能力</label>
            <CustomDropdown
              value={effectiveRedrawPresetId}
              options={presetOptions}
              onChange={handlePresetChange}
              disabled={readOnly || busy || !presetOptions.length}
              triggerClassName="h-8 w-full rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
              portalZIndex={dropdownZIndex}
            />
          </div>
        </div>

        <div>
          <label className={STORYBOARD_LABEL}>附加提示词</label>
          <textarea
            value={promptExtra}
            readOnly={readOnly || busy}
            rows={2}
            placeholder="手绘风格、画幅比例等；排版已默认紧凑（小字顶栏+底栏、少留白）"
            onChange={(event) => handlePromptChange(event.target.value)}
            className={`${STORYBOARD_FIELD_INPUT} min-h-[3rem] resize-y text-[10px]`}
          />
        </div>

        <div>
          <label className={STORYBOARD_LABEL}>参考图（可选，叠加在上方分镜图之上）</label>
          <input
            ref={refFileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              handleRefFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {referenceImage ? (
            <div className="mb-1.5 overflow-hidden rounded-lg border border-white/[0.08] bg-black/30">
              <img src={referenceImage} alt="生图参考" className="max-h-24 w-full object-contain" />
            </div>
          ) : (
            <p className="mb-1.5 text-[9px] text-gray-600">
              图生图时使用；优先本区上传参考图。
            </p>
          )}
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => refFileInput.current?.click()}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-7 px-2.5 text-[10px]`}
          >
            {referenceImage ? '更换参考图' : '上传参考图'}
          </button>
        </div>

        {tasks.length > 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <p className="mb-1 text-[9px] font-semibold text-gray-500">任务预览</p>
            <div className="flex flex-col gap-1">
              {tasks.map((task) => (
                <p key={task.chunkIndex} className="text-[9px] text-gray-400">
                  任务 {task.chunkIndex + 1}：镜头{' '}
                  {task.rows
                    .map((row) => row.shotNo?.trim() || `${row.index + 1}`)
                    .join('、')}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
