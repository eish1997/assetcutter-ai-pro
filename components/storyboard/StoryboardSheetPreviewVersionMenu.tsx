import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StoryboardSheetPreviewItem } from '../../services/storyboardSheetPreview';
import { sheetPreviewVersionLabel } from '../../services/storyboardSheetPreviewHistory';

type Props = {
  preview: StoryboardSheetPreviewItem;
  disabled?: boolean;
  onSelectVersion: (previewId: string, versionId: string) => void;
};

export default function StoryboardSheetPreviewVersionMenu({
  preview,
  disabled = false,
  onSelectVersion,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const history = preview.imageHistory || [];
  const totalVersions = history.length + 1;

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  const onEscape = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onEscape]);

  if (totalVersions <= 1) return null;

  const entries: Array<{ id: string; label: string; active: boolean }> = [
    {
      id: '__active__',
      label: sheetPreviewVersionLabel(
        {
          id: 'active',
          createdAt: preview.createdAt,
          source: preview.source === 'uploaded' ? 'uploaded' : 'generated',
        },
        0
      ),
      active: true,
    },
    ...history.map((ver, index) => ({
      id: ver.id,
      label: sheetPreviewVersionLabel(ver, index + 1),
      active: false,
    })),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label="查看历史版本"
        title="历史版本"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="absolute left-0.5 top-0.5 rounded-md bg-black/55 px-1 py-0.5 text-[8px] text-gray-200 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 disabled:opacity-40"
      >
        历史 {totalVersions}
      </button>
      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[2184]" aria-hidden onClick={() => setOpen(false)} />
              <ul
                className="fixed z-[2185] max-h-40 min-w-[7rem] overflow-y-auto rounded-xl border border-[#2e2e32] bg-[#0f0f0f] py-1 shadow-xl"
                style={{ top: pos.top, left: pos.left }}
                onClick={(event) => event.stopPropagation()}
              >
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={entry.active}
                      onClick={() => {
                        if (entry.active || entry.id === '__active__') {
                          setOpen(false);
                          return;
                        }
                        onSelectVersion(preview.id, entry.id);
                        setOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 text-left text-[9px] transition-colors ${
                        entry.active
                          ? 'bg-[#264670] text-blue-300'
                          : 'text-gray-200 hover:bg-[#2e2e36]'
                      }`}
                    >
                      {entry.label}
                      {entry.active ? ' · 当前' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </>,
            document.body
          )
        : null}
    </>
  );
}
