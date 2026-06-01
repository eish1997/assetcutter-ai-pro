import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { StoryboardRoleAsset } from '../../types';

type Props = {
  open: boolean;
  x: number;
  y: number;
  roleAssets: StoryboardRoleAsset[];
  onPick: (asset: StoryboardRoleAsset) => void;
  onClose: () => void;
};

export default function StoryboardFrameRoleContextMenu({
  open,
  x,
  y,
  roleAssets,
  onPick,
  onClose,
}: Props) {
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

  return createPortal(
    <div
      data-storyboard-role-menu="1"
      className="fixed z-[2300] min-w-[7.5rem] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f0f] py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="px-2.5 py-1 text-[9px] font-semibold text-gray-500">添加角色名</p>
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
        <p className="px-2.5 py-1.5 text-[9px] leading-relaxed text-gray-600">
          请先在解析页添加角色资产
        </p>
      )}
    </div>,
    document.body
  );
}
