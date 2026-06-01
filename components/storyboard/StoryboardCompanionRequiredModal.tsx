import React, { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { STORYBOARD_TOOL_BTN_PRIMARY } from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

type Props = {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
};

export default function StoryboardCompanionRequiredModal({
  open,
  title = '需要本地伴侣',
  message,
  onClose,
}: Props) {
  const onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onEscape]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2180] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0e]/95 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="storyboard-companion-required-title"
        aria-describedby="storyboard-companion-required-message"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <h2 id="storyboard-companion-required-title" className="text-sm font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <p id="storyboard-companion-required-message" className="px-4 py-4 text-[12px] leading-relaxed text-gray-300">
          {message}
        </p>

        <div className="flex justify-end border-t border-white/[0.08] px-4 py-3">
          <button type="button" onClick={onClose} className={STORYBOARD_TOOL_BTN_PRIMARY}>
            知道了
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
