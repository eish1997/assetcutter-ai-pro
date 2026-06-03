import React, { useMemo } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow, StoryboardRoleAsset } from '../../types';
import { resolveStoryboardRowFrameDisplaySrc } from '../../services/storyboardFrameImageUrl';
import {
  storyboardRowDurationLabel,
  storyboardRowOutlineTitle,
  type StoryboardCompositeFieldItem,
} from './storyboardRowDisplay';
import { storyboardCompositeDomId } from './storyboardTableDom';
import { storyboardPanelCardTone } from './storyboardTableUi';
import StoryboardFrameRoleMarkOverlays from './StoryboardFrameRoleMarkOverlays';

function StoryboardCompositeFieldsBody({
  fieldItems,
  catalog,
  shotFields,
  fallbackText,
}: {
  fieldItems?: StoryboardCompositeFieldItem[];
  catalog?: StoryboardParseFieldDef[];
  shotFields: Record<string, string>;
  fallbackText: string;
}) {
  const items = useMemo(() => {
    if (fieldItems?.length) return fieldItems;
    return (catalog ?? [])
      .map((def) => ({
        id: def.id,
        label: def.label,
        value: String(shotFields[def.id] || '').trim(),
      }))
      .filter((x) => x.value);
  }, [catalog, fieldItems, shotFields]);

  if (items.length) {
    return (
      <div className="flex flex-wrap content-start gap-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="inline-flex min-w-[calc(50%-0.375rem)] max-w-full flex-col rounded-md bg-white/[0.04] px-1.5 py-1 ring-1 ring-white/[0.06] sm:min-w-[8.5rem] sm:max-w-full"
          >
            <span className="text-[8px] font-medium text-gray-500">{item.label}</span>
            <span className="text-[10px] leading-snug text-gray-300 break-words whitespace-pre-wrap">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <p className="break-words text-[10px] leading-relaxed text-gray-400 whitespace-pre-wrap">
      {fallbackText || '（暂无镜头描述）'}
    </p>
  );
}

type Props = {
  row: StoryboardTableRow;
  index: number;
  active: boolean;
  bodyText?: string;
  fieldCatalog?: StoryboardParseFieldDef[];
  fieldItems?: StoryboardCompositeFieldItem[];
  domId?: string;
  previewSrcOverride?: string;
  titleOverride?: string;
  durationLabelOverride?: string | null;
  /** 为 true 时仅展示合成条带图，不回退单镜图 */
  mergedPreview?: boolean;
  /** mergedPreview 时占位文案：生成中 / 失败 */
  mergeStatus?: 'pending' | 'failed';
  showLocked?: boolean;
  /** 分镜图网格：仅缩略图 + 镜号，不展示字段文案 */
  compact?: boolean;
  /** 叠加编辑页人名标签 */
  overlayRoleMarks?: boolean;
  roleAssets?: StoryboardRoleAsset[];
  onSelect?: () => void;
  /** 网格预览等：双击切回编辑并定位该镜 */
  onOpenInEditor?: () => void;
  onPreviewImage?: (src: string) => void;
};

/** 单镜 / 多镜合成卡：4:3 画幅 + 完整图片与字段 */
export default function StoryboardFrameCompositeCard({
  row,
  index,
  active,
  bodyText,
  fieldCatalog,
  fieldItems,
  domId,
  previewSrcOverride,
  titleOverride,
  durationLabelOverride,
  mergedPreview = false,
  mergeStatus,
  showLocked,
  compact = false,
  overlayRoleMarks = false,
  roleAssets,
  onSelect,
  onOpenInEditor,
  onPreviewImage,
}: Props) {
  const rowImg = resolveStoryboardRowFrameDisplaySrc(row);
  const img = mergedPreview ? previewSrcOverride : previewSrcOverride || rowImg;
  const title = titleOverride ?? storyboardRowOutlineTitle(row, index);
  const duration =
    durationLabelOverride !== undefined
      ? durationLabelOverride
      : storyboardRowDurationLabel(row);
  const body = (bodyText ?? row.shotText ?? '').trim();
  const pendingMerge = Boolean(mergedPreview && mergeStatus === 'pending');
  const mergeFailed = Boolean(mergedPreview && mergeStatus === 'failed');
  const locked = showLocked ?? row.locked;

  if (compact && !mergedPreview) {
    return (
      <article
        id={domId ?? storyboardCompositeDomId(row.id)}
        className={`scroll-mt-2 flex w-full min-w-0 flex-col overflow-hidden transition-colors ${storyboardPanelCardTone(active)}`}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onDoubleClick={
            onOpenInEditor
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
          title={onOpenInEditor ? '双击进入编辑' : title}
          className="relative cursor-pointer overflow-hidden border-2 border-black bg-white text-left outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-inset"
        >
          {img ? (
            <>
              <img
                src={img}
                alt=""
                className="block w-full shrink-0 leading-none"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  onPreviewImage?.(img);
                }}
              />
              {overlayRoleMarks ? (
                <StoryboardFrameRoleMarkOverlays marks={row.frameRoleMarks} roleAssets={roleAssets} />
              ) : null}
              <span className="pointer-events-none absolute left-0 top-0 bg-black/80 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                {title}
              </span>
            </>
          ) : (
            <div className="relative flex min-h-[3.5rem] items-center justify-center bg-[#f3f3f5] px-1 py-2 text-center text-[10px] text-gray-500">
              <span className="absolute left-0 top-0 bg-black/80 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                {title}
              </span>
              {pendingMerge ? '合成预览生成中…' : mergeFailed ? '合成预览失败' : '待配图'}
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <article
      id={domId ?? storyboardCompositeDomId(row.id)}
      className={`scroll-mt-2 flex w-full min-w-0 flex-col overflow-hidden transition-colors ${storyboardPanelCardTone(active)}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={
          onOpenInEditor
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
        title={onOpenInEditor ? '双击进入编辑' : undefined}
        className="flex cursor-pointer flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-inset"
      >
        <div
          className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-black/40"
          onClick={
            compact && img
              ? (e) => {
                  e.stopPropagation();
                  onPreviewImage?.(img);
                }
              : undefined
          }
        >
          {img ? (
            <>
              <img
                src={img}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
                draggable={false}
              />
              {overlayRoleMarks ? (
                <StoryboardFrameRoleMarkOverlays marks={row.frameRoleMarks} roleAssets={roleAssets} />
              ) : null}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
              <span className="text-[10px] font-medium text-gray-600">
                {pendingMerge
                  ? '合成预览生成中…'
                  : mergeFailed
                    ? '合成预览失败'
                    : '预览待生成'}
              </span>
            </div>
          )}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 bg-gradient-to-b from-black/75 to-transparent ${
              compact ? 'px-1.5 pb-3 pt-1.5' : 'px-2.5 pb-5 pt-2'
            }`}
          >
            <span className={`font-bold text-white/95 ${compact ? 'text-[10px]' : 'text-[12px]'}`}>{title}</span>
            <span className="flex shrink-0 items-center gap-1">
              {duration ? (
                <span className="rounded-md bg-black/45 px-1.5 py-0.5 text-[8px] text-gray-300 backdrop-blur-sm">
                  {duration}
                </span>
              ) : null}
              {locked ? (
                <span className="rounded-md bg-amber-500/25 px-1.5 py-0.5 text-[8px] font-bold text-amber-100">
                  过
                </span>
              ) : null}
            </span>
          </div>
        </div>
        {!mergedPreview && !compact ? (
          <div className="shrink-0 border-t border-white/[0.06] bg-white/[0.05] px-2.5 py-2">
            <StoryboardCompositeFieldsBody
              fieldItems={fieldItems}
              catalog={fieldCatalog}
              shotFields={row.shotFields}
              fallbackText={body}
            />
          </div>
        ) : null}
      </div>
      {img && !compact ? (
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
