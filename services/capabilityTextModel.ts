import type { CustomAppModule } from '../types';
import { DEFAULT_MODEL_TEXT } from './modelRegistry/constants';
import { coerceTextModelRegistryId } from './modelRegistry/textModels';

/** 能力执行时解析文字/理解模型所需的最小上下文（避免 storyboard ↔ executor 循环依赖） */
export type CapabilityTextModelContext = {
  textModelRegistryId?: string;
};

export function resolveTextModelFromContext(ctx: CapabilityTextModelContext): string {
  const t = (ctx.textModelRegistryId || '').trim();
  return t || DEFAULT_MODEL_TEXT;
}

/** 预设绑定文字模型优先，否则回退执行上下文（全局默认） */
export function resolveTextModelForPreset(
  preset: CustomAppModule,
  ctx: CapabilityTextModelContext
): string {
  const presetModel = (preset.textModelRegistryId || '').trim();
  if (presetModel) return coerceTextModelRegistryId(presetModel);
  return resolveTextModelFromContext(ctx);
}
