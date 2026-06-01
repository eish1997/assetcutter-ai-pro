import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StoryboardSheetGenBatchPreview } from '../../services/storyboardTableSheetGen';
import { CustomDropdown } from '../ui/CustomDropdown';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_LABEL,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

type DropdownOption = { value: string; label: string };

/** 须高于本弹窗 `z-[2175]`，否则 Portal 列表落在遮罩下方不可见 */
const SHEET_GEN_CONFIRM_DROPDOWN_Z = { backdrop: 2182, list: 2183 };

type Props = {
  open: boolean;
  busy?: boolean;
  readOnly?: boolean;
  presetLabel: string;
  presetInstruction: string;
  directSend: boolean;
  shotsPerSheet: number;
  shotsOptions: DropdownOption[];
  onShotsPerSheetChange: (value: string) => void;
  presetId: string;
  presetOptions: DropdownOption[];
  onPresetChange: (value: string) => void;
  shotCount: number;
  taskCount: number;
  batches: StoryboardSheetGenBatchPreview[];
  onClose: () => void;
  onConfirm: (selectedChunkIndexes: number[]) => void;
};

export default function StoryboardSheetGenConfirmModal({
  open,
  busy = false,
  readOnly = false,
  presetLabel,
  presetInstruction,
  directSend,
  shotsPerSheet,
  shotsOptions,
  onShotsPerSheetChange,
  presetId,
  presetOptions,
  onPresetChange,
  shotCount,
  taskCount,
  batches,
  onClose,
  onConfirm,
}: Props) {
  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const [selectedChunkIndexes, setSelectedChunkIndexes] = useState<Set<number>>(() => new Set());

  const selectedCount = selectedChunkIndexes.size;

  const selectedBatches = useMemo(
    () => batches.filter((item) => selectedChunkIndexes.has(item.chunkIndex)),
    [batches, selectedChunkIndexes]
  );

  const canConfirm = useMemo(
    () => selectedBatches.length > 0 && selectedBatches.every((item) => item.validationOk),
    [selectedBatches]
  );

  const batchSelectionKey = useMemo(
    () => batches.map((item) => item.chunkIndex).join(','),
    [batches]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedChunkIndexes(new Set(batches.map((item) => item.chunkIndex)));
    setActiveBatchIndex(0);
  }, [open, batchSelectionKey, shotsPerSheet, presetId, batches]);

  const toggleBatchSelection = useCallback((chunkIndex: number) => {
    setSelectedChunkIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(chunkIndex)) next.delete(chunkIndex);
      else next.add(chunkIndex);
      return next;
    });
  }, []);

  const selectAllBatches = useCallback(() => {
    setSelectedChunkIndexes(new Set(batches.map((item) => item.chunkIndex)));
  }, [batches]);

  const clearBatchSelection = useCallback(() => {
    setSelectedChunkIndexes(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm([...selectedChunkIndexes].sort((a, b) => a - b));
  }, [onConfirm, selectedChunkIndexes]);

  const onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    },
    [busy, onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onEscape]);

  if (!open || typeof document === 'undefined') return null;

  const activeBatch = batches[activeBatchIndex] ?? batches[0] ?? null;
  const presetInstructionTrimmed = presetInstruction.trim();

  return createPortal(
    <div
      className="fixed inset-0 z-[2175] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="flex max-h-[min(88vh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0e]/95 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storyboard-sheet-gen-confirm-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <div className="min-w-0">
            <h2
              id="storyboard-sheet-gen-confirm-title"
              className="text-[11px] font-semibold text-gray-100"
            >
              确认执行任务
            </h2>
            <p className="mt-1 text-[9px] leading-relaxed text-gray-500">
              调整参数并勾选要生成的批次，预览编译正文后确认执行。
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white/[0.06] hover:text-gray-200 disabled:opacity-40"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-white/[0.08] bg-white/[0.04] px-4 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={`${STORYBOARD_LABEL} text-gray-300`}>每张图镜头数</label>
              <CustomDropdown
                value={String(shotsPerSheet)}
                options={shotsOptions}
                onChange={onShotsPerSheetChange}
                disabled={readOnly || busy}
                triggerClassName="h-9 w-full rounded-xl bg-white/[0.06] px-3 text-[11px] font-medium text-gray-100 ring-1 ring-white/[0.12] hover:bg-white/[0.09] flex items-center justify-between"
                portalZIndex={SHEET_GEN_CONFIRM_DROPDOWN_Z}
              />
            </div>
            <div>
              <label className={`${STORYBOARD_LABEL} text-gray-300`}>生图能力</label>
              <CustomDropdown
                value={presetId}
                options={presetOptions}
                onChange={onPresetChange}
                disabled={readOnly || busy || !presetOptions.length}
                triggerClassName="h-9 w-full rounded-xl bg-white/[0.06] px-3 text-[11px] font-medium text-gray-100 ring-1 ring-white/[0.12] hover:bg-white/[0.09] flex items-center justify-between"
                portalZIndex={SHEET_GEN_CONFIRM_DROPDOWN_Z}
              />
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {shotCount > 0 ? (
              <span className="text-[10px] font-medium text-gray-300">
                {shotCount} 镜 ÷ {shotsPerSheet} = {taskCount} 张拼图
                {batches.length > 1 ? ` · 已选 ${selectedCount}/${batches.length} 批` : ''}
              </span>
            ) : null}
            <span
              className={`rounded-md px-2 py-0.5 text-[9px] ${
                directSend
                  ? 'bg-emerald-500/10 text-emerald-300/90 ring-1 ring-emerald-400/15'
                  : 'bg-amber-500/10 text-amber-300/90 ring-1 ring-amber-400/15'
              }`}
            >
              {directSend ? '直发提示词' : '理解后送模'}
            </span>
            {presetLabel ? (
              <span className="truncate text-[9px] text-gray-500">当前：{presetLabel}</span>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 space-y-2 border-b border-white/[0.06] px-4 py-2.5">
          {presetInstructionTrimmed ? (
            <div className="rounded-lg border border-white/[0.06] bg-black/30 px-2.5 py-2">
              <p className="mb-1 text-[9px] font-semibold text-gray-500">预设 instruction</p>
              <pre className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-relaxed text-gray-300 no-scrollbar">
                {presetInstructionTrimmed}
              </pre>
            </div>
          ) : null}
          {!directSend ? (
            <p className="text-[9px] leading-relaxed text-amber-300/85">
              当前预设未开启「直发提示词」：下方编译正文会先经理解步骤改写，生图模型收到的不是下方全文。多镜拼图请改为直发后再执行。
            </p>
          ) : null}
          {!canConfirm ? (
            <p className="text-[9px] leading-relaxed text-red-300/90">
              {selectedCount === 0
                ? '请至少勾选一个批次。'
                : '所选批次中存在无法执行的任务（超限或未直发），请调整参数或取消勾选后重试。'}
            </p>
          ) : null}
        </div>

        {batches.length > 0 ? (
          <div className="shrink-0 border-b border-white/[0.06] px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[9px] text-gray-500">勾选要生成的批次</span>
              {batches.length > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={selectAllBatches}
                    className="text-[9px] text-gray-400 transition-colors hover:text-gray-200 disabled:opacity-40"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={clearBatchSelection}
                    className="text-[9px] text-gray-400 transition-colors hover:text-gray-200 disabled:opacity-40"
                  >
                    清空
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {batches.map((batch, index) => {
                const selected = selectedChunkIndexes.has(batch.chunkIndex);
                return (
                  <div
                    key={batch.chunkIndex}
                    className={`flex shrink-0 items-center gap-1 rounded-md pr-1 transition ${
                      activeBatchIndex === index ? 'bg-white/[0.08] ring-1 ring-white/15' : 'bg-white/[0.03]'
                    } ${!selected ? 'opacity-55' : ''}`}
                  >
                    <button
                      type="button"
                      aria-label={selected ? `取消勾选批 ${batch.chunkIndex + 1}` : `勾选批 ${batch.chunkIndex + 1}`}
                      disabled={busy}
                      onClick={() => toggleBatchSelection(batch.chunkIndex)}
                      className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[9px] transition ${
                        selected
                          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-white/15 bg-black/20 text-transparent hover:border-white/25'
                      } disabled:opacity-40`}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveBatchIndex(index)}
                      className={`shrink-0 rounded-md px-1.5 py-1 text-[9px] transition ${
                        batch.validationOk
                          ? 'text-gray-300 hover:text-white'
                          : 'text-red-300/90'
                      }`}
                    >
                      批 {batch.chunkIndex + 1}
                      {!batch.validationOk ? ' !' : ''}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 no-scrollbar">
          {activeBatch ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold text-gray-200">
                  批 {activeBatch.chunkIndex + 1} · {activeBatch.shotCount} 镜
                </span>
                <span className="truncate text-[9px] text-gray-500">{activeBatch.shotLabels}</span>
                <span
                  className={`ml-auto text-[9px] ${
                    activeBatch.stats.mergedChars > activeBatch.stats.sendLimit
                      ? 'text-red-300/90'
                      : 'text-gray-500'
                  }`}
                >
                  送模约 {activeBatch.stats.mergedChars} 字（正文 {activeBatch.stats.compiledChars} + 预设{' '}
                  {activeBatch.stats.presetChars}，上限 {activeBatch.stats.sendLimit}）
                </span>
              </div>
              {activeBatch.validationError ? (
                <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-2 text-[9px] leading-relaxed text-red-200/90">
                  {activeBatch.validationError}
                </p>
              ) : null}
              <div>
                <label className="mb-1 block text-[9px] font-semibold text-gray-500">
                  编译正文（左侧分镜按每图 {shotsPerSheet} 镜切分）
                </label>
                <textarea
                  readOnly
                  value={activeBatch.compiledPrompt}
                  rows={10}
                  className={`${STORYBOARD_FIELD_INPUT} min-h-[10rem] resize-none font-mono text-[9px] leading-relaxed`}
                />
              </div>
              {activeBatch.directSend ? (
                <div>
                  <label className="mb-1 block text-[9px] font-semibold text-gray-500">
                    送生图模型（预设 + 编译正文）
                  </label>
                  <textarea
                    readOnly
                    value={activeBatch.mergedImagePrompt}
                    rows={12}
                    className={`${STORYBOARD_FIELD_INPUT} min-h-[12rem] resize-none font-mono text-[9px] leading-relaxed text-gray-200`}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-8 px-3 text-[10px] disabled:opacity-40`}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !canConfirm}
            onClick={handleConfirm}
            className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-8 px-3 text-[10px] disabled:opacity-40`}
          >
            {busy
              ? '生成中…'
              : `确认执行 ${selectedCount || taskCount} 个任务`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
