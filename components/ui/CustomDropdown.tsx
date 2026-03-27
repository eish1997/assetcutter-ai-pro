import React, { useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

type Option = { value: string; label: string };

type CustomDropdownProps = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  /**
   * Portal 遮罩与列表的 z-index（内联样式，避免低于宿主弹窗时被挡住）。
   * 默认 1002 / 1003；嵌在 z-[2100] 等弹窗内时请传入更大值，例如 { backdrop: 2200, list: 2201 }。
   */
  portalZIndex?: { backdrop: number; list: number };
};

/** 深色主题下拉组件：触发器 + Portal 到 body 的列表与遮罩，规范见 .cursor/rules/dropdown-ui-style.mdc */
export function CustomDropdown({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = '默认',
  triggerClassName = 'bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-white/10 transition-colors',
  portalZIndex = { backdrop: 1002, list: 1003 },
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [listPosition, setListPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const GAP = 4;
    const MARGIN = 8;
    const MAX_LIST = 224;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let width = Math.max(rect.width, 96);
    let left = rect.left;
    if (left + width > vw - MARGIN) left = Math.max(MARGIN, vw - width - MARGIN);
    if (left < MARGIN) left = MARGIN;

    const spaceBelow = vh - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    let top: number | undefined;
    let bottom: number | undefined;
    let maxHeight: number;

    const openDown = spaceBelow >= spaceAbove && spaceBelow >= 80;
    if (openDown) {
      top = rect.bottom + GAP;
      maxHeight = Math.min(MAX_LIST, spaceBelow);
    } else if (spaceAbove >= 80) {
      maxHeight = Math.min(MAX_LIST, spaceAbove);
      // 向上展开时用 bottom 锚点，避免因为 maxHeight 过大导致菜单“飞走”
      bottom = vh - rect.top + GAP;
    } else {
      top = rect.bottom + GAP;
      maxHeight = Math.max(80, Math.min(MAX_LIST, spaceBelow));
    }

    if (top != null) {
      if (top + maxHeight > vh - MARGIN) {
        maxHeight = Math.max(80, vh - MARGIN - top);
      }
      if (top < MARGIN) {
        top = MARGIN;
        maxHeight = Math.min(maxHeight, vh - MARGIN - top);
      }
    }

    setListPosition({ top, bottom, left, width, maxHeight });
  }, [open, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onScroll = (e: Event) => {
      const targetNode = e.target as Node | null;
      if (!targetNode) return;
      if (triggerRef.current?.contains(targetNode)) return;
      if (listRef.current?.contains(targetNode)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label = value ? options.find((o) => o.value === value)?.label ?? value : placeholder;

  const portalContent =
    open && typeof document !== 'undefined' ? (
      <>
        <div
          className="fixed inset-0"
          style={{ zIndex: portalZIndex.backdrop }}
          aria-hidden
          onClick={() => setOpen(false)}
        />
        {listPosition && (
          <ul
            ref={listRef}
            className="fixed overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f0f] shadow-xl py-1 text-white"
            style={{
              top: listPosition.top,
              bottom: listPosition.bottom,
              left: listPosition.left,
              width: listPosition.width,
              minWidth: '6rem',
              maxHeight: listPosition.maxHeight,
              zIndex: portalZIndex.list,
            }}
          >
            {options.map((opt) => (
              <li key={opt.value === '' ? '__empty__' : opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-[10px] transition-colors ${
                    value === opt.value ? 'bg-blue-600/30 text-blue-300' : 'text-white hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    ) : null;

  return (
    <div className="relative" ref={triggerRef}>
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        className={`${triggerClassName} ${disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
      >
        <span>{label}</span>
        <span className="text-gray-500 shrink-0 ml-1">{open ? '▲' : '▼'}</span>
      </button>
      {portalContent && typeof document !== 'undefined' ? createPortal(portalContent, document.body) : null}
    </div>
  );
}

/** 表单内联时使用的紧凑触发器样式 */
export const DROPDOWN_TRIGGER_COMPACT =
  'bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[10px] text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-white/10 transition-colors min-w-[5rem]';

