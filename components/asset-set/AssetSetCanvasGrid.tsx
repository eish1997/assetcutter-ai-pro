import React, { memo, useCallback, useRef } from 'react';
import type { AssetSetComponent } from '../../types';
import { resolveAssetSetComponentCropSrc } from '../../services/assetSet/assetSetAsset';
import { useStoryboardCanvasMarqueeSelect } from '../../hooks/useStoryboardCanvasMarqueeSelect';
import WorkflowPixelBusyOverlay from '../WorkflowPixelBusyOverlay';
import {
  STORYBOARD_EDIT_CANVAS_GRID,
  STORYBOARD_ROW_SHELL,
  STORYBOARD_ROW_IDLE,
  STORYBOARD_ROW_ACTIVE,
  STORYBOARD_ROW_CANVAS_MULTI_SELECTED,
} from './assetSetPanelUi';

export type AssetSetCanvasSelectModifiers = {
  additive?: boolean;
  range?: boolean;
};

type Props = {
  components: AssetSetComponent[];
  activeComponentId: string | null;
  selectedComponentIds: ReadonlySet<string>;
  busyComponentId?: string | null;
  readOnly?: boolean;
  onSelectComponent: (id: string, modifiers?: AssetSetCanvasSelectModifiers) => void;
  onMarqueeSelect: (ids: string[], additive: boolean) => void;
};

type TileProps = {
  component: AssetSetComponent;
  index: number;
  canvasSelected: boolean;
  active: boolean;
  busy: boolean;
  onSelectComponent: (id: string, modifiers?: AssetSetCanvasSelectModifiers) => void;
};

function assetSetTilePropsEqual(prev: TileProps, next: TileProps): boolean {
  if (prev.index !== next.index) return false;
  if (prev.canvasSelected !== next.canvasSelected) return false;
  if (prev.active !== next.active) return false;
  if (prev.busy !== next.busy) return false;
  if (prev.onSelectComponent !== next.onSelectComponent) return false;
  const a = prev.component;
  const b = next.component;
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if (a.locked !== b.locked) return false;
  if (a.cropPreview !== b.cropPreview) return false;
  if (a.cropPreviewCompanionKey !== b.cropPreviewCompanionKey) return false;
  if (a.model3d?.status !== b.model3d?.status) return false;
  if (a.views.length !== b.views.length) return false;
  for (let i = 0; i < a.views.length; i += 1) {
    if (a.views[i]?.image !== b.views[i]?.image) return false;
    if (a.views[i]?.imageCompanionKey !== b.views[i]?.imageCompanionKey) return false;
  }
  return true;
}

const AssetSetCanvasGridTile = memo(function AssetSetCanvasGridTile({
  component,
  index,
  canvasSelected,
  active,
  busy,
  onSelectComponent,
}: TileProps) {
  const img = resolveAssetSetComponentCropSrc(component);
  const viewCount = component.views.filter((v) => v.image || v.imageCompanionKey).length;
  const modelDone = component.model3d?.status === 'done';
  const shellTone = canvasSelected
    ? `${STORYBOARD_ROW_IDLE} ${STORYBOARD_ROW_CANVAS_MULTI_SELECTED}`
    : active
      ? STORYBOARD_ROW_ACTIVE
      : STORYBOARD_ROW_IDLE;

  return (
    <div
      id={`asset-set-component-${component.id}`}
      data-canvas-row-id={component.id}
      role="button"
      tabIndex={0}
      aria-selected={active}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectComponent(component.id);
        }
      }}
      className={`relative aspect-[4/3] cursor-pointer overflow-hidden ${STORYBOARD_ROW_SHELL} ${shellTone} ${
        component.locked ? 'opacity-55' : ''
      }`}
    >
      {img ? (
        <img
          src={img}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-black/30 text-[9px] text-gray-500">
          待出图
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-1 bg-gradient-to-b from-black/70 to-transparent px-1.5 py-1">
        <span className="truncate text-[9px] font-semibold text-gray-100">
          {component.name || `组件 ${index + 1}`}
        </span>
        {component.locked ? <span className="text-[8px] text-amber-300/90">锁</span> : null}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-1.5 py-1 text-[8px] text-gray-300">
        <span>{viewCount > 0 ? `${viewCount} 视角` : '无视角'}</span>
        {modelDone ? <span className="text-cyan-300">3D</span> : null}
      </div>
      {busy ? <WorkflowPixelBusyOverlay label="处理中" /> : null}
    </div>
  );
}, assetSetTilePropsEqual);

export default function AssetSetCanvasGrid({
  components,
  activeComponentId,
  selectedComponentIds,
  busyComponentId = null,
  readOnly = false,
  onSelectComponent,
  onMarqueeSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMarqueeComplete = useCallback(
    (rowIds: string[], additive: boolean) => {
      onMarqueeSelect(rowIds, additive);
    },
    [onMarqueeSelect]
  );

  const { marqueeRect, onContainerPointerDown } = useStoryboardCanvasMarqueeSelect({
    containerRef,
    disabled: readOnly,
    onMarqueeComplete: handleMarqueeComplete,
    onTileSelect: onSelectComponent,
  });

  const containerRect = containerRef.current?.getBoundingClientRect();
  const marqueeStyle =
    marqueeRect && containerRect
      ? {
          left: marqueeRect.left - containerRect.left,
          top: marqueeRect.top - containerRect.top,
          width: marqueeRect.width,
          height: marqueeRect.height,
        }
      : null;

  if (!components.length) {
    return (
      <div className="flex min-h-[10rem] flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 text-center text-[10px] leading-relaxed text-gray-500">
        在参考图条点击风格图框选拆分后，组件将显示于此
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative touch-none select-none ${STORYBOARD_EDIT_CANVAS_GRID} p-1`}
      onPointerDown={onContainerPointerDown}
    >
      {marqueeStyle ? (
        <div
          className="pointer-events-none absolute z-20 rounded border border-cyan-300/40 bg-cyan-400/[0.06] ring-1 ring-cyan-300/25"
          style={marqueeStyle}
        />
      ) : null}
      {components.map((component, index) => (
        <AssetSetCanvasGridTile
          key={component.id}
          component={component}
          index={index}
          canvasSelected={selectedComponentIds.has(component.id)}
          active={activeComponentId === component.id}
          busy={busyComponentId === component.id}
          onSelectComponent={onSelectComponent}
        />
      ))}
    </div>
  );
}
