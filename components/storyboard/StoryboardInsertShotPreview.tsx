import React, { useEffect, useMemo, useRef } from 'react';
import type { InsertShotPreviewStrip, InsertShotPreviewTile } from '../../services/storyboardInsertShot';

type Props = {
  preview: InsertShotPreviewStrip | null;
  animateKey: string;
};

function PreviewTile({ tile, animateKey }: { tile: InsertShotPreviewTile; animateKey: string }) {
  if (tile.kind === 'ellipsis') {
    return (
      <span
        key={`${animateKey}-ellipsis`}
        className="flex shrink-0 items-center px-1 text-[11px] font-semibold text-gray-600"
        aria-hidden
      >
        …
      </span>
    );
  }

  if (tile.kind === 'more') {
    return (
      <div
        key={`${animateKey}-more`}
        className="flex min-w-[3rem] shrink-0 items-center justify-center rounded-lg bg-emerald-400/5 px-2 py-2 ring-1 ring-emerald-400/20"
      >
        <span className="text-[10px] font-semibold text-emerald-200/80">{tile.label}</span>
      </div>
    );
  }

  if (tile.kind === 'unchanged') {
    return (
      <div
        key={`${animateKey}-u-${tile.shotNo}`}
        className="flex min-w-[3.25rem] shrink-0 flex-col items-center justify-center rounded-lg bg-white/[0.04] px-2 py-2 ring-1 ring-white/[0.06] transition-all duration-300"
      >
        <span className="text-[11px] font-semibold tabular-nums text-gray-400">{tile.shotNo}</span>
      </div>
    );
  }

  if (tile.kind === 'new') {
    return (
      <div
        key={`${animateKey}-new-${tile.shotNo}`}
        className="relative flex min-w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-lg bg-emerald-400/10 px-2 py-2 ring-2 ring-emerald-400/60 transition-all duration-300 motion-safe:animate-[storyboardInsertShotIn_280ms_ease-out]"
      >
        <span className="absolute -left-1 top-1 bottom-1 w-0.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]" />
        <span className="mb-0.5 text-[8px] font-bold uppercase tracking-wide text-emerald-300/90">新</span>
        <span className="text-[11px] font-semibold tabular-nums text-emerald-100">{tile.shotNo}</span>
      </div>
    );
  }

  return (
    <div
      key={`${animateKey}-s-${tile.fromShotNo}`}
      className="flex min-w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-lg bg-amber-400/[0.07] px-2 py-2 ring-1 ring-amber-400/20 transition-all duration-300 motion-safe:animate-[storyboardInsertShotShift_280ms_ease-out]"
    >
      <span className="text-[11px] font-semibold tabular-nums text-amber-100/95">{tile.toShotNo}</span>
      <span className="mt-0.5 text-[9px] tabular-nums text-gray-600 line-through">{tile.fromShotNo}</span>
    </div>
  );
}

export default function StoryboardInsertShotPreview({ preview, animateKey }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const newTileRef = useRef<HTMLDivElement>(null);

  const tiles = preview?.tiles ?? [];

  const newTileIndex = useMemo(
    () => tiles.findIndex((tile) => tile.kind === 'new'),
    [tiles]
  );

  useEffect(() => {
    const strip = stripRef.current;
    const target = newTileRef.current;
    if (!strip || !target) return;
    const stripRect = strip.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta =
      targetRect.left - stripRect.left - stripRect.width / 2 + targetRect.width / 2;
    strip.scrollTo({ left: strip.scrollLeft + delta, behavior: 'smooth' });
  }, [animateKey, newTileIndex]);

  if (!preview || tiles.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center rounded-xl bg-black/25 ring-1 ring-white/[0.06] text-[10px] text-gray-600">
        输入镜号后预览插入位置
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-black/25 ring-1 ring-white/[0.06]">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[#0a0a0e] to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[#0a0a0e] to-transparent"
        aria-hidden
      />
      <div
        ref={stripRef}
        className="flex items-stretch gap-1.5 overflow-x-auto px-3 py-3 no-scrollbar"
      >
        {tiles.map((tile, index) => {
          const key = `${animateKey}-${index}-${tile.kind}`;
          if (tile.kind === 'new') {
            return (
              <div key={key} ref={newTileRef}>
                <PreviewTile tile={tile} animateKey={key} />
              </div>
            );
          }
          return <PreviewTile key={key} tile={tile} animateKey={key} />;
        })}
      </div>
    </div>
  );
}
