import type { WorkflowAsset, WorkflowPendingTask } from '../types';

/** data: / blob: 或明显内联大串，不写入轻量结构快照 */
function isStrippableInlineMedia(s: string): boolean {
  const t = String(s || '').trim();
  if (!t) return false;
  if (/^data:/i.test(t) || /^blob:/i.test(t)) return true;
  if (t.length > 120_000) return true;
  return false;
}

function stripAssetForLite(a: WorkflowAsset): WorkflowAsset {
  const out = { ...a } as WorkflowAsset;
  if (isStrippableInlineMedia(String(out.original || ''))) {
    out.original = '';
  }
  const res = { ...(out.results || {}) };
  const rok = { ...(out.resultsObjectKeys || {}) };
  for (const stepId of Object.keys(res)) {
    const v = res[stepId];
    if (typeof v === 'string' && isStrippableInlineMedia(v)) {
      delete res[stepId];
    }
  }
  out.results = res;
  if (Object.keys(rok).length) out.resultsObjectKeys = rok;
  else delete out.resultsObjectKeys;

  if (Array.isArray(out.modelUrls)) {
    out.modelUrls = out.modelUrls.map((u) => (typeof u === 'string' && isStrippableInlineMedia(u) ? '' : u));
  }
  if (out.stepModelUrls) {
    const next: Record<string, string[]> = {};
    for (const [k, arr] of Object.entries(out.stepModelUrls)) {
      next[k] = (arr || []).map((u) => (typeof u === 'string' && isStrippableInlineMedia(u) ? '' : u));
    }
    out.stepModelUrls = next;
  }

  return out;
}

function stripPendingForLite(t: WorkflowPendingTask): WorkflowPendingTask {
  const out = { ...t } as WorkflowPendingTask;
  if (isStrippableInlineMedia(String(out.inputImage || ''))) {
    out.inputImage = '';
  }
  if (Array.isArray(out.inputImages)) {
    out.inputImages = out.inputImages.map((im) =>
      typeof im === 'string' && isStrippableInlineMedia(im) ? '' : im
    );
  }
  return out;
}

/**
 * 去掉内联大图 / blob，仅保留键与元数据，用于轻量上云（不写新 R2 字节对象）。
 */
export function stripInlineMediaFromWorkflowBundleForLiteSync(bundle: {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
}): {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
} {
  return {
    assets: (bundle.assets || []).map((a) => stripAssetForLite({ ...a })),
    pending: (bundle.pending || []).map((t) => stripPendingForLite({ ...t })),
    ...(Array.isArray(bundle.capabilityRefs) && bundle.capabilityRefs.length
      ? { capabilityRefs: bundle.capabilityRefs }
      : {}),
  };
}

/**
 * 与轻量剥离后 JSON 一致则视为「本地结构相对上次上云无变化」，用于跳过无意义的周期 PUT。
 */
export function computeLiteStructureLocalFingerprint(bundle: {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
}): string {
  return JSON.stringify(stripInlineMediaFromWorkflowBundleForLiteSync(bundle));
}

/**
 * 将云端已有 object key 合入轻量包，避免轻量 PUT 覆盖后丢失对已上传 R2 对象的引用（不做 reconcile 删键）。
 */
export function mergeLiteStructurePreservingCloudObjectKeys(
  prev: { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] },
  stripped: { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] }
): { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] } {
  const prevByAsset = new Map(prev.assets.map((a) => [String(a.id || '').trim(), a] as const));
  const assets = stripped.assets.map((a) => {
    const id = String(a.id || '').trim();
    const p = id ? prevByAsset.get(id) : undefined;
    if (!p) return a;
    const next = { ...a };
    if (!String(next.originalObjectKey || '').trim() && String(p.originalObjectKey || '').trim()) {
      next.originalObjectKey = p.originalObjectKey.trim();
    }
    const rok = { ...(next.resultsObjectKeys || {}) };
    if (p.resultsObjectKeys) {
      for (const [k, v] of Object.entries(p.resultsObjectKeys)) {
        if (!String(rok[k] || '').trim() && typeof v === 'string' && v.trim()) {
          rok[k] = v.trim();
        }
      }
    }
    if (Object.keys(rok).length) next.resultsObjectKeys = rok;
    else delete next.resultsObjectKeys;
    const rck = { ...(next.resultsCompanionKeys || {}) };
    if (p.resultsCompanionKeys) {
      for (const [k, v] of Object.entries(p.resultsCompanionKeys)) {
        if (!String(rck[k] || '').trim() && typeof v === 'string' && v.trim()) {
          rck[k] = v.trim();
        }
      }
    }
    if (Object.keys(rck).length) next.resultsCompanionKeys = rck;
    else delete next.resultsCompanionKeys;
    const smck = { ...(next.stepModelCompanionKeys || {}) };
    if (p.stepModelCompanionKeys) {
      for (const [k, v] of Object.entries(p.stepModelCompanionKeys)) {
        if (!Array.isArray(smck[k]) || !smck[k]!.some((x) => String(x || '').trim())) {
          if (Array.isArray(v) && v.some((x) => String(x || '').trim())) {
            smck[k] = [...v];
          }
        }
      }
    }
    if (Object.keys(smck).length) next.stepModelCompanionKeys = smck;
    else delete next.stepModelCompanionKeys;
    return next;
  });

  const prevByPendingId = new Map(prev.pending.map((t) => [String(t.id || '').trim(), t] as const));
  const pending = stripped.pending.map((t) => {
    const id = String(t.id || '').trim();
    const p = id ? prevByPendingId.get(id) : undefined;
    if (!p) return t;
    const next = { ...t };
    if (!String(next.inputImageObjectKey || '').trim() && String(p.inputImageObjectKey || '').trim()) {
      next.inputImageObjectKey = p.inputImageObjectKey.trim();
    }
    if (!next.inputImagesObjectKeys?.length && p.inputImagesObjectKeys?.length) {
      next.inputImagesObjectKeys = [...p.inputImagesObjectKeys];
    }
    return next;
  });

  return { assets, pending };
}
