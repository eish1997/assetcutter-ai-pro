import type { MeterModality } from '../../../shared/observability/meterReading';

export function resolveBillingSkuForGeminiModel(
  modelOrRegistryId: string | undefined,
  role: 'text' | 'image' = 'text'
): string {
  const m = String(modelOrRegistryId || '').toLowerCase();
  if (role === 'image' || m.includes('image') || m.includes('flash-image') || m.includes('pro-image')) {
    if (m.includes('pro')) return 'image.gemini.pro';
    return 'image.gemini.flash';
  }
  if (m.includes('pro') && !m.includes('flash')) return 'llm.gemini.pro';
  return 'llm.gemini.flash';
}

export function resolveBillingSkuForOpenAiModel(
  modelOrRegistryId: string | undefined,
  modality: MeterModality = 'text'
): string {
  const m = String(modelOrRegistryId || '').toLowerCase();
  if (modality === 'image' || m.includes('gpt-image') || m.includes('dall-e')) {
    if (m.includes('gpt-image-2') || m.startsWith('gpt-image-2')) return 'image.openai.gpt2';
    return 'image.openai.gpt15';
  }
  if (m.includes('mini')) return 'llm.openai.gpt4o-mini';
  return 'llm.openai.gpt4o';
}

export function resolveBillingSkuForTripoTask(_taskType?: string): string {
  return '3d.tripo.task';
}

export function resolveBillingSkuForTencent3dTask(module?: string): string {
  const m = String(module || '').toLowerCase();
  if (m === 'rapid') return '3d.tencent.rapid';
  return '3d.tencent.pro';
}

export function resolveBillingSkuForWorkflowVideo(): string {
  return 'video.workflow.task';
}

/** 即梦 registryId → billingSku（§4.8 占位命名） */
export function resolveBillingSkuForJimeng(registryId: string | undefined): string {
  const id = String(registryId || '').trim();
  if (id.startsWith('jimeng-image-')) {
    return `image.jimeng.${id.slice('jimeng-image-'.length)}`;
  }
  if (id.startsWith('jimeng-video-')) {
    return `video.jimeng.${id.slice('jimeng-video-'.length)}`;
  }
  if (id.startsWith('jimeng-dh-')) {
    return `digital_human.jimeng.${id.slice('jimeng-dh-'.length)}`;
  }
  return `task.jimeng.${id.replace(/^jimeng-/, '') || 'unknown'}`;
}

export function resolveProviderForGeminiPath(useVertex?: boolean): string {
  return useVertex ? 'vertex' : 'gemini';
}

export function isLikelyOpenAiRegistryId(modelOrRegistryId: string): boolean {
  const m = String(modelOrRegistryId || '').toLowerCase();
  return m.includes('gpt-image') || m.startsWith('gpt-') || m.startsWith('dall-e');
}

export function isLikelyImageRegistryId(modelOrRegistryId: string): boolean {
  const m = String(modelOrRegistryId || '').toLowerCase();
  return (
    m.includes('gpt-image') ||
    m.includes('dall-e') ||
    m.includes('image') ||
    m.includes('flash-image') ||
    m.includes('pro-image')
  );
}

export function resolveBillingSkuFromRegistry(
  registryId: string | undefined,
  modality: MeterModality
): string {
  const id = String(registryId || '').trim().toLowerCase();
  if (modality === '3d') {
    if (id.includes('tencent') || id.includes('hunyuan')) {
      return id.includes('rapid') ? '3d.tencent.rapid' : '3d.tencent.pro';
    }
    return resolveBillingSkuForTripoTask();
  }
  if (modality === 'video') return resolveBillingSkuForWorkflowVideo();
  if (isLikelyOpenAiRegistryId(id)) return resolveBillingSkuForOpenAiModel(id, modality);
  if (modality === 'image') return resolveBillingSkuForGeminiModel(id, 'image');
  return resolveBillingSkuForGeminiModel(id, 'text');
}
