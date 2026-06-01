import React, { useCallback, useRef } from 'react';

type Props = {
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

/** 细轨道进度条，无原生大圆点 */
export default function StoryboardVideoSeekBar({ value, max, disabled, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || disabled || max <= 0) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(ratio * max);
    },
    [disabled, max, onChange]
  );

  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = max * 0.02;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(Math.min(max, value + step));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onChange(Math.max(0, value - step));
        }
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        seekFromClientX(e.clientX);
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX);
        const onUp = (ev: PointerEvent) => {
          target.releasePointerCapture(ev.pointerId);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
      className={`group relative h-3 flex-1 min-w-[6rem] cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
        disabled ? 'cursor-not-allowed opacity-40' : ''
      }`}
    >
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-white/[0.08]" />
      <div
        className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-white/70 to-white/50"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 shadow-[0_0_6px_rgba(255,255,255,0.35)] opacity-80 transition-opacity group-hover:opacity-100"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
