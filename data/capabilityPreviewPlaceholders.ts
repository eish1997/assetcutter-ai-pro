import type { CapabilityCategory } from '../types';

/** 站内静态占位图（随部署提供；上传 R2 的 JSON 可存相对路径，他人同步后同源可加载） */
export const CAPABILITY_PREVIEW_PLACEHOLDER_ASSETS: { id: string; label: string; url: string }[] = [
  { id: 'image_gen', label: '生图', url: '/capability-presets/previews/image_gen.svg' },
  { id: 'image_process', label: '图像处理', url: '/capability-presets/previews/image_process.svg' },
  { id: 'generate_3d', label: '生成3D', url: '/capability-presets/previews/generate_3d.svg' },
  { id: 'neutral', label: '通用', url: '/capability-presets/previews/neutral.svg' },
];

export function defaultCapabilityPreviewUrl(category: CapabilityCategory): string {
  if (category === 'image_process') return '/capability-presets/previews/image_process.svg';
  if (category === 'generate_3d') return '/capability-presets/previews/generate_3d.svg';
  if (category === 'image_gen') return '/capability-presets/previews/image_gen.svg';
  return '/capability-presets/previews/neutral.svg';
}
