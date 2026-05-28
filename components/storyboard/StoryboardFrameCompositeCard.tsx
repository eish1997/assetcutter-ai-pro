import React from 'react';
import type { StoryboardTableRow } from '../../types';
import {
  storyboardRowDurationLabel,
  storyboardRowOutlineTitle,
} from './storyboardRowDisplay';
import { storyboardCompositeDomId } from './storyboardTableDom';
import { storyboardPanelCardTone } from './storyboardTableUi';

type Props = {
  row: StoryboardTableRow;
  index: number;
  active: boolean;
  /** 侧栏：与中间编辑行等高；网格：固定比例单元格 */
  layout?: 'rail' | 'grid';
  /** 与中间编辑行等高（由 ResizeObserver 测量，仅 rail） */
  syncHeight?: number;
  onSelect?: () => void;
  /** 网格预览：双击切回编辑并定位该镜 */
  onOpenInEditor?: () => void;
  onPreviewImage?: (src: string) => void;
};

const FALLBACK_MIN_H = 'min-h-[17.5rem]';

/** 单镜合成卡：侧栏跟随编辑行高度；网格模式为上图下文固定比例 */
export default function StoryboardFrameCompositeCard({
  row,
  index,
  active,
  layout = 'rail',
  syncHeight,
  onSelect,
  onOpenInEditor,
  onPreviewImage,
}: Props) {
  const img = String(row.frameImage || '').trim();
  const title = storyboardRowOutlineTitle(row, index);
  const duration = storyboardRowDurationLabel(row);
  const body = (row.shotText || '').trim();
  const isGrid = layout === 'grid';
  const heightStyle =
    !isGrid && syncHeight && syncHeight > 0
      ? { height: syncHeight, minHeight: syncHeight }
      : undefined;

  const imageBlockClass = isGrid
    ? 'relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-black/30'
    : 'relative min-h-[9rem] flex-1 overflow-hidden bg-black/30';

  return (
    <article
      id={storyboardCompositeDomId(row.id)}
      style={heightStyle}
      className={`scroll-mt-2 flex h-full flex-col overflow-hidden transition-colors ${storyboardPanelCardTone(active)} ${
        isGrid ? 'min-h-0' : heightStyle ? '' : FALLBACK_MIN_H
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={
          isGrid && onOpenInEditor
            ? (e) => {
                e.preventDefault();
                onOpenInEditor();
              }
            : undefined
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect?.();
          }
        }}
        title={isGrid && onOpenInEditor ? '双击进入编辑' : undefined}
        className="flex min-h-0 flex-1 cursor-pointer flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-500/35 focus-visible:ring-inset"
      >
        <div className={imageBlockClass}>
          {img ? (
            <img
              src={img}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
              <span className="text-[10px] font-medium text-gray-600">预览待生成</span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 bg-gradient-to-b from-black/75 to-transparent px-2.5 pb-5 pt-2">
            <span className="text-[12px] font-bold text-white/95">{title}</span>
            <span className="flex shrink-0 items-center gap-1">
              {duration ? (
                <span className="rounded-md bg-black/45 px-1.5 py-0.5 text-[8px] text-gray-300 backdrop-blur-sm">
                  {duration}
                </span>
              ) : null}
              {row.locked ? (
                <span className="rounded-md bg-amber-500/25 px-1.5 py-0.5 text-[8px] font-bold text-amber-100">
                  锁
                </span>
              ) : null}
            </span>
          </div>
          {isGrid && img ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreviewImage?.(img);
              }}
              className="absolute bottom-2 right-2 z-[1] rounded-md bg-black/55 px-2 py-0.5 text-[9px] text-gray-200 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
            >
              大图
            </button>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-white/[0.06] bg-black/20 px-2.5 py-2">
          <p
            className={`text-[10px] leading-relaxed text-gray-400 ${
              isGrid ? 'line-clamp-3' : 'line-clamp-[6]'
            }`}
          >
            {body || '（暂无镜头描述）'}
          </p>
        </div>
      </div>
      {!isGrid && img ? (
        <button
          type="button"
          onClick={() => onPreviewImage?.(img)}
          className="shrink-0 border-t border-white/[0.06] py-1.5 text-center text-[9px] text-gray-500 transition-colors hover:bg-white/[0.03] hover:text-gray-300"
        >
          查看大图
        </button>
      ) : null}
    </article>
  );
}
