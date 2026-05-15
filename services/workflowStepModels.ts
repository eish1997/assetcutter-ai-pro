import type { WorkflowAsset } from '../types';

const RESULT_VER_SEP = '__v__';

function baseActionId(k: string): string {
  return k.includes(RESULT_VER_SEP) ? k.split(RESULT_VER_SEP)[0]! : k;
}

export function stripResultKeyToBaseActionId(k: string): string {
  const fromSep = baseActionId(k);
  if (fromSep !== k) return fromSep;
  const m = /^(.+)_v_[a-z0-9]+$/i.exec(k);
  return m?.[1] ?? k;
}

/** 遗留资产级 modelUrls 归属的步骤键（优先含 Tripo / 混元任务 id 的步） */
export function inferLegacyWorkflowStepModelOwnerKey(asset: WorkflowAsset): string | null {
  const meta = asset.resultMeta || {};
  const has3dJob = (k: string) =>
    Boolean(String(meta[k]?.tripoTaskId || '').trim() || String(meta[k]?.tencentJobId || '').trim());
  for (const k of [...(asset.resultOrder || [])].reverse()) {
    if (has3dJob(k)) return k;
  }
  for (const k of Object.keys(meta)) {
    if (has3dJob(k)) return k;
  }
  if ((asset.modelUrls?.length ?? 0) === 0) return null;
  const dk = String(asset.displayKey || '').trim();
  if (dk && dk !== 'original' && dk !== 'group_preview') return dk;
  const last = (asset.resultOrder || []).slice(-1)[0];
  return last ? String(last) : null;
}

export function isWorkflowGenerate3dResultStep(asset: WorkflowAsset, resultKey: string): boolean {
  if (String(asset.resultMeta?.[resultKey]?.tripoTaskId || '').trim()) return true;
  if (String(asset.resultMeta?.[resultKey]?.tencentJobId || '').trim()) return true;
  const base = stripResultKeyToBaseActionId(resultKey);
  if (base === 'generate_3d') return true;
  const snap = asset.resultMeta?.[resultKey]?.presetActionIdSnapshot;
  if (snap && stripResultKeyToBaseActionId(snap) === 'generate_3d') return true;
  return Boolean(asset.stepModelUrls?.[resultKey]?.length);
}

export function resolveWorkflowStepModelUrls(asset: WorkflowAsset, resultKey: string): string[] {
  const fromStep = asset.stepModelUrls?.[resultKey];
  if (fromStep?.length) {
    return fromStep.map((u) => String(u || '').trim()).filter(Boolean);
  }
  const owner = inferLegacyWorkflowStepModelOwnerKey(asset);
  if (owner === resultKey && (asset.modelUrls?.length ?? 0) > 0) {
    return (asset.modelUrls || []).map((u) => String(u || '').trim()).filter(Boolean);
  }
  return [];
}

export function resolveWorkflowStepModelCompanionKeys(asset: WorkflowAsset, resultKey: string): string[] {
  const fromStep = asset.stepModelCompanionKeys?.[resultKey];
  if (fromStep?.length) return fromStep.map((k) => String(k || '').trim());
  const owner = inferLegacyWorkflowStepModelOwnerKey(asset);
  if (owner === resultKey && (asset.modelCompanionKeys?.length ?? 0) > 0) {
    return (asset.modelCompanionKeys || []).map((k) => String(k || '').trim());
  }
  return [];
}

export function resolveWorkflowStepModelFormats(
  asset: WorkflowAsset,
  resultKey: string
): Array<'glb' | 'fbx'> {
  const fromStep = asset.stepModelFormats?.[resultKey];
  if (fromStep?.length) return fromStep;
  const urls = resolveWorkflowStepModelUrls(asset, resultKey);
  return urls.map((u, i) => {
    const s = String(u || '').toLowerCase();
    const key = resolveWorkflowStepModelCompanionKeys(asset, resultKey)[i]?.toLowerCase() || '';
    if (s.includes('.fbx') || key.includes('.fbx') || key.includes('_fbx')) return 'fbx';
    return 'glb';
  });
}

export function assetHasAnyWorkflowStepModels(asset: WorkflowAsset): boolean {
  if (Object.values(asset.stepModelUrls || {}).some((arr) => (arr?.length ?? 0) > 0)) return true;
  return (asset.modelUrls?.length ?? 0) > 0;
}

export type WorkflowModelPersistStatus = 'persisted' | 'memory_only' | 'failed' | 'remote_only' | 'none';

export type WorkflowStepModelPersistDetail = {
  status: WorkflowModelPersistStatus;
  glbOnCompanion: boolean;
  fbxOnCompanion: boolean;
  hasPreviewUrl: boolean;
  tripoTaskId?: string;
  tencentJobId?: string;
};

function slotHasCompanionKey(keys: string[], formats: Array<'glb' | 'fbx'>, format: 'glb' | 'fbx'): boolean {
  const idx = formats.indexOf(format);
  const i = idx >= 0 ? idx : format === 'glb' ? 0 : 1;
  return Boolean(String(keys[i] ?? '').trim());
}

/** 大图/时间线：工作流步骤 3D 落盘状态 */
export function getWorkflowStepModelPersistStatus(
  asset: WorkflowAsset,
  resultKey: string
): WorkflowStepModelPersistDetail {
  const keys = resolveWorkflowStepModelCompanionKeys(asset, resultKey);
  const urls = resolveWorkflowStepModelUrls(asset, resultKey);
  const formats = resolveWorkflowStepModelFormats(asset, resultKey);
  const meta = asset.resultMeta?.[resultKey];
  const tripoTaskId = String(meta?.tripoTaskId || '').trim() || undefined;
  const tencentJobId = String(meta?.tencentJobId || '').trim() || undefined;
  const glbOnCompanion = slotHasCompanionKey(keys, formats, 'glb');
  const fbxOnCompanion = slotHasCompanionKey(keys, formats, 'fbx');
  const hasCompanion = keys.some((k) => String(k || '').trim());
  const hasPreviewUrl = urls.some((u) => String(u || '').trim());
  const hasJob = Boolean(tripoTaskId || tencentJobId);
  const lastError = String(meta?.tripoLastError || meta?.tencentLastError || '').trim();

  const base = {
    glbOnCompanion,
    fbxOnCompanion,
    hasPreviewUrl,
    tripoTaskId,
    tencentJobId,
  };

  if (hasCompanion) {
    return { status: 'persisted', ...base };
  }
  if (hasPreviewUrl) {
    return { status: 'memory_only', ...base };
  }
  if (hasJob && lastError) {
    return { status: 'failed', ...base };
  }
  if (hasJob) {
    return { status: 'remote_only', ...base };
  }
  return { status: 'none', ...base };
}

export function workflowModelPersistStatusLabel(detail: WorkflowStepModelPersistDetail): string {
  switch (detail.status) {
    case 'persisted': {
      const glb = detail.glbOnCompanion ? 'GLB ✓' : 'GLB —';
      const fbx = detail.fbxOnCompanion ? 'FBX ✓' : 'FBX —';
      return `已落本机伴侣 · ${glb} · ${fbx}`;
    }
    case 'memory_only':
      return '仅浏览器缓存，刷新可能丢失';
    case 'failed':
      return '归档失败 · 可尝试从云端拉取';
    case 'remote_only':
      return detail.tripoTaskId
        ? '仅云端 Tripo 任务 · 可「从 Tripo 拉取」'
        : '仅云端混元任务 · JobId 已记录';
    default:
      return '';
  }
}
