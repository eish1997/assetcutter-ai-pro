import React from 'react';
import { X } from 'lucide-react';
import { PreviewShell } from '../preview/PreviewShell';
import { PreviewImageLoadingState } from '../preview/PreviewImageLoadingState';
import { IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE, WORKFLOW_IMAGE_PREVIEW_RAIL } from './workflowSectionUiConstants';

const SHELL_BACKDROP = 'bg-black/72 backdrop-blur-sm';
const CLOSE_ICON = { size: 17, strokeWidth: 1.75, className: 'shrink-0' as const };

type Props = {
  open: boolean;
  focusKey: string;
  placeholderSrc?: string | null;
  backdropImageSrc?: string | null;
  onClose: () => void;
};

/** 点击资产后 flushSync 立刻绘制：遮罩 + 占位 + 关闭；完整 ImagePreviewOverlay 延后挂载 */
export function WorkflowLightboxInstantShell({
  open,
  focusKey,
  placeholderSrc,
  backdropImageSrc,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <PreviewShell
      open
      onClose={onClose}
      focusKey={focusKey}
      backdropTintClassName={SHELL_BACKDROP}
      backdropImageSrc={backdropImageSrc}
    >
      <PreviewImageLoadingState placeholderSrc={placeholderSrc} label="图片加载中…" />
      <div
        className="absolute right-4 z-10 flex max-w-[calc(100vw-2rem)] flex-row flex-wrap items-start justify-end gap-2"
        style={{ top: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className={`${WORKFLOW_IMAGE_PREVIEW_RAIL} shrink-0`} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onClose}
            className={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
            title="关闭"
            aria-label="关闭预览"
          >
            <X {...CLOSE_ICON} aria-hidden />
          </button>
        </div>
      </div>
    </PreviewShell>
  );
}
