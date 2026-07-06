import React, { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import AppIcon from './ui/AppIcon';
import {
  getKeyboardShortcutsPage,
  resolveKeyboardShortcutsPage,
  type KeyboardShortcutEntry,
} from '../services/keyboardShortcutsCatalog';
import type { AppMode } from '../types';

type Props = {
  open: boolean;
  mode: AppMode;
  activeWorkspaceProjectId: string | null;
  onClose: () => void;
};

function ShortcutKey({ keys }: { keys: string }) {
  const parts = keys.split(/\s*\+\s*/);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((part, i) => (
        <React.Fragment key={`${part}-${i}`}>
          {i > 0 ? <span className="text-[10px] text-gray-500">+</span> : null}
          <kbd className="inline-flex min-h-[1.35rem] items-center rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gray-100 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
            {part}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

function ShortcutRow({ item }: { item: KeyboardShortcutEntry }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-gray-300">{item.description}</span>
      <span className="shrink-0 pt-0.5">
        <ShortcutKey keys={item.keys} />
      </span>
    </div>
  );
}

export default function KeyboardShortcutsModal({
  open,
  mode,
  activeWorkspaceProjectId,
  onClose,
}: Props) {
  const page = useMemo(
    () => getKeyboardShortcutsPage(resolveKeyboardShortcutsPage({ mode, activeWorkspaceProjectId })),
    [mode, activeWorkspaceProjectId, open]
  );

  const onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [open, onEscape]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0e]/95 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <div className="min-w-0">
            <h2 id="keyboard-shortcuts-title" className="text-sm font-semibold text-white">
              快捷键
            </h2>
            <p className="mt-0.5 text-[10px] text-gray-500">当前页面：{page.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 no-scrollbar">
          {page.sections.map((section) => (
            <section key={section.title} className="mb-4 last:mb-0">
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {section.title}
              </h3>
              <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.02] px-3">
                {section.items.map((item) => (
                  <ShortcutRow key={`${section.title}-${item.keys}-${item.description}`} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="shrink-0 border-t border-white/[0.08] px-4 py-3 text-center text-[10px] text-gray-500">
          按 <kbd className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 text-gray-300">B</kbd>{' '}
          或 <kbd className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 text-gray-300">Esc</kbd>{' '}
          关闭
        </div>
      </div>
    </div>,
    document.body
  );
}
