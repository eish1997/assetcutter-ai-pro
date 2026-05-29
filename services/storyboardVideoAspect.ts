export const STORYBOARD_VIDEO_ASPECT_STORAGE_KEY = 'ac_storyboard_video_aspect_v1';

export type StoryboardVideoAspectPresetId = '16:9' | '9:16' | '4:3' | '1:1';

export type StoryboardVideoAspectPreset = {
  id: StoryboardVideoAspectPresetId;
  label: string;
  width: number;
  height: number;
};

export const STORYBOARD_VIDEO_ASPECT_PRESETS: StoryboardVideoAspectPreset[] = [
  { id: '16:9', label: '16:9', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16', width: 1080, height: 1920 },
  { id: '4:3', label: '4:3', width: 1440, height: 1080 },
  { id: '1:1', label: '1:1', width: 1080, height: 1080 },
];

const PRESET_MAP = Object.fromEntries(
  STORYBOARD_VIDEO_ASPECT_PRESETS.map((p) => [p.id, p])
) as Record<StoryboardVideoAspectPresetId, StoryboardVideoAspectPreset>;

export function getStoryboardVideoAspectPreset(
  id: string | null | undefined
): StoryboardVideoAspectPreset {
  if (id && id in PRESET_MAP) return PRESET_MAP[id as StoryboardVideoAspectPresetId];
  return PRESET_MAP['16:9'];
}
