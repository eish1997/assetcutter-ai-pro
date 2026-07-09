/**
 * 自定义下拉（与全局输入框 / CustomDropdown compose 视觉一致）
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  DROPDOWN_LIST_SURFACE,
  DROPDOWN_OPTION_CHIP_ACTIVE,
  DROPDOWN_OPTION_CHIP_IDLE,
} from './ui/CustomDropdown';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownSelectProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  /** 小号紧凑样式 */
  compact?: boolean;
}

const DropdownSelect: React.FC<DropdownSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = '请选择',
  className = '',
  buttonClassName = '',
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [open]);

  const pad = compact ? 'px-3 py-2' : 'px-4 py-3';
  const textSize = compact ? 'text-[10px]' : 'text-[11px]';

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-full bg-white/[0.05] ring-1 ring-white/[0.08] rounded-xl ${pad} ${textSize} text-left flex items-center justify-between outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/45 text-gray-200 ${buttonClassName}`}
      >
        <span className="truncate">{displayLabel}</span>
        <span className="text-gray-500 shrink-0 ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1002]" aria-hidden onClick={() => setOpen(false)} />
          <ul
            className={`absolute top-full left-0 right-0 mt-1 z-[1003] max-h-56 overflow-y-auto rounded-xl p-1.5 flex flex-col gap-1 text-white list-none ${DROPDOWN_LIST_SURFACE}`}
          >
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={value === opt.value ? DROPDOWN_OPTION_CHIP_ACTIVE : DROPDOWN_OPTION_CHIP_IDLE}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default DropdownSelect;
