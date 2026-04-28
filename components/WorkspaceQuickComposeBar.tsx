import React, { useCallback, useRef } from 'react';
import { CustomDropdown } from './ui/CustomDropdown';

export type WorkspaceQuickComposeBarProps = {
  visible: boolean;
  options: { value: string; label: string }[];
  actionId: string;
  onActionChange: (id: string) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  attachedImage: string | null;
  onAttachImage: (dataUrl: string) => void;
  onClearAttachment: () => void;
  onSubmit: () => void;
};

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/**
 * 工作区底部居中：玻璃拟态快捷输入（参考现代生成站点），支持文字 + 可选附图并入队执行。
 */
export default function WorkspaceQuickComposeBar({
  visible,
  options,
  actionId,
  onActionChange,
  draft,
  onDraftChange,
  attachedImage,
  onAttachImage,
  onClearAttachment,
  onSubmit,
}: WorkspaceQuickComposeBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const f = files[0];
      if (!f || !f.type.startsWith('image/')) return;
      try {
        const url = await readImageFileAsDataUrl(f);
        if (url.startsWith('data:image/')) onAttachImage(url);
      } catch {
        /* ignore */
      }
      if (fileRef.current) fileRef.current.value = '';
    },
    [onAttachImage]
  );

  const onPaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        if (it?.kind !== 'file') continue;
        const f = it.getAsFile();
        if (f && f.type.startsWith('image/')) {
          e.preventDefault();
          try {
            const url = await readImageFileAsDataUrl(f);
            if (url.startsWith('data:image/')) onAttachImage(url);
          } catch {
            /* ignore */
          }
          return;
        }
      }
    },
    [onAttachImage]
  );

  if (!visible) return null;

  const selectedLabel = options.find((o) => o.value === actionId)?.label ?? '能力';
  const disabled = options.length === 0;

  return (
    <div
      className="pointer-events-auto fixed bottom-5 left-1/2 z-[1600] w-[min(36rem,calc(100vw-1.5rem))] max-w-[92vw] -translate-x-1/2 px-2"
      onPaste={onPaste}
    >
      <div
        className="flex items-center gap-2 rounded-[999px] border border-white/[0.09] bg-[#0a0a0c]/78 px-2 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl ring-1 ring-white/[0.05]"
        role="search"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPickFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-300 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
          title="添加参考图"
          aria-label="添加参考图"
        >
          <span className="text-lg font-light leading-none">+</span>
        </button>

        {attachedImage ? (
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/[0.12]">
            <img src={attachedImage} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={onClearAttachment}
              className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-bold text-white opacity-0 transition-opacity hover:opacity-100"
              title="移除图片"
              aria-label="移除图片"
            >
              ×
            </button>
          </div>
        ) : null}

        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onSubmit();
            }
          }}
          placeholder="想生成什么？可输入文字或附上图片"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-gray-100 placeholder:text-gray-500 outline-none disabled:opacity-45"
          aria-label="快捷生成描述"
        />

        <div className="max-w-[40%] shrink-0">
          <CustomDropdown
            options={options}
            value={actionId}
            onChange={onActionChange}
            disabled={disabled}
            placeholder="能力"
            triggerAriaLabel="选择用于快捷生成的能力"
            triggerClassName="max-w-full rounded-full bg-white/[0.06] px-2.5 py-1.5 text-[10px] font-semibold text-gray-200 ring-1 ring-white/[0.08] outline-none hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/45 flex items-center justify-between gap-1 min-w-0"
            renderTrigger={({ open }) => (
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate" title={selectedLabel}>
                  {selectedLabel}
                </span>
                <span className="shrink-0 text-[9px] text-gray-500">{open ? '▲' : '▼'}</span>
              </span>
            )}
            portalZIndex={{ backdrop: 2600, list: 2601 }}
          />
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={onSubmit}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0a0c] shadow-md outline-none transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/55"
          title="加入队列并执行"
          aria-label="加入队列并执行"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
