import type { StoryboardVideoAspectPreset } from './storyboardVideoAspect';

/** 在可用矩形内等比容纳画幅（contain，不裁切） */
export function fitStoryboardAspectInBox(
  availW: number,
  availH: number,
  presetW: number,
  presetH: number
): { width: number; height: number } {
  if (availW <= 0 || availH <= 0 || presetW <= 0 || presetH <= 0) {
    return { width: 0, height: 0 };
  }
  const ar = presetW / presetH;
  let w = availW;
  let h = w / ar;
  if (h > availH) {
    h = availH;
    w = h * ar;
  }
  return { width: Math.max(0, Math.floor(w)), height: Math.max(0, Math.floor(h)) };
}

export function fitStoryboardAspectInBoxFromPreset(
  availW: number,
  availH: number,
  preset: StoryboardVideoAspectPreset
): { width: number; height: number } {
  return fitStoryboardAspectInBox(availW, availH, preset.width, preset.height);
}

export const STORYBOARD_VIDEO_TIMELINE_SHARE_MIN = 0.12;
export const STORYBOARD_VIDEO_TIMELINE_SHARE_MAX = 0.42;
export const STORYBOARD_VIDEO_TIMELINE_SHARE_DEFAULT = 0.18;
/** 分隔条在 flex 布局中占用的总高度（与视频预览 UI 一致） */
export const STORYBOARD_VIDEO_SPLITTER_LAYOUT_PX = 22;

export function clampStoryboardVideoTimelineShare(share: number): number {
  return Math.min(
    STORYBOARD_VIDEO_TIMELINE_SHARE_MAX,
    Math.max(STORYBOARD_VIDEO_TIMELINE_SHARE_MIN, share)
  );
}

export function storyboardVideoPaneHeights(
  bodyHeight: number,
  timelineShare: number,
  splitterPx = 6
): { previewHeight: number; timelineHeight: number } {
  if (bodyHeight <= 0) return { previewHeight: 0, timelineHeight: 0 };
  const minPreview = 140;
  const minTimeline = 72;
  const usable = Math.max(0, bodyHeight - splitterPx);
  let timelineHeight = Math.round(usable * clampStoryboardVideoTimelineShare(timelineShare));
  timelineHeight = Math.max(minTimeline, timelineHeight);
  timelineHeight = Math.min(timelineHeight, usable - minPreview);
  const previewHeight = Math.max(minPreview, usable - timelineHeight);
  return { previewHeight, timelineHeight: usable - previewHeight };
}
