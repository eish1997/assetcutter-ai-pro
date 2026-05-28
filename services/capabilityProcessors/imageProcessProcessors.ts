import type { CustomAppModule } from '../../types';

export const IMAGE_PROCESS_PROCESSORS = [
  {
    id: 'cut_image',
    label: '切割图片',
    desc: '按宫格或视觉识别切割为多张图（工作流专用）',
  },
  {
    id: 'split_component',
    label: '拆分组件',
    desc: '识别图中最大物体区域并裁剪',
  },
  {
    id: 'sam_segment',
    label: '本机智能分割',
    desc: '本机 SamLocal 分割（需伴侣；队列执行时用图像中心点）',
  },
  {
    id: 'remove_bg',
    label: '去背景',
    desc: '本机 Python rembg 抠图（需伴侣与 rembg 环境）',
  },
  {
    id: 'host_bundle',
    label: '本机扩展包',
    desc: '提交已安装扩展包 run.json（exec / probe）',
  },
] as const;

export type ImageProcessorId = (typeof IMAGE_PROCESS_PROCESSORS)[number]['id'];

export type CutImageMode = 'uniform' | 'auto' | 'vision';

export type CutImageProcessorParams = {
  cutMode: CutImageMode;
  cutOverflowPx: number;
  uniformRows: number;
  uniformCols: number;
};

const PROCESSOR_ID_SET = new Set<string>(IMAGE_PROCESS_PROCESSORS.map((p) => p.id));

/** 读取已持久化 JSON 顶层的 cut_image 旧字段（仅 normalize 迁移用） */
function readLegacyCutImageTopLevelFields(preset: CustomAppModule): Record<string, unknown> {
  const raw = preset as CustomAppModule & {
    cutMode?: unknown;
    cutOverflowPx?: unknown;
    uniformRows?: unknown;
    uniformCols?: unknown;
  };
  const out: Record<string, unknown> = {};
  if (raw.cutMode === 'uniform' || raw.cutMode === 'auto' || raw.cutMode === 'vision') {
    out.cutMode = raw.cutMode;
  }
  if (typeof raw.cutOverflowPx === 'number' && Number.isFinite(raw.cutOverflowPx)) {
    out.cutOverflowPx = raw.cutOverflowPx;
  }
  if (typeof raw.uniformRows === 'number' && Number.isFinite(raw.uniformRows)) {
    out.uniformRows = raw.uniformRows;
  }
  if (typeof raw.uniformCols === 'number' && Number.isFinite(raw.uniformCols)) {
    out.uniformCols = raw.uniformCols;
  }
  return out;
}

export function stripCutImageLegacyTopLevelFields(base: CustomAppModule): void {
  delete (base as CustomAppModule & { cutOverflowPx?: number }).cutOverflowPx;
  delete (base as CustomAppModule & { cutMode?: string }).cutMode;
  delete (base as CustomAppModule & { uniformRows?: number }).uniformRows;
  delete (base as CustomAppModule & { uniformCols?: number }).uniformCols;
}

export const REMBG_MODEL_OPTIONS = [
  { value: '', label: '默认（u2net）' },
  { value: 'u2net', label: 'u2net' },
  { value: 'u2netp', label: 'u2netp' },
  { value: 'u2net_human_seg', label: 'u2net_human_seg' },
  { value: 'silueta', label: 'silueta' },
  { value: 'isnet-general-use', label: 'isnet-general-use' },
  { value: 'isnet-anime', label: 'isnet-anime' },
  { value: 'birefnet-general', label: 'birefnet-general' },
  { value: 'birefnet-general-lite', label: 'birefnet-general-lite' },
  { value: 'birefnet-portrait', label: 'birefnet-portrait' },
] as const;

const REMBG_MODEL_SET = new Set<string>(REMBG_MODEL_OPTIONS.map((o) => o.value).filter(Boolean));

export function isImageProcessorId(raw: unknown): raw is ImageProcessorId {
  return typeof raw === 'string' && PROCESSOR_ID_SET.has(raw);
}

export function labelForImageProcessorId(id: ImageProcessorId | string | undefined): string {
  if (!id) return '图像处理';
  return IMAGE_PROCESS_PROCESSORS.find((p) => p.id === id)?.label ?? id;
}

/** 从预设解析处理器 id（优先显式 processor，再 legacy 字段 / 内置 id） */
export function resolveImageProcessorId(preset: CustomAppModule): ImageProcessorId | undefined {
  if (isImageProcessorId(preset.processor)) return preset.processor;
  if (preset.companionHostBundle?.dirName?.trim()) return 'host_bundle';
  if (preset.companionSamSegment === true || preset.id === 'companion_sam_segment') return 'sam_segment';
  if (preset.companionRembg === true || preset.id === 'companion_remove_bg') return 'remove_bg';
  if (preset.id === 'cut_image' || preset.processor === 'cut_image') return 'cut_image';
  if (readLegacyCutImageTopLevelFields(preset).cutMode != null) return 'cut_image';
  if (preset.id === 'split_component') return 'split_component';
  return undefined;
}

/** 是否为「切割图片」处理器（含自定义 id 的 image_process 预设） */
export function isCutImageCapabilityPreset(preset: CustomAppModule | null | undefined): boolean {
  if (!preset) return false;
  return resolveImageProcessorId(preset) === 'cut_image';
}

function readParamsObject(preset: CustomAppModule): Record<string, unknown> {
  const raw = preset.params;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

export function normalizeProcessorParams(
  processorId: ImageProcessorId,
  raw: Record<string, unknown>
): Record<string, unknown> {
  switch (processorId) {
    case 'cut_image': {
      const cutMode =
        raw.cutMode === 'uniform' || raw.cutMode === 'auto' || raw.cutMode === 'vision' ? raw.cutMode : 'auto';
      const out: Record<string, unknown> = { cutMode };
      const rawOv = raw.cutOverflowPx;
      if (typeof rawOv === 'number' && Number.isFinite(rawOv)) {
        out.cutOverflowPx = Math.max(0, Math.min(512, Math.round(rawOv)));
      }
      if (cutMode === 'uniform') {
        const rawRows = raw.uniformRows;
        const rawCols = raw.uniformCols;
        out.uniformRows =
          typeof rawRows === 'number' && Number.isFinite(rawRows) ? Math.max(1, Math.min(10, Math.round(rawRows))) : 2;
        out.uniformCols =
          typeof rawCols === 'number' && Number.isFinite(rawCols) ? Math.max(1, Math.min(10, Math.round(rawCols))) : 2;
      }
      const instr = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
      if (instr) out.instruction = instr;
      return out;
    }
    case 'split_component': {
      const instr = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
      return instr ? { instruction: instr } : {};
    }
    case 'sam_segment': {
      const instr = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
      return instr ? { instruction: instr } : {};
    }
    case 'remove_bg': {
      const out: Record<string, unknown> = {};
      const model = typeof raw.model === 'string' ? raw.model.trim() : '';
      if (model && REMBG_MODEL_SET.has(model)) out.model = model;
      if (raw.alphaMatting === true) out.alphaMatting = true;
      const instr = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
      if (instr) out.instruction = instr;
      return out;
    }
    case 'host_bundle': {
      const dirName = typeof raw.dirName === 'string' ? raw.dirName.trim() : '';
      if (!dirName) return {};
      const phase = raw.phase === 'probe' ? 'probe' : 'exec';
      return phase === 'probe' ? { dirName, phase: 'probe' } : { dirName, phase: 'exec' };
    }
    default:
      return {};
  }
}

export function presetUsesHostBundleProcessor(preset: CustomAppModule): boolean {
  return resolveImageProcessorId(preset) === 'host_bundle';
}

/** 从预设 legacy 字段提取 params（用于迁移） */
export function extractProcessorParamsFromPreset(
  preset: CustomAppModule,
  processorId: ImageProcessorId
): Record<string, unknown> {
  switch (processorId) {
    case 'cut_image':
      return normalizeProcessorParams('cut_image', {
        ...readLegacyCutImageTopLevelFields(preset),
        instruction: preset.instruction,
      });
    case 'split_component':
      return normalizeProcessorParams('split_component', { instruction: preset.instruction });
    case 'sam_segment':
      return normalizeProcessorParams('sam_segment', { instruction: preset.instruction });
    case 'remove_bg':
      return normalizeProcessorParams('remove_bg', {
        model: preset.companionRembgModel,
        alphaMatting: preset.companionRembgAlphaMatting,
        instruction: preset.instruction,
      });
    case 'host_bundle':
      return normalizeProcessorParams('host_bundle', {
        dirName: preset.companionHostBundle?.dirName,
        phase: preset.companionHostBundle?.phase,
      });
    default:
      return {};
  }
}

function clearImageProcessorLegacyFields(base: CustomAppModule): void {
  stripCutImageLegacyTopLevelFields(base);
  delete (base as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
  delete (base as CustomAppModule & { companionSamSegment?: unknown }).companionSamSegment;
  delete (base as CustomAppModule & { companionRembg?: unknown }).companionRembg;
  delete (base as CustomAppModule & { companionRembgModel?: unknown }).companionRembgModel;
  delete (base as CustomAppModule & { companionRembgAlphaMatting?: unknown }).companionRembgAlphaMatting;
}

/** 将 processor + params 写回 legacy 字段，供现有执行链使用 */
export function applyProcessorLegacyFields(
  base: CustomAppModule,
  processorId: ImageProcessorId,
  params: Record<string, unknown>
): void {
  clearImageProcessorLegacyFields(base);
  switch (processorId) {
    case 'cut_image':
      break;
    case 'split_component':
      break;
    case 'sam_segment':
      base.companionSamSegment = true;
      break;
    case 'remove_bg':
      base.companionRembg = true;
      if (typeof params.model === 'string' && params.model.trim() && REMBG_MODEL_SET.has(params.model.trim())) {
        base.companionRembgModel = params.model.trim().slice(0, 64);
      }
      if (params.alphaMatting === true) base.companionRembgAlphaMatting = true;
      break;
    case 'host_bundle': {
      const dirName = typeof params.dirName === 'string' ? params.dirName.trim() : '';
      if (dirName) {
        base.companionHostBundle =
          params.phase === 'probe' ? { dirName, phase: 'probe' } : { dirName };
      }
      break;
    }
    default:
      break;
  }
  const instr = typeof params.instruction === 'string' ? params.instruction : undefined;
  if (instr !== undefined && processorId !== 'cut_image') {
    base.instruction = instr;
  }
}

/** 执行链读取 remove_bg 配置（canonical：`params`，兼容 legacy `companionRembg*`） */
export function readRemoveBgParams(preset: CustomAppModule): {
  model?: string;
  alphaMatting: boolean;
} {
  const merged = {
    ...extractProcessorParamsFromPreset(preset, 'remove_bg'),
    ...readParamsObject(preset),
  };
  const params = normalizeProcessorParams('remove_bg', merged);
  const model = typeof params.model === 'string' ? params.model.trim() : '';
  return {
    model: model || undefined,
    alphaMatting: params.alphaMatting === true,
  };
}

/** 执行链读取 cut_image 配置（canonical：`params`；旧 JSON 顶字段仅在 normalize 时迁移） */
export function readCutImageParams(preset: CustomAppModule): CutImageProcessorParams {
  const merged = { ...readLegacyCutImageTopLevelFields(preset), ...readParamsObject(preset) };
  const params = normalizeProcessorParams('cut_image', merged);
  const cutMode =
    params.cutMode === 'uniform' || params.cutMode === 'auto' || params.cutMode === 'vision'
      ? params.cutMode
      : 'auto';
  return {
    cutMode,
    cutOverflowPx: typeof params.cutOverflowPx === 'number' ? params.cutOverflowPx : 0,
    uniformRows: typeof params.uniformRows === 'number' ? params.uniformRows : 2,
    uniformCols: typeof params.uniformCols === 'number' ? params.uniformCols : 2,
  };
}

/** normalize 末尾：图像处理预设统一写入 processor/params 并同步 legacy */
export function syncImageProcessProcessorFields(base: CustomAppModule): CustomAppModule {
  if (base.category !== 'image_process') {
    delete (base as CustomAppModule & { processor?: string }).processor;
    delete (base as CustomAppModule & { params?: Record<string, unknown> }).params;
    clearImageProcessorLegacyFields(base);
    return base;
  }
  const processorId = resolveImageProcessorId(base);
  if (!processorId) {
    delete (base as CustomAppModule & { processor?: string }).processor;
    delete (base as CustomAppModule & { params?: Record<string, unknown> }).params;
    return base;
  }
  const fromParams = readParamsObject(base);
  const mergedRaw =
    processorId === 'cut_image'
      ? { ...readLegacyCutImageTopLevelFields(base), ...fromParams }
      : Object.keys(fromParams).length > 0
        ? fromParams
        : extractProcessorParamsFromPreset(base, processorId);
  const params = normalizeProcessorParams(processorId, mergedRaw);
  base.processor = processorId;
  base.params = Object.keys(params).length > 0 ? params : undefined;
  if (processorId === 'cut_image' && typeof params.instruction === 'string') {
    base.instruction = params.instruction;
  } else {
    applyProcessorLegacyFields(base, processorId, params);
  }
  stripCutImageLegacyTopLevelFields(base);
  return base;
}

/** 表单保存：由 processor + params 构建预设字段 */
export function applyImageProcessorDraftToPreset(
  preset: CustomAppModule,
  processorId: ImageProcessorId,
  rawParams: Record<string, unknown>
): CustomAppModule {
  const params = normalizeProcessorParams(processorId, rawParams);
  const next: CustomAppModule = {
    ...preset,
    category: 'image_process',
    engine: 'builtin',
    processor: processorId,
    params: Object.keys(params).length > 0 ? params : undefined,
  };
  clearImageProcessorLegacyFields(next);
  if (processorId === 'cut_image') {
    if (typeof params.instruction === 'string') next.instruction = params.instruction;
  } else {
    applyProcessorLegacyFields(next, processorId, params);
    next.instruction = typeof params.instruction === 'string' ? params.instruction : '';
  }
  stripCutImageLegacyTopLevelFields(next);
  delete (next as CustomAppModule & { imageModelRegistryId?: string }).imageModelRegistryId;
  delete (next as CustomAppModule & { imageAspectRatio?: string }).imageAspectRatio;
  delete (next as CustomAppModule & { imageSize?: string }).imageSize;
  delete (next as CustomAppModule & { skipUnderstand?: boolean }).skipUnderstand;
  return next;
}

export function readImageProcessorParamsForForm(
  preset: CustomAppModule,
  processorId: ImageProcessorId
): Record<string, unknown> {
  const fromStored = readParamsObject(preset);
  if (Object.keys(fromStored).length > 0) {
    return normalizeProcessorParams(processorId, fromStored);
  }
  return extractProcessorParamsFromPreset(preset, processorId);
}
