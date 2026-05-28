import React from 'react';
import type { StoryboardTableRow } from '../../types';
import { storyboardRowOutlineTitle } from './storyboardRowDisplay';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_GAP_INNER,
  STORYBOARD_GAP_TIGHT,
  STORYBOARD_LABEL,
  STORYBOARD_PAD_CARD,
  STORYBOARD_PAD_ROW_BAR,
  STORYBOARD_ROW_ACTION,
  STORYBOARD_ROW_ACTIVE,
  STORYBOARD_ROW_IDLE,
  STORYBOARD_ROW_SHELL,
  STORYBOARD_SCROLL_MT,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';

type Props = {
  row: StoryboardTableRow;
  index: number;
  rowCount: number;
  active: boolean;
  readOnly: boolean;
  imageBusy: boolean;
  onFocusRow: () => void;
  onPatch: (patch: Partial<StoryboardTableRow>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onPreviewImage: (src: string) => void;
  onImageDrop: (e: React.DragEvent) => void;
  onImagePaste: (e: React.ClipboardEvent) => void;
  redrawBusy?: boolean;
  redrawDisabled?: boolean;
  redrawDisabledReason?: string;
  onRedraw?: () => void;
  domId?: string;
};

function parseDurationInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function stopInputFocusBubble(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export default function StoryboardTableRowEditor({
  row,
  index,
  rowCount,
  active,
  readOnly,
  imageBusy,
  onFocusRow,
  onPatch,
  onMove,
  onRemove,
  onPickImage,
  onClearImage,
  onPreviewImage,
  onImageDrop,
  onImagePaste,
  redrawBusy = false,
  redrawDisabled = false,
  redrawDisabledReason,
  onRedraw,
  domId,
}: Props) {
  const img = String(row.frameImage || '').trim();
  const shotLabel = storyboardRowOutlineTitle(row, index);
  const shell = `${STORYBOARD_ROW_SHELL} ${row.locked ? 'opacity-70' : ''} ${
    active ? STORYBOARD_ROW_ACTIVE : STORYBOARD_ROW_IDLE
  }`;

  return (
    <article id={domId} className={`${shell} ${STORYBOARD_SCROLL_MT}`} onFocusCapture={onFocusRow}>
      <div
        className={`flex flex-wrap items-center border-b border-white/[0.05] ${STORYBOARD_PAD_ROW_BAR} ${STORYBOARD_GAP_INNER}`}
      >
        <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg bg-violet-500/15 text-[10px] font-bold text-violet-200/95 ring-1 ring-violet-400/20">
          {index + 1}
        </span>
        <span className="text-[11px] font-semibold text-gray-200">镜头 {shotLabel}</span>
        {row.locked ? (
          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-bold text-amber-200/90">
            已锁定
          </span>
        ) : null}
        {!readOnly ? (
          <div className={`ml-auto flex items-center ${STORYBOARD_GAP_TIGHT}`}>
            <button
              type="button"
              title="上移"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] text-gray-500 hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
            >
              ↑
            </button>
            <button
              type="button"
              title="下移"
              disabled={index >= rowCount - 1}
              onClick={() => onMove(1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] text-gray-500 hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
            >
              ↓
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`grid lg:grid-cols-[minmax(0,1fr)_min(16rem,34%)] lg:items-start ${STORYBOARD_PAD_CARD} ${STORYBOARD_GAP_INNER}`}
      >
        <div className={`min-w-0 ${STORYBOARD_GAP_INNER} flex flex-col`}>
          <div className={`grid max-w-sm grid-cols-2 ${STORYBOARD_GAP_INNER}`}>
            <label className="block">
              <span className={STORYBOARD_LABEL}>镜头号</span>
              <input
                value={row.shotNo ?? ''}
                readOnly={readOnly}
                onChange={(e) => onPatch({ shotNo: e.target.value })}
                onMouseDown={stopInputFocusBubble}
                onFocus={stopInputFocusBubble}
                className={STORYBOARD_FIELD_INPUT}
                placeholder="01"
              />
            </label>
            <label className="block">
              <span className={STORYBOARD_LABEL}>时长</span>
              <div className="relative">
                <input
                  value={row.durationSec != null ? String(row.durationSec) : ''}
                  readOnly={readOnly}
                  onChange={(e) => onPatch({ durationSec: parseDurationInput(e.target.value) })}
                  onMouseDown={stopInputFocusBubble}
                  onFocus={stopInputFocusBubble}
                  className={`${STORYBOARD_FIELD_INPUT} pr-6`}
                  placeholder="—"
                  inputMode="decimal"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-600">
                  秒
                </span>
              </div>
            </label>
          </div>
          <label className="block">
            <span className={STORYBOARD_LABEL}>镜头文本</span>
            <textarea
              value={row.shotText}
              readOnly={readOnly}
              onChange={(e) => onPatch({ shotText: e.target.value })}
              onMouseDown={stopInputFocusBubble}
              onFocus={stopInputFocusBubble}
              rows={3}
              className={`${STORYBOARD_FIELD_INPUT} min-h-[4.25rem] resize-y leading-relaxed`}
              placeholder="画面、动作、对白…"
            />
          </label>
        </div>

        <div className="min-w-0">
          <span className={STORYBOARD_LABEL}>分镜图</span>
          <div
            className={`relative aspect-video overflow-hidden rounded-xl ring-1 ring-white/[0.08] ${
              imageBusy ? 'opacity-60' : ''
            }`}
            onDragOver={(e) => {
              if (readOnly) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              if (readOnly) return;
              onImageDrop(e);
            }}
            onPaste={(e) => {
              if (readOnly) return;
              onImagePaste(e);
            }}
          >
            {img ? (
              <button type="button" className="block h-full w-full" onClick={() => onPreviewImage(img)}>
                <img src={img} alt="" className="h-full w-full object-cover" draggable={false} />
              </button>
            ) : (
              <button
                type="button"
                disabled={readOnly || imageBusy}
                onClick={onPickImage}
                className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/25 text-[10px] text-gray-500 transition-colors hover:text-violet-200/90 disabled:cursor-not-allowed"
              >
                {imageBusy ? '处理中…' : '点击或拖入图片'}
              </button>
            )}
            {imageBusy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] text-gray-300">
                压缩入库…
              </div>
            ) : null}
          </div>
          {!readOnly && img ? (
            <div className={`mt-1 flex ${STORYBOARD_GAP_INNER}`}>
              <button
                type="button"
                onClick={onPickImage}
                className="text-[10px] text-gray-500 hover:text-gray-200"
              >
                替换
              </button>
              <button
                type="button"
                onClick={onClearImage}
                className="text-[10px] text-gray-500 hover:text-red-300"
              >
                清除
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {!readOnly ? (
        <div
          className={`flex flex-wrap items-center border-t border-white/[0.05] ${STORYBOARD_PAD_ROW_BAR} ${STORYBOARD_GAP_INNER}`}
        >
          {onRedraw ? (
            <button
              type="button"
              title={redrawDisabledReason || '根据镜头文本重绘分镜图'}
              disabled={redrawDisabled || redrawBusy}
              onClick={onRedraw}
              className={`${STORYBOARD_ROW_ACTION} min-w-[4.5rem] ${
                redrawBusy
                  ? 'bg-violet-600/25 text-violet-100 ring-1 ring-violet-400/30'
                  : redrawDisabled
                    ? 'bg-white/[0.02] text-gray-600'
                    : STORYBOARD_TOOL_BTN_PRIMARY
              }`}
            >
              {redrawBusy ? '生成中…' : '重绘'}
            </button>
          ) : null}
          <button
            type="button"
            title={row.locked ? '已锁定' : '锁定本镜'}
            onClick={() => onPatch({ locked: !row.locked })}
            className={`${STORYBOARD_ROW_ACTION} ${
              row.locked
                ? 'bg-amber-500/15 text-amber-100 ring-1 ring-amber-500/35'
                : 'bg-white/[0.03] text-gray-400 ring-1 ring-white/[0.06] hover:bg-white/[0.06] hover:text-gray-200'
            }`}
          >
            {row.locked ? '已锁定' : '锁定'}
          </button>
          <button
            type="button"
            title="删除镜头"
            disabled={rowCount <= 1}
            onClick={onRemove}
            className={`${STORYBOARD_ROW_ACTION} ml-auto bg-transparent text-gray-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30`}
          >
            删除镜头
          </button>
        </div>
      ) : null}
    </article>
  );
}
