import type { CapabilityCategory, CustomAppModule } from '../types';
import { readLocalString, removeLocalKey, writeLocalJson } from './clientPersist';
import { normalizeCapabilityPreviewUrlForPersist } from './capabilityPreviewUrl';

const LEGACY_CUSTOM_MODULES_KEY = 'ac_custom_modules';

export const CAPABILITY_PRESETS_KEY = 'ac_capability_presets';
export const CAPABILITY_PRESETS_VERSION = 3;
export const BUILTIN_IMAGE_PROCESS_IDS = ['cut_image'] as const;

/** 允许在能力页修改配置的内置预设（如切割溢出）；不可删除，仍走 enforce 合并 */
export const BUILTIN_CAPABILITY_EDITABLE_IDS: readonly string[] = ['cut_image'];

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
  const skipUnderstand = input.skipUnderstand === true;
  const rawGear = (input as CustomAppModule).imageGear;
  const imageGear = rawGear === 'pro' || rawGear === 'fast' || rawGear === 'standard' ? rawGear : 'standard';
  const base: CustomAppModule = {
    ...input,
    category,
    instruction,
    skipUnderstand,
    enabled,
    order,
    imageGear,
    ...(engine ? { engine } : {}),
  };
  if (category === 'generate_3d') {
    // 3D 不使用 engine / imageGear
    delete (base as any).engine;
    delete (base as any).imageGear;
  } else {
    // 非 3D 不应带 generate3D
    delete (base as any).generate3D;
  }
  // 避免把大体积 data URL 写入 localStorage 导致 QUOTA_EXCEEDED_ERR
  if (typeof base.previewImage === 'string' && base.previewImage.trim().startsWith('data:')) {
    delete (base as CustomAppModule & { previewImage?: string }).previewImage;
  }
  if (typeof base.previewOriginalImage === 'string' && base.previewOriginalImage.trim().startsWith('data:')) {
    delete (base as CustomAppModule & { previewOriginalImage?: string }).previewOriginalImage;
  }
  if (typeof base.previewGeneratedImage === 'string' && base.previewGeneratedImage.trim().startsWith('data:')) {
    delete (base as CustomAppModule & { previewGeneratedImage?: string }).previewGeneratedImage;
  }
  if (typeof base.previewOriginalThumbImage === 'string' && base.previewOriginalThumbImage.trim().startsWith('data:')) {
    delete (base as CustomAppModule & { previewOriginalThumbImage?: string }).previewOriginalThumbImage;
  }
  if (typeof base.previewGeneratedThumbImage === 'string' && base.previewGeneratedThumbImage.trim().startsWith('data:')) {
    delete (base as CustomAppModule & { previewGeneratedThumbImage?: string }).previewGeneratedThumbImage;
  }
  const norm = (s: string | undefined, key: keyof CustomAppModule) => {
    if (typeof s !== 'string' || !s.trim()) return;
    const next = normalizeCapabilityPreviewUrlForPersist(s);
    if (next !== s) (base as Record<string, unknown>)[key] = next;
  };
  norm(base.previewImage, 'previewImage');
  norm(base.previewOriginalImage, 'previewOriginalImage');
  norm(base.previewGeneratedImage, 'previewGeneratedImage');
  norm(base.previewOriginalThumbImage, 'previewOriginalThumbImage');
  norm(base.previewGeneratedThumbImage, 'previewGeneratedThumbImage');
  if (base.id === 'cut_image') {
    const rawOv = (input as CustomAppModule).cutOverflowPx;
    if (typeof rawOv === 'number' && Number.isFinite(rawOv)) {
      base.cutOverflowPx = Math.max(0, Math.min(512, Math.round(rawOv)));
    } else {
      delete (base as CustomAppModule & { cutOverflowPx?: number }).cutOverflowPx;
    }
  } else {
    delete (base as CustomAppModule & { cutOverflowPx?: number }).cutOverflowPx;
  }
  return base;
}

const DEFAULT_PRESETS: CustomAppModule[] = [
  { id: 'split_component', label: '拆分组件', category: 'image_process', engine: 'builtin', enabled: true, order: 0, instruction: '' },
  { id: 'style_transfer', label: '转风格', category: 'image_gen', engine: 'gen_image', enabled: true, order: 1, instruction: 'Convert this image to a consistent artistic style: stylized digital art, clean lines, modern flat design. Keep the same composition and main subjects.' },
  { id: 'multi_view', label: '生成多视角', category: 'image_gen', engine: 'gen_image', enabled: true, order: 2, instruction: 'Generate a clean front view of the main object in this image, centered on white or neutral background, orthographic style, suitable as a reference sheet view.' },
  { id: 'cut_image', label: '切割图片', category: 'image_process', engine: 'builtin', enabled: true, order: 3, instruction: '' },
];

const BUILTIN_IMAGE_PROCESS_PRESETS = DEFAULT_PRESETS.filter((p) =>
  BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number])
).map((p, i) => normalizeCapabilityPreset({ ...p, order: i, enabled: true, engine: 'builtin' }, i));

/** 仅内置图像处理能力（如 cut_image）始终存在，其余能力仍走预设体系 */
export function enforceBuiltinImageProcessPresets(list: CustomAppModule[]): CustomAppModule[] {
  const nonBuiltin = list.filter(
    (p) => !BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number])
  );
  const map = new Map<string, CustomAppModule>();
  nonBuiltin.forEach((p, i) => {
    map.set(p.id, normalizeCapabilityPreset(p, i));
  });
  BUILTIN_IMAGE_PROCESS_PRESETS.forEach((p) => {
    const incoming = list.find((x) => x.id === p.id);
    map.set(
      p.id,
      normalizeCapabilityPreset(
        {
          ...p,
          ...(incoming ? incoming : {}),
          id: p.id,
          enabled: true,
          engine: 'builtin',
          category: 'image_process',
        },
        map.size
      )
    );
  });
  const result = Array.from(map.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return result.map((p, i) => ({ ...p, order: i }));
}

export function loadCapabilityPresets(): CustomAppModule[] {
  try {
    let raw = readLocalString(CAPABILITY_PRESETS_KEY);
    if (!raw) {
      raw = readLocalString(LEGACY_CUSTOM_MODULES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = enforceBuiltinImageProcessPresets(
            parsed.map((p: CustomAppModule, i: number) => normalizeCapabilityPreset(p, i))
          );
          saveCapabilityPresets(normalized);
          removeLocalKey(LEGACY_CUSTOM_MODULES_KEY);
          return normalized;
        }
      }
      const def = enforceBuiltinImageProcessPresets(DEFAULT_PRESETS.map((p, i) => normalizeCapabilityPreset(p, i)));
      saveCapabilityPresets(def);
      return def;
    }
    const parsed = JSON.parse(raw);
    // v1: 直接数组
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return enforceBuiltinImageProcessPresets(DEFAULT_PRESETS);
      let normalized = parsed.map((p: CustomAppModule, i: number) => normalizeCapabilityPreset(p, i));
      normalized = enforceBuiltinImageProcessPresets(normalized);
      saveCapabilityPresets(normalized);
      return normalized;
    }
    // v2+: payload
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as CapabilityPresetsPayload).presets)) {
      const list = (parsed as CapabilityPresetsPayload).presets;
      let normalized = list.map((p: CustomAppModule, i: number) => normalizeCapabilityPreset(p, i));
      normalized = enforceBuiltinImageProcessPresets(normalized);
      // 版本不一致或字段缺失时回写一次
      if ((parsed as CapabilityPresetsPayload).version !== CAPABILITY_PRESETS_VERSION) {
        saveCapabilityPresets(normalized);
      }
      return normalized;
    }
    return enforceBuiltinImageProcessPresets(DEFAULT_PRESETS);
  } catch {
    return enforceBuiltinImageProcessPresets(DEFAULT_PRESETS);
  }
}

export function saveCapabilityPresets(list: CustomAppModule[]): void {
  const normalized = enforceBuiltinImageProcessPresets(list.map((p, i) => normalizeCapabilityPreset(p, i)));
  const payload: CapabilityPresetsPayload = { version: CAPABILITY_PRESETS_VERSION, presets: normalized };
  writeLocalJson(CAPABILITY_PRESETS_KEY, payload);
}

/** 合并覆盖：同 id 覆盖；返回完整列表（按 order 重新排序并重排 order） */
export function mergeCapabilityPresets(existing: CustomAppModule[], next: CustomAppModule[]): CustomAppModule[] {
  const nextFiltered = next.filter(
    (p) => !BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number])
  );
  const map = new Map<string, CustomAppModule>();
  existing.forEach((p, i) => {
    const n = normalizeCapabilityPreset(p, i);
    map.set(n.id, n);
  });
  nextFiltered.forEach((p, i) => {
    const n = normalizeCapabilityPreset(p, existing.length + i);
    map.set(n.id, n);
  });
  const list = Array.from(map.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return enforceBuiltinImageProcessPresets(list.map((p, i) => ({ ...p, order: i })));
}

