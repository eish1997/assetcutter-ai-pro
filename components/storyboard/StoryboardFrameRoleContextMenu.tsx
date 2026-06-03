import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StoryboardRoleAsset } from '../../types';
import { STORYBOARD_FIELD_INPUT } from './storyboardTableUi';

export type StoryboardFrameRoleMenuMode = 'add' | 'edit';

type Props = {
  open: boolean;
  mode: StoryboardFrameRoleMenuMode;
  x: number;
  y: number;
  roleAssets: StoryboardRoleAsset[];
  onPick: (asset: StoryboardRoleAsset) => void;
  onCustomName?: (name: string) => void;
  onDelete?: () => void;
  onClose: () => void;
};

export default function StoryboardFrameRoleContextMenu({
  open,
  mode,
  x,
  y,
  roleAssets,
  onPick,
  onCustomName,
  onDelete,
  onClose,
}: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    if (!open) {
      setCustomOpen(false);
      setCustomName('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-storyboard-role-menu="1"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  const namedAssets = roleAssets.filter((asset) => asset.name.trim());
  const title = mode === 'edit' ? '更换角色' : '添加角色名';

  const submitCustom = () => {
    const name = customName.trim();
    if (!name || !onCustomName) return;
    onCustomName(name);
    onClose();
  };

  return createPortal(
    <div
      data-storyboard-role-menu="1"
      className="fixed z-[2300] min-w-[8.5rem] max-w-[14rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="px-2.5 py-1 text-[9px] font-semibold text-gray-500">{title}</p>
      {namedAssets.length ? (
        namedAssets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => {
              onPick(asset);
              onClose();
            }}
            className="flex w-full items-center px-2.5 py-1.5 text-left text-[10px] text-gray-200 transition-colors hover:bg-white/[0.06]"
          >
            {asset.name}
          </button>
        ))
      ) : (
        <p className="px-2.5 py-1 text-[9px] leading-relaxed text-gray-600">
          解析页暂无角色资产，可下方自定义名称
        </p>
      )}
      {onCustomName ? (
        customOpen ? (
          <div className="border-t border-white/[0.06] px-2 py-1.5">
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitCustom();
                }
              }}
              placeholder="输入角色名"
              className={`${STORYBOARD_FIELD_INPUT} h-7 text-[10px]`}
              autoFocus
            />
            <button
              type="button"
              onClick={submitCustom}
              className="mt-1 w-full rounded-lg bg-white/[0.08] px-2 py-1 text-[9px] text-gray-200 hover:bg-white/[0.12]"
            >
              确定
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className="flex w-full items-center border-t border-white/[0.06] px-2.5 py-1.5 text-left text-[10px] text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
          >
            自定义名称…
          </button>
        )
      ) : null}
      {mode === 'edit' && onDelete ? (
        <button
          type="button"
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="flex w-full items-center border-t border-white/[0.06] px-2.5 py-1.5 text-left text-[10px] text-rose-300/90 transition-colors hover:bg-rose-500/10"
        >
          删除标注
        </button>
      ) : null}
    </div>,
    document.body
  );
}
