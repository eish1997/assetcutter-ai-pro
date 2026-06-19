/** 模型 / 能力 → billingSku 映射（Phase 0 启发式） */

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

export function resolveBillingSkuForTripoTask(taskType?: string): string {
  const t = String(taskType || '').trim();
  if (t) return '3d.tripo.task';
  return '3d.tripo.task';
}

export function resolveBillingSkuForWorkflowVideo(): string {
  return 'video.workflow.task';
}

export function resolveProviderForGeminiPath(useVertex?: boolean): string {
  return useVertex ? 'vertex' : 'gemini';
}
