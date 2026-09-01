import React from 'react';
import { Camera, Eye, EyeOff, Grid3X3, RotateCcw } from 'lucide-react';

import type { Model3DDisplayMode } from '../preview';
import {
  IMAGE_LIGHTBOX_TOOL_ICON_BTN_ACTIVE,
  IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE,
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
} from './workflowSectionUiConstants';

const IC = { size: 15, strokeWidth: 1.8, className: 'shrink-0' as const };

const DISPLAY_MODES: Array<{ key: Model3DDisplayMode; label: string; title: string }> = [
  { key: 'material', label: '材质', title: '显示原始材质' },
  { key: 'clay', label: '白模', title: '中性粘土材质' },
  { key: 'wire', label: '线框', title: '线框显示' },
  { key: 'normal', label: '法线', title: '法线方向上色' },
];

export type WorkflowLightboxModel3dRailProps = {
  displayMode: Model3DDisplayMode;
  showGrid: boolean;
  backfaceCulling: boolean;
  onDisplayModeChange: (mode: Model3DDisplayMode) => void;
  onResetView: () => void;
  onToggleGrid: () => void;
  onToggleBackfaceCulling: () => void;
  onCapturePreview: () => void;
};

export function WorkflowLightboxModel3dRail({
  displayMode,
  showGrid,
  backfaceCulling,
  onDisplayModeChange,
  onResetView,
  onToggleGrid,
  onToggleBackfaceCulling,
  onCapturePreview,
}: WorkflowLightboxModel3dRailProps) {
  return (
    <div className="inline-flex items-center gap-1" data-testid="lightbox-model3d-rail" role="group" aria-label="3D 视角">
      <button
        type="button"
        onClick={onResetView}
        className={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
        title="重置视角"
        aria-label="重置视角"
      >
        <RotateCcw {...IC} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onToggleGrid}
        className={showGrid ? IMAGE_LIGHTBOX_TOOL_ICON_BTN_ACTIVE : IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
        title={showGrid ? '隐藏网格' : '显示网格'}
        aria-label={showGrid ? '隐藏网格' : '显示网格'}
        aria-pressed={showGrid}
      >
        <Grid3X3 {...IC} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onToggleBackfaceCulling}
        className={backfaceCulling ? IMAGE_LIGHTBOX_TOOL_ICON_BTN_ACTIVE : IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
        title={backfaceCulling ? '显示背面' : '背面消隐'}
        aria-label={backfaceCulling ? '显示背面' : '背面消隐'}
        aria-pressed={backfaceCulling}
      >
        {backfaceCulling ? <EyeOff {...IC} aria-hidden /> : <Eye {...IC} aria-hidden />}
      </button>
      <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
      {DISPLAY_MODES.map((mode) => (
        <button
          key={mode.key}
          type="button"
          onClick={() => onDisplayModeChange(mode.key)}
          className={
            displayMode === mode.key ? IMAGE_LIGHTBOX_TOOL_ICON_BTN_ACTIVE : IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE
          }
          title={mode.title}
          aria-label={mode.label}
          aria-pressed={displayMode === mode.key}
        >
          <span className="px-0.5 text-[9px] font-bold leading-none">{mode.label}</span>
        </button>
      ))}
      <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
      <button
        type="button"
        onClick={onCapturePreview}
        className={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
        title="截图当前视角"
        aria-label="截图当前视角"
      >
        <Camera {...IC} aria-hidden />
      </button>
    </div>
  );
}
