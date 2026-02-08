/**
 * 自定义下拉（与生图模块「生图模型」一致：深色底、选中项蓝底、▲/▼）
 */
import React, { useState, useRef, useEffect } from 'react';

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
  /** 与生图模块一致：小号紧凑样式 */
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
        className={`w-full bg-white/5 border border-white/10 rounded-xl ${pad} ${textSize} text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-white/10 transition-colors text-white ${buttonClassName}`}
      >
        <span className="truncate">{displayLabel}</span>
        <span className="text-gray-500 shrink-0 ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1002]" aria-hidden onClick={() => setOpen(false)} />
          <ul className="absolute top-full left-0 right-0 mt-1 z-[1003] max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f0f] shadow-xl py-1 text-white list-none">
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full ${pad} text-left ${textSize} transition-colors ${value === opt.value ? 'bg-blue-600/30 text-blue-300' : 'text-white hover:bg-white/10'}`}
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
