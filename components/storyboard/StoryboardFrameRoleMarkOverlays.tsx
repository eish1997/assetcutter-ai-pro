import React, { useLayoutEffect, useRef, useState } from 'react';
import type { StoryboardFrameRoleMark, StoryboardRoleAsset } from '../../types';
import {
  resolveStoryboardFrameRoleMarkDisplayName,
  resolveStoryboardFrameRoleMarkMetrics,
} from '../../services/storyboardFrameRoleMarks';

type Props = {
  marks?: StoryboardFrameRoleMark[];
  roleAssets?: StoryboardRoleAsset[];
};

/** 编辑页人名标签 DOM 叠加层；字号随容器宽度等比缩放 */
export default function StoryboardFrameRoleMarkOverlays({ marks, roleAssets }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState(() => resolveStoryboardFrameRoleMarkMetrics(200));

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const w = host.clientWidth;
      if (w > 0) setMetrics(resolveStoryboardFrameRoleMarkMetrics(w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  if (!marks?.length) return null;

  const { fontSize, padX, padY, radius, borderWidth } = metrics;

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[5]">
      {marks.map((mark) => {
        const name = resolveStoryboardFrameRoleMarkDisplayName(mark, roleAssets);
        if (!name) return null;
        return (
          <span
            key={mark.id}
            className="absolute max-w-[94%] truncate font-bold leading-none text-white"
            style={{
              left: `${mark.x * 100}%`,
              top: `${mark.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              fontSize: `${fontSize}px`,
              padding: `${padY}px ${padX}px`,
              borderRadius: `${radius}px`,
              border: `${borderWidth}px solid rgba(255,255,255,0.5)`,
              backgroundColor: 'rgba(0,0,0,0.85)',
              boxShadow: `0 0 0 ${Math.max(1, borderWidth)}px rgba(255,255,255,0.15), 0 ${Math.max(2, Math.round(fontSize * 0.35))}px ${Math.max(6, Math.round(fontSize * 0.45))}px rgba(0,0,0,0.75)`,
            }}
            title={name}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}
