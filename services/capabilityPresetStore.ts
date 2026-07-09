import type { CapabilityCategory, CapabilityEngine, CustomAppModule } from '../types';
import { getBuiltinStoryboardParsePreset, STORYBOARD_PARSE_DEFAULT_PRESET_ID, getBuiltinStoryboardOptimizePreset, STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID } from './storyboardTableParse';
import {
  getBuiltinStoryboardFeedbackCollagePreset,
  STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID,
  DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION,
} from './storyboardTableRedraw';
import {
  STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID,
  DEFAULT_STORYBOARD_ROLE_REPLACE_INSTRUCTION,
  getBuiltinStoryboardRoleReplacePreset,
} from './storyboardRoleReplaceRedraw';
import { readLocalString, removeLocalKey, writeLocalJson } from './clientPersist';
import { normalizeCapabilityPreviewUrlForPersist } from './capabilityPreviewUrl';
import { syncImageProcessProcessorFields } from './capabilityProcessors/imageProcessProcessors';
import { normalizeCapabilityPresetTags } from './capabilityPresetTags';
import { coerceImageModelRegistryId } from './modelRegistry/imageModels';
import { coerceTextModelRegistryId } from './modelRegistry/textModels';

const LEGACY_CUSTOM_MODULES_KEY = 'ac_custom_modules';

export const CAPABILITY_PRESETS_KEY = 'ac_capability_presets';
export const CAPABILITY_PRESETS_VERSION = 5;
export const BUILTIN_IMAGE_PROCESS_IDS = ['cut_image'] as const;

/** 允许在能力页修改配置的内置预设（如切割溢出）；不可删除，仍走 enforce 合并 */
export const BUILTIN_CAPABILITY_EDITABLE_IDS: readonly string[] = ['cut_image'];

type CapabilityPresetsPayload = {
  version: number;
  presets: CustomAppModule[];
};

function migrateCapabilityCategory(input: CustomAppModule): CapabilityCategory {
  const raw = String(input.category ?? '');
  if (
    raw === 'text_to_text' ||
    raw === 'text_to_image' ||
    raw === 'image_to_image' ||
    raw === 'image_process' ||
    raw === 'image_to_text' ||
    raw === 'generate_3d' ||
    raw === 'generate_video'
  ) {
    return raw as CapabilityCategory;
  }
  if (raw === 'image_gen') return 'image_to_image';
  if (raw === 'text_llm') return input.engine === 'gen_image' ? 'text_to_image' : 'text_to_text';
  return input.instruction ? 'image_to_image' : 'image_to_image';
}

function deriveEngineForCategory(category: CapabilityCategory, input: CustomAppModule, rawCat: string): CapabilityEngine | undefined {
  if (category === 'generate_3d' || category === 'generate_video') return undefined;
  if (category === 'text_to_text' || category === 'image_to_text') return 'gen_text';
  if (category === 'text_to_image') return 'gen_image';
  if (category === 'image_process') return 'builtin';
  if (category === 'image_to_image') {
    if (input.companionSamSegment === true) return 'builtin';
    if (input.companionRembg === true) return 'builtin';
    if (input.engine === 'gen_image' || input.engine === 'builtin') return input.engine;
    if (input.id === 'split_component' || input.id === 'cut_image') return 'builtin';
    return 'gen_image';
  }
  if (input.engine === 'gen_image' || input.engine === 'builtin') return input.engine;
  if (rawCat === 'image_process') return 'builtin';
  if (rawCat === 'image_gen') return 'gen_image';
  return 'gen_image';
}

function normalizeGenerate3DPreset(input: NonNullable<CustomAppModule['generate3D']>): NonNullable<CustomAppModule['generate3D']> {
  const out = { ...input };
  const tripoVersion = String(out.tripoModelVersion || '').trim();
  const allowedTripoVersions = new Set([
    'P1-20260311',
    'v3.1-20260211',
    'v3.0-20250812',
    'v2.5-20250123',
    'v2.0-20240919',
  ]);
  if (out.module !== 'pro' && out.module !== 'rapid') out.module = 'pro';
  if (out.provider !== 'tencent' && out.provider !== 'tripo') out.provider = 'tripo';
  if (
    out.tripoTaskType !== 'text_to_model' &&
    out.tripoTaskType !== 'image_to_model' &&
    out.tripoTaskType !== 'multiview_to_model'
  ) {
    out.tripoTaskType = 'image_to_model';
  }
  if (tripoVersion) {
    if (!allowedTripoVersions.has(tripoVersion)) {
      delete (out as NonNullable<CustomAppModule['generate3D']> & { tripoModelVersion?: string }).tripoModelVersion;
    } else {
      out.tripoModelVersion = tripoVersion;
    }
  } else {
    delete (out as NonNullable<CustomAppModule['generate3D']> & { tripoModelVersion?: string }).tripoModelVersion;
  }
  if (out.tripoGeometryQuality !== 'standard' && out.tripoGeometryQuality !== 'detailed') {
    delete (out as NonNullable<CustomAppModule['generate3D']> & { tripoGeometryQuality?: 'standard' | 'detailed' }).tripoGeometryQuality;
  }
  if (out.tripoTextureQuality !== 'standard' && out.tripoTextureQuality !== 'detailed') out.tripoTextureQuality = 'standard';
  if (out.tripoTextureAlignment !== 'original_image' && out.tripoTextureAlignment !== 'geometry') {
    delete (out as NonNullable<CustomAppModule['generate3D']> & { tripoTextureAlignment?: 'original_image' | 'geometry' }).tripoTextureAlignment;
  }
  if (out.tripoOrientation !== 'default' && out.tripoOrientation !== 'align_image') {
    delete (out as NonNullable<CustomAppModule['generate3D']> & { tripoOrientation?: 'default' | 'align_image' }).tripoOrientation;
  }
  if (typeof out.tripoFaceLimit === 'number' && Number.isFinite(out.tripoFaceLimit)) {
    out.tripoFaceLimit = Math.max(500, Math.min(500000, Math.floor(out.tripoFaceLimit)));
  } else {
    delete (out as NonNullable<CustomAppModule['generate3D']> & { tripoFaceLimit?: number }).tripoFaceLimit;
  }
  if (out.model !== '3.0' && out.model !== '3.1') out.model = '3.0';
  if (typeof out.faceCount === 'number' && Number.isFinite(out.faceCount)) {
    out.faceCount = Math.max(10000, Math.min(1500000, Math.floor(out.faceCount)));
  } else {
    delete (out as NonNullable<CustomAppModule['generate3D']> & { faceCount?: number }).faceCount;
  }
  return out;
}

/** 内置预设：未显式 `skipUnderstand: false` 时继承种子默认（避免 R2/本地旧 JSON 缺字段仍走理解步） */
const SEED_SKIP_UNDERSTAND_BY_ID: Record<string, true> = {
  style_transfer: true,
};

/** 图生图且已有固定 instruction → 默认直发（只 1 次生图），除非显式 `skipUnderstand: false` */
function resolveSkipUnderstandDefault(
  input: CustomAppModule,
  category: CustomAppModule['category'],
  engine: CustomAppModule['engine'] | undefined,
  instruction: string
): boolean {
  if (input.skipUnderstand === true) return true;
  if (input.skipUnderstand === false) return false;
  if (SEED_SKIP_UNDERSTAND_BY_ID[input.id] === true) return true;
  if (category === 'image_to_image' && engine === 'gen_image' && instruction.trim().length > 0) {
    return true;
  }
  return false;
}

export function normalizeCapabilityPreset(input: CustomAppModule, index: number): CustomAppModule {
  const rawCat = String(input.category ?? '');
  const bundleDir =
    typeof input.companionHostBundle?.dirName === 'string' ? input.companionHostBundle.dirName.trim() : '';
  let category = migrateCapabilityCategory(input);
  if (
    bundleDir &&
    category !== 'image_process' &&
    category !== 'generate_3d' &&
    category !== 'generate_video'
  ) {
    category = 'image_process';
  }
  let engine = deriveEngineForCategory(category, input, rawCat);
  if (category === 'image_to_image' && engine === 'builtin') {
    category = 'image_process';
    engine = 'builtin';
  }
  const enabled = input.enabled !== false;
  const order = typeof input.order === 'number' ? input.order : index;
  const instruction = typeof input.instruction === 'string' ? input.instruction : '';
  const skipUnderstand = resolveSkipUnderstandDefault(input, category, engine, instruction);
  const requirePromptOnTextDrop = input.requirePromptOnTextDrop === true;
  const rawGear = (input as CustomAppModule).imageGear;
  const rawModel = (input as CustomAppModule).imageModelRegistryId;
  const imageModelRegistryId = coerceImageModelRegistryId(
    (typeof rawModel === 'string' && rawModel.trim()) || rawGear || undefined
  );
  const rawTextModel = (input as CustomAppModule).textModelRegistryId;
  const textModelRegistryId =
    category === 'text_to_text' || category === 'image_to_text'
      ? coerceTextModelRegistryId(typeof rawTextModel === 'string' ? rawTextModel : undefined)
      : undefined;
  const base: CustomAppModule = {
    ...input,
    category,
    instruction,
    skipUnderstand,
    requirePromptOnTextDrop,
    enabled,
    order,
    imageModelRegistryId,
    ...(textModelRegistryId ? { textModelRegistryId } : {}),
    ...(engine ? { engine } : {}),
  };
  delete (base as CustomAppModule & { imageGear?: string }).imageGear;
  if (category === 'generate_3d') {
    // 3D 不使用 engine / 生图模型
    delete (base as any).engine;
    delete (base as any).imageGear;
    delete (base as any).imageModelRegistryId;
    delete (base as CustomAppModule & { textModelRegistryId?: string }).textModelRegistryId;
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
    if (base.generate3D) {
      base.generate3D = normalizeGenerate3DPreset(base.generate3D);
    }
  } else if (category === 'generate_video') {
    delete (base as any).engine;
    delete (base as any).imageGear;
    delete (base as any).imageModelRegistryId;
    delete (base as CustomAppModule & { textModelRegistryId?: string }).textModelRegistryId;
    delete (base as CustomAppModule & { generate3D?: unknown }).generate3D;
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
  } else {
    // 非 3D 不应带 generate3D
    delete (base as any).generate3D;
    if (category !== 'text_to_text' && category !== 'image_to_text') {
      delete (base as CustomAppModule & { textModelRegistryId?: string }).textModelRegistryId;
    }
    if (category !== 'text_to_image' && category !== 'image_to_image') {
      delete (base as any).imageGear;
      delete (base as any).imageModelRegistryId;
    }
  }
  if (category !== 'text_to_text') {
    delete (base as CustomAppModule & { requirePromptOnTextDrop?: boolean }).requirePromptOnTextDrop;
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
  if (category === 'generate_3d' || category === 'generate_video' || base.id === 'cut_image') {
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
    delete (base as CustomAppModule & { companionSamSegment?: unknown }).companionSamSegment;
    delete (base as CustomAppModule & { companionRembg?: unknown }).companionRembg;
    delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
    delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
  }
  if (base.companionSamSegment === true) {
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
    delete (base as CustomAppModule & { companionRembg?: unknown }).companionRembg;
    delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
    delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
  }
  if (base.companionRembg === true) {
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
    delete (base as CustomAppModule & { companionSamSegment?: unknown }).companionSamSegment;
  }
  if (base.companionHostBundle?.dirName?.trim()) {
    delete (base as CustomAppModule & { companionSamSegment?: unknown }).companionSamSegment;
    delete (base as CustomAppModule & { companionRembg?: unknown }).companionRembg;
    delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
    delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
  }
  if (base.id === 'companion_sam_segment') {
    base.companionSamSegment = true;
    base.category = 'image_process';
    base.engine = 'builtin';
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
    delete (base as CustomAppModule & { companionRembg?: unknown }).companionRembg;
    delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
    delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
  }
  if (base.id === 'companion_remove_bg') {
    base.companionRembg = true;
    base.category = 'image_process';
    base.engine = 'builtin';
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
    delete (base as CustomAppModule & { companionSamSegment?: unknown }).companionSamSegment;
    const mm = typeof (input as CustomAppModule).companionRembgModel === 'string' ? (input as CustomAppModule).companionRembgModel!.trim() : '';
    if (mm) base.companionRembgModel = mm.slice(0, 64);
    else delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
    if ((input as CustomAppModule).companionRembgAlphaMatting === true) base.companionRembgAlphaMatting = true;
    else delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
  }
  if (base.companionSamSegment !== true) {
    delete (base as CustomAppModule & { companionSamSegment?: unknown }).companionSamSegment;
  }
  if (base.companionRembg !== true) {
    delete (base as CustomAppModule & { companionRembg?: unknown }).companionRembg;
    delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
    delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
  }
  if (category !== 'image_process') {
    delete (base as CustomAppModule & { companionSamSegment?: unknown }).companionSamSegment;
    delete (base as CustomAppModule & { companionRembg?: unknown }).companionRembg;
    delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
    delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
    delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
  }
  const tags = normalizeCapabilityPresetTags(input.tags);
  if (tags) base.tags = tags;
  else delete (base as CustomAppModule & { tags?: string[] }).tags;
  return syncImageProcessProcessorFields(base);
}

const DEFAULT_PRESETS: CustomAppModule[] = [
  {
    id: 'generate_video',
    label: '生成视频',
    category: 'generate_video',
    enabled: false,
    order: 100,
    instruction: '短视频，平滑镜头运动，电影感光效，高细节。',
  },
  { id: 'split_component', label: '拆分组件', category: 'image_process', processor: 'split_component', engine: 'builtin', enabled: true, order: 0, instruction: '' },
  { id: 'style_transfer', label: '转风格', category: 'image_to_image', engine: 'gen_image', enabled: true, order: 1, skipUnderstand: true, instruction: 'Convert this image to a consistent artistic style: stylized digital art, clean lines, modern flat design. Keep the same composition and main subjects.' },
  { id: 'multi_view', label: '生成多视角', category: 'image_to_image', engine: 'gen_image', enabled: true, order: 2, instruction: 'Generate a clean front view of the main object in this image, centered on white or neutral background, orthographic style, suitable as a reference sheet view.' },
  {
    id: 'cut_image',
    label: '切割图片',
    category: 'image_process',
    processor: 'cut_image',
    engine: 'builtin',
    enabled: true,
    order: 3,
    instruction: '',
    params: { cutMode: 'auto', uniformRows: 2, uniformCols: 2, cutOverflowPx: 0 },
  },
  {
    id: 'companion_sam_segment',
    label: '本机智能分割',
    category: 'image_process',
    processor: 'sam_segment',
    engine: 'builtin',
    enabled: true,
    order: 4,
    instruction:
      '队列执行时在图像中心取前景点并调用本机 SamLocal（需伴侣与 SamLocal）；精细点选请用大图「本机分割」十字工具。',
    companionSamSegment: true,
  },
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
  const ENSURE_PRESET_IDS = ['companion_sam_segment'] as const;
  let merged = result;
  for (const id of ENSURE_PRESET_IDS) {
    if (!merged.some((p) => p.id === id)) {
      const seed = DEFAULT_PRESETS.find((p) => p.id === id);
      if (seed) merged = [...merged, normalizeCapabilityPreset({ ...seed }, merged.length)];
    }
  }
  merged = merged.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!merged.some((p) => p.id === STORYBOARD_PARSE_DEFAULT_PRESET_ID)) {
    merged = [
      ...merged,
      normalizeCapabilityPreset(getBuiltinStoryboardParsePreset(), merged.length),
    ];
  }
  if (!merged.some((p) => p.id === STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID)) {
    merged = [
      ...merged,
      normalizeCapabilityPreset(getBuiltinStoryboardOptimizePreset(), merged.length),
    ];
  }
  if (!merged.some((p) => p.id === STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID)) {
    merged = [
      ...merged,
      normalizeCapabilityPreset(getBuiltinStoryboardFeedbackCollagePreset(), merged.length),
    ];
  } else {
    merged = merged.map((p) =>
      p.id === STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID && !(p.instruction || '').trim()
        ? { ...p, instruction: DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION }
        : p
    );
  }
  if (!merged.some((p) => p.id === STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID)) {
    merged = [
      ...merged,
      normalizeCapabilityPreset(getBuiltinStoryboardRoleReplacePreset(), merged.length),
    ];
  } else {
    merged = merged.map((p) =>
      p.id === STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID && !(p.instruction || '').trim()
        ? { ...p, instruction: DEFAULT_STORYBOARD_ROLE_REPLACE_INSTRUCTION }
        : p
    );
  }
  return merged.map((p, i) => ({ ...p, order: i }));
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

/** 同 id 去重，保留列表中最后一次出现（用于多能力包目录合并） */
export function dedupeCapabilityPresetsById(presets: CustomAppModule[]): CustomAppModule[] {
  const map = new Map<string, CustomAppModule>();
  for (const p of presets) {
    const id = String(p?.id || '').trim();
    if (!id) continue;
    map.set(id, p);
  }
  return Array.from(map.values());
}

/**
 * 合并预设列表：`incoming`（通常为服务器/R2 拉取）与 `existing`（本地）同 id 时以 incoming 为准；
 * 仅存在于本地的 id 保留。返回完整列表（按 order 重新排序并重排 order）。
 */
export function mergeCapabilityPresets(existing: CustomAppModule[], incoming: CustomAppModule[]): CustomAppModule[] {
  const incomingFiltered = incoming.filter(
    (p) => !BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number])
  );
  const map = new Map<string, CustomAppModule>();
  existing.forEach((p, i) => {
    const n = normalizeCapabilityPreset(p, i);
    map.set(n.id, n);
  });
  incomingFiltered.forEach((p, i) => {
    const n = normalizeCapabilityPreset(p, existing.length + i);
    map.set(n.id, n);
  });
  const list = Array.from(map.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return enforceBuiltinImageProcessPresets(list.map((p, i) => ({ ...p, order: i })));
}
