import React, { useCallback, useRef, useState } from 'react';
import type { StoryboardFrameRoleMark } from '../../types';
import {
  clampStoryboardFrameRoleMarkUnit,
  computeStoryboardFrameRoleMarkPosition,
} from '../../services/storyboardFrameRoleMarks';

type Props = {
  mark: StoryboardFrameRoleMark;
  label: string;
  selected: boolean;
  /** 所在镜头满足「拼图替换角色」条件时高亮边框 */
  replaceHighlight?: boolean;
  readOnly?: boolean;
  getFrameEl: () => HTMLDivElement | null;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onContextMenu: (clientX: number, clientY: number) => void;
};

export default function StoryboardFrameRoleMarkChip({
  mark,
  label,
  selected,
  replaceHighlight = false,
  readOnly = false,
  getFrameEl,
  onSelect,
  onMove,
  onContextMenu,
}: Props) {
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const displayX = dragPos?.x ?? mark.x;
  const displayY = dragPos?.y ?? mark.y;

  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      const frame = getFrameEl();
      if (!frame || !dragRef.current) return;
      const rect = frame.getBoundingClientRect();
      const next = computeStoryboardFrameRoleMarkPosition(clientX, clientY, rect);
      onMove(next.x, next.y);
      dragRef.current = null;
      setDragPos(null);
    },
    [getFrameEl, onMove]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      if (readOnly) {
        onSelect();
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelect();
      dragRef.current = { x: mark.x, y: mark.y };
    },
    [mark.x, mark.y, onSelect, readOnly]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      if (readOnly || !dragRef.current) return;
      const frame = getFrameEl();
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const next = computeStoryboardFrameRoleMarkPosition(event.clientX, event.clientY, rect);
      setDragPos({
        x: clampStoryboardFrameRoleMarkUnit(next.x),
        y: clampStoryboardFrameRoleMarkUnit(next.y),
      });
    },
    [getFrameEl, readOnly]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      if (readOnly || !dragRef.current) return;
      finishDrag(event.clientX, event.clientY);
    },
    [finishDrag, readOnly]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect();
      onContextMenu(event.clientX, event.clientY);
    },
    [onContextMenu, onSelect]
  );

  return (
    <span
      role="button"
      tabIndex={0}
      data-storyboard-role-mark={mark.id}
      className={`absolute z-[6] max-w-[94%] cursor-grab truncate rounded-md border px-2 py-1 text-[11px] font-bold leading-none text-white shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.75)] active:cursor-grabbing ${
        selected
          ? 'border-sky-300/90 bg-sky-500/90 ring-2 ring-sky-300/70'
          : replaceHighlight
            ? 'border-emerald-400/85 bg-black/85 ring-2 ring-emerald-400/55'
            : 'border-white/50 bg-black/85 ring-2 ring-white/20'
      }`}
      style={{
        left: `${displayX * 100}%`,
        top: `${displayY * 100}%`,
        transform: 'translate(-50%, -50%)',
      }}
      title={replaceHighlight && !selected ? `${label} · 可拼图替换角色` : label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {label}
    </span>
  );
}
