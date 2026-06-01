import React, { useEffect, useMemo } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import {
  resolveStoryboardRowFrameDisplaySrc,
  storyboardRowHasFrameRef,
} from '../../services/storyboardFrameImageUrl';
import { storyboardInputPreviewFieldLines } from '../../services/storyboardTableInput';
import { rowHasStructuredFieldValues } from '../../services/storyboardTableParse';
import { compileSheetShotPanelMeta } from '../../services/storyboardTableSheetGen';
import {
  resolveStoryboardSheetGroupFontSize,
} from '../../services/storyboardSheetCellTypography';
import {
  ensureStoryboardSheetSketchFontLoaded,
  storyboardSheetSketchDomStyle,
} from '../../services/storyboardSheetSketchStyle';
import { storyboardRowOutlineTitle } from './storyboardRowDisplay';
import { storyboardInputRowDomId } from './storyboardTableDom';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_GAP_STACK,
  STORYBOARD_ROW_ACTIVE,
  STORYBOARD_ROW_IDLE,
} from './storyboardTableUi';

type GroupTypography = {
  fontSizePx: number;
};

export function StoryboardSheetDomCell({
  row,
  fieldCatalog,
  groupTypography,
  selected = false,
  domId,
  onPreviewImage,
  onSelect,
}: {
  row: StoryboardTableRow;
  fieldCatalog: StoryboardParseFieldDef[];
  groupTypography: GroupTypography;
  selected?: boolean;
  domId?: string;
  onPreviewImage?: (src: string) => void;
  onSelect?: () => void;
}) {
  const meta = compileSheetShotPanelMeta(row, fieldCatalog);
  const { compactLayout } = meta;
  const img = resolveStoryboardRowFrameDisplaySrc(row);
  const interactive = Boolean(onSelect);

  return (
    <div
      id={domId}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      className={`flex min-w-0 flex-col overflow-hidden border-2 border-black transition-[box-shadow,ring-color] ${
        interactive ? 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/25' : ''
      } ${selected ? 'ring-2 ring-white/30 ring-offset-1 ring-offset-[#0a0a0c]' : ''}`}
      style={{ ...storyboardSheetSketchDomStyle, fontSize: `${groupTypography.fontSizePx}px` }}
    >
      <div
        className="shrink-0 px-1 py-0.5 text-[0.95em] leading-tight break-words"
        style={{ color: 'rgba(35,35,42,0.88)' }}
        title={compactLayout.headerLine}
      >
        {compactLayout.headerLine || row.shotNo || `#${row.index + 1}`}
      </div>
      {img ? (
        <div
          className="block w-full shrink-0 leading-none"
          onClick={(e) => {
            e.stopPropagation();
            onPreviewImage?.(img);
          }}
          role={onPreviewImage ? 'button' : undefined}
          tabIndex={onPreviewImage && !interactive ? 0 : undefined}
        >
          <img src={img} alt="" className="block h-auto w-full" draggable={false} />
        </div>
      ) : (
        <div
          className="flex h-10 shrink-0 items-center justify-center bg-[#f3f3f5] px-1 text-center text-[0.9em]"
          style={{ color: 'rgba(100,100,108,0.75)' }}
        >
          待配图
        </div>
      )}
      <div className="shrink-0 space-y-0.5 px-1 pt-0.5 pb-0.5 leading-tight">
        {compactLayout.metaLine ? (
          <p
            className="text-[0.82em] break-words"
            style={{ color: 'rgba(55,55,62,0.82)' }}
            title={compactLayout.metaLine}
          >
            {compactLayout.metaLine}
          </p>
        ) : null}
        {compactLayout.description ? (
          <p
            className="text-[0.88em] break-words whitespace-pre-wrap"
            style={{ color: 'rgba(18,18,22,0.92)' }}
            title={compactLayout.description}
          >
            {compactLayout.description}
          </p>
        ) : !compactLayout.metaLine && compactLayout.extraLines.length === 0 ? (
          <p className="text-[0.88em]" style={{ color: 'rgba(100,100,108,0.75)' }}>
            （无画面描述）
          </p>
        ) : null}
        {compactLayout.extraLines.length > 1 ? (
          <div
            className="columns-2 gap-x-1.5 text-[0.82em] leading-snug"
            style={{ color: 'rgba(45,45,52,0.88)' }}
          >
            {compactLayout.extraLines.map((line, idx) => {
              const text = typeof line === 'string' ? line : line.text;
              const dialogue = typeof line === 'string' ? false : Boolean(line.dialogue);
              return (
                <p
                  key={`${row.id}-extra-${idx}`}
                  className="break-words whitespace-pre-wrap"
                  style={{ color: dialogue ? 'rgba(55,55,62,0.82)' : undefined }}
                >
                  {text}
                </p>
              );
            })}
          </div>
        ) : compactLayout.extraLines.length === 1 ? (
          (() => {
            const line = compactLayout.extraLines[0]!;
            const text = typeof line === 'string' ? line : line.text;
            const dialogue = typeof line === 'string' ? false : Boolean(line.dialogue);
            return (
              <p
                className="text-[0.82em] break-words whitespace-pre-wrap"
                style={{ color: dialogue ? 'rgba(55,55,62,0.82)' : 'rgba(45,45,52,0.88)' }}
              >
                {text}
              </p>
            );
          })()
        ) : null}
      </div>
    </div>
  );
}

type InputCompositeProps = {
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  activeRowId: string | null;
  onSelectRow: (rowId: string) => void;
  onPreviewImage?: (src: string) => void;
};

/** 解析页右侧：上为单镜合成（高度随图），下为纯文字镜头列表 */
export function StoryboardInputCompositePreview({
  rows,
  fieldCatalog,
  activeRowId,
  onSelectRow,
  onPreviewImage,
}: InputCompositeProps) {
  const activeRow = useMemo(
    () => rows.find((row) => row.id === activeRowId) ?? rows[0] ?? null,
    [activeRowId, rows]
  );

  const largeTypography = useMemo(() => {
    if (!activeRow) return { fontSizePx: 11 };
    const meta = compileSheetShotPanelMeta(activeRow, fieldCatalog);
    return resolveStoryboardSheetGroupFontSize([meta], 960, 240);
  }, [activeRow, fieldCatalog]);

  useEffect(() => {
    void ensureStoryboardSheetSketchFontLoaded();
  }, []);

  const selectedRowId = activeRowId ?? activeRow?.id ?? null;

  if (!rows.length) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[10px] text-gray-600">
        导入后将在此展示数据合成预览
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="max-h-[min(58vh,34rem)] shrink-0 overflow-y-auto border-b border-white/[0.06] no-scrollbar">
        <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 py-1.5">
          <span className="text-[9px] font-semibold text-gray-400">数据合成</span>
          {activeRow ? (
            <span className="truncate text-[9px] text-gray-500">
              {activeRow.shotNo?.trim() || `#${activeRow.index + 1}`}
            </span>
          ) : null}
        </div>
        <div className="p-2">
          {activeRow ? (
            <StoryboardSheetDomCell
              row={activeRow}
              fieldCatalog={fieldCatalog}
              groupTypography={largeTypography}
              onPreviewImage={onPreviewImage}
            />
          ) : (
            <p className="py-6 text-center text-[10px] text-gray-600">请选择镜头</p>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 py-1.5">
          <span className="text-[9px] font-semibold text-gray-400">镜头列表</span>
          <span className="text-[9px] text-gray-600">{rows.length} 镜</span>
        </div>
        <div className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 px-1.5 py-1.5`}>
          <div className={`flex flex-col ${STORYBOARD_GAP_STACK}`}>
            {rows.map((row) => {
              const active = row.id === selectedRowId;
              const title = storyboardRowOutlineTitle(row, row.index);
              const parsed = rowHasStructuredFieldValues(fieldCatalog, row);
              const lines = storyboardInputPreviewFieldLines(row, fieldCatalog, 2);
              const hasImage = storyboardRowHasFrameRef(row);
              return (
                <button
                  key={row.id}
                  id={storyboardInputRowDomId(row.id)}
                  type="button"
                  onClick={() => onSelectRow(row.id)}
                  className={`w-full rounded-xl border px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                    active ? STORYBOARD_ROW_ACTIVE : STORYBOARD_ROW_IDLE
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-bold text-white/95">{title}</span>
                    {parsed ? (
                      <span className="rounded bg-white/[0.10] px-1 py-px text-[7px] text-gray-100">
                        析
                      </span>
                    ) : (
                      <span className="rounded bg-white/[0.06] px-1 py-px text-[7px] text-gray-500">
                        待
                      </span>
                    )}
                    {hasImage ? (
                      <span className="rounded bg-white/[0.06] px-1 py-px text-[7px] text-gray-400">
                        图
                      </span>
                    ) : null}
                  </div>
                  {lines.length ? (
                    <div className="space-y-0.5">
                      {lines.map((line) => (
                        <p
                          key={`${row.id}-${line.label}`}
                          className="line-clamp-2 text-[9px] leading-snug text-gray-300"
                        >
                          <span className="text-gray-500">{line.label}：</span>
                          <span className="break-words">{line.value}</span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-gray-600">（待解析）</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
