import React from 'react';
import { X } from 'lucide-react';
import { PreviewShell } from '../preview/PreviewShell';
import { PreviewImageLoadingState } from '../preview/PreviewImageLoadingState';
import { IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE, WORKFLOW_IMAGE_PREVIEW_RAIL } from './workflowSectionUiConstants';

const SHELL_BACKDROP = 'bg-black/72 backdrop-blur-sm';
const CLOSE_ICON = { size: 17, strokeWidth: 1.75, className: 'shrink-0' as const };
const LOADING_COVER_ID = 'ac-lightbox-loading-cover';

type Props = {
  open: boolean;
  focusKey: string;
  placeholderSrc?: string | null;
  backdropImageSrc?: string | null;
  loadingLabel?: string;
  onClose: () => void;
};

/** 不经 React 整树 reconcile，点击后立刻出现「加载中」遮罩。 */
export function mountLightboxLoadingCover(onClose?: () => void): void {
  if (typeof document === 'undefined') return;
  unmountLightboxLoadingCover();
  const root = document.createElement('div');
  root.id = LOADING_COVER_ID;
  root.setAttribute('data-lightbox-loading-cover', '1');
  root.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2000',
    'background:rgba(0,0,0,0.72)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');
  root.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 20px;border-radius:16px;border:1px solid rgba(255,255,255,0.08);background:rgba(10,10,12,0.78)">' +
    '<div style="width:28px;height:28px;border-radius:999px;border:2px solid rgba(255,255,255,0.15);border-top-color:rgba(96,165,250,0.9);animation:ac-lightbox-spin .7s linear infinite"></div>' +
    '<span style="font-size:10px;color:rgb(156,163,175)">加载中…</span></div>' +
    '<style>@keyframes ac-lightbox-spin{to{transform:rotate(360deg)}}</style>';
  root.addEventListener('click', (event) => {
    if (event.target === root) onClose?.();
  });
  document.body.appendChild(root);
}

export function unmountLightboxLoadingCover(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(LOADING_COVER_ID)?.remove();
}

/** 点击资产后立刻画出遮罩 + 加载中；完整 overlay 放到下一帧再挂，避免卡住点击。 */
export function WorkflowLightboxInstantShell({
  open,
  focusKey,
  placeholderSrc,
  backdropImageSrc,
  loadingLabel = '图片加载中…',
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
      <PreviewImageLoadingState placeholderSrc={placeholderSrc} label={loadingLabel} />
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
