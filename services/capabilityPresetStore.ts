import type { CapabilityCategory, CustomAppModule } from '../types';

export const CAPABILITY_PRESETS_KEY = 'ac_capability_presets';
export const CAPABILITY_PRESETS_VERSION = 3;

type CapabilityPresetsPayload = {
  version: number;
  presets: CustomAppModule[];
};

export function normalizeCapabilityPreset(input: CustomAppModule, index: number): CustomAppModule {
  const category: CapabilityCategory =
    (input.category as CapabilityCategory) ?? (input.instruction ? 'image_gen' : 'image_process');
  const engine =
    category === 'image_gen'
      ? 'gen_image'
      : category === 'image_process'
        ? (input.engine ?? 'builtin')
        : undefined;
  const enabled = input.enabled !== false;
  const order = typeof input.order === 'number' ? input.order : index;
  const instruction = typeof input.instruction === 'string' ? input.instruction : '';
  const imageGear = (input as CustomAppModule).imageGear === 'pro' ? 'pro' : 'fast';
  const base: CustomAppModule = {
    ...input,
    category,
    instruction,
    enabled,
    order,
    imageGear,
    ...(engine ? { engine } : {}),
  };
  if (category === 'generate_3d') {
    // 3D 不使用 engine / imageGear
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (base as any).engine;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (base as any).imageGear;
  } else {
    // 非 3D 不应带 generate3D
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (base as any).generate3D;
  }
  return base;
}

const DEFAULT_PRESETS: CustomAppModule[] = [
  { id: 'split_component', label: '拆分组件', category: 'image_process', engine: 'builtin', enabled: true, order: 0, instruction: '' },
  { id: 'style_transfer', label: '转风格', category: 'image_gen', engine: 'gen_image', enabled: true, order: 1, instruction: 'Convert this image to a consistent artistic style: stylized digital art, clean lines, modern flat design. Keep the same composition and main subjects.' },
  { id: 'multi_view', label: '生成多视角', category: 'image_gen', engine: 'gen_image', enabled: true, order: 2, instruction: 'Generate a clean front view of the main object in this image, centered on white or neutral background, orthographic style, suitable as a reference sheet view.' },
  { id: 'cut_image', label: '切割图片', category: 'image_process', engine: 'builtin', enabled: true, order: 3, instruction: '' },
];

export function loadCapabilityPresets(): CustomAppModule[] {
  try {
    let raw = localStorage.getItem(CAPABILITY_PRESETS_KEY);
    if (!raw) {
      raw = localStorage.getItem('ac_custom_modules');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = parsed.map((p: CustomAppModule, i: number) => normalizeCapabilityPreset(p, i));
          saveCapabilityPresets(normalized);
          localStorage.removeItem('ac_custom_modules');
          return normalized;
        }
      }
      const def = DEFAULT_PRESETS.map((p, i) => normalizeCapabilityPreset(p, i));
      saveCapabilityPresets(def);
      return def;
    }
    const parsed = JSON.parse(raw);
    // v1: 直接数组
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return DEFAULT_PRESETS;
      const normalized = parsed.map((p: CustomAppModule, i: number) => normalizeCapabilityPreset(p, i));
      saveCapabilityPresets(normalized);
      return normalized;
    }
    // v2+: payload
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as CapabilityPresetsPayload).presets)) {
      const list = (parsed as CapabilityPresetsPayload).presets;
      const normalized = list.map((p: CustomAppModule, i: number) => normalizeCapabilityPreset(p, i));
      // 版本不一致或字段缺失时回写一次
      if ((parsed as CapabilityPresetsPayload).version !== CAPABILITY_PRESETS_VERSION) {
        saveCapabilityPresets(normalized);
      }
      return normalized;
    }
    return DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

export function saveCapabilityPresets(list: CustomAppModule[]): void {
  const normalized = list.map((p, i) => normalizeCapabilityPreset(p, i));
  const payload: CapabilityPresetsPayload = { version: CAPABILITY_PRESETS_VERSION, presets: normalized };
  localStorage.setItem(CAPABILITY_PRESETS_KEY, JSON.stringify(payload));
}

/** 合并覆盖：同 id 覆盖；返回完整列表（按 order 重新排序并重排 order） */
export function mergeCapabilityPresets(existing: CustomAppModule[], next: CustomAppModule[]): CustomAppModule[] {
  const map = new Map<string, CustomAppModule>();
  existing.forEach((p, i) => {
    const n = normalizeCapabilityPreset(p, i);
    map.set(n.id, n);
  });
  next.forEach((p, i) => {
    const n = normalizeCapabilityPreset(p, existing.length + i);
    map.set(n.id, n);
  });
  const list = Array.from(map.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return list.map((p, i) => ({ ...p, order: i }));
}

