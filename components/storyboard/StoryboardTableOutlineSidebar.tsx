import React from 'react';
import type { StoryboardTableRow } from '../../types';
import {
  storyboardRowOutlineSubtitle,
  storyboardRowOutlineTitle,
} from './storyboardRowDisplay';
import {
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_OUTLINE_ITEM,
  STORYBOARD_OUTLINE_ITEM_ACTIVE,
  STORYBOARD_OUTLINE_ITEM_IDLE,
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_SIDE_DOCK,
  STORYBOARD_SIDE_RAIL,
} from './storyboardTableUi';

type Props = {
  rows: StoryboardTableRow[];
  activeRowId: string | null;
  onSelect: (rowId: string) => void;
};

export default function StoryboardTableOutlineSidebar({ rows, activeRowId, onSelect }: Props) {
  return (
    <aside className={`${STORYBOARD_SIDE_RAIL} w-full min-w-0`}>
      <div className={`${STORYBOARD_SIDE_DOCK} flex h-full min-h-0 flex-col`}>
        <div className="shrink-0 border-b border-white/[0.06] px-2 py-1">
          <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0 text-[9px]`}>
            大纲 <span className="font-normal text-gray-600">· {rows.length}</span>
          </p>
        </div>
        <nav className={`${STORYBOARD_BODY_SCROLL} p-0.5`} aria-label="分镜大纲">
          <ul className="flex flex-col gap-px">
            {rows.map((row, i) => {
              const active = activeRowId === row.id;
              const thumb = String(row.frameImage || '').trim();
              const title = storyboardRowOutlineTitle(row, i);
              const subtitle = storyboardRowOutlineSubtitle(row);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className={`${STORYBOARD_OUTLINE_ITEM} gap-1 rounded-lg px-1 py-0.5 ${
                      active ? STORYBOARD_OUTLINE_ITEM_ACTIVE : STORYBOARD_OUTLINE_ITEM_IDLE
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[9px] font-bold ${
                        thumb
                          ? 'bg-black/25 ring-1 ring-white/[0.08]'
                          : 'bg-white/[0.04] text-gray-500'
                      }`}
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        title
                      )}
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-[10px] font-semibold text-gray-100">{title}</span>
                        {row.locked ? (
                          <span className="shrink-0 text-[8px] text-amber-400/90">锁</span>
                        ) : null}
                      </span>
                      <span className="mt-px block truncate text-[8px] text-gray-600">{subtitle}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
