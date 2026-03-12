import React, { useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

type Option = { value: string; label: string };

type CustomDropdownProps = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  triggerClassName?: string;
};

/** 深色主题下拉组件：触发器 + Portal 到 body 的列表与遮罩，规范见 .cursor/rules/dropdown-ui-style.mdc */
export function CustomDropdown({
  options,
  value,
  onChange,
  placeholder = '默认',
  triggerClassName = 'bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-white/10 transition-colors',
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [listPosition, setListPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setListPosition({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 96) });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label = value ? options.find((o) => o.value === value)?.label ?? value : placeholder;

  const portalContent =
    open && typeof document !== 'undefined' ? (
      <>
        <div className="fixed inset-0 z-[1002]" aria-hidden onClick={() => setOpen(false)} />
        {listPosition && (
          <ul
            className="fixed z-[1003] max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f0f] shadow-xl py-1 text-white"
            style={{ top: listPosition.top, left: listPosition.left, width: listPosition.width, minWidth: '6rem' }}
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
      <button type="button" onClick={() => setOpen((p) => !p)} className={triggerClassName}>
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

