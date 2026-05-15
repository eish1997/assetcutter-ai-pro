import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import type { WorkflowProjectBundle } from './workspaceProjectStore';
import { sanitizeWorkflowProjectBundle } from './workflowBundleSanitize';

/** 同一步骤键（能力 id / 步骤 id）上双方均有非空内容时的处理 */
export type WorkflowBundleMergeSameKeyPolicy =
  | { kind: 'prefer-base' }
  | { kind: 'prefer-other' }
  | { kind: 'timestamp-wins' }
  /**
   * 保留双方：在 `results` / `textResults` / `resultMeta` 等下使用新 stepId（后缀避免碰撞），并写入 `resultOrder`。
   * 新 id 可能与能力注册表 id 不一致，仅适合「存档合并」类场景。
   */
  | { kind: 'keep-both'; duplicateStepSuffix?: string }
  /** 不自动选边：合并结果保留 base 侧内容，并把冲突记入 `conflicts` 供 UI 弹窗后再调一次 merge。 */
  | { kind: 'defer-dialog' };

export type WorkflowBundleMergeConflict = {
  kind: 'result-step' | 'pending-task-id' | 'pending-asset-action';
  assetId: string;
  /** `results` / `textResults` 的键 */
  stepId?: string;
  pendingTaskId?: string;
  /** `pending-asset-action`：能力 / 队列 actionType */
  actionType?: string;
  baseExecutedAt?: number;
  otherExecutedAt?: number;
};

export type MergeWorkflowProjectBundlesResult = {
  merged: WorkflowProjectBundle;
  conflicts: WorkflowBundleMergeConflict[];
};

export type MergeWorkflowProjectBundlesOptions = {
  sameKey: WorkflowBundleMergeSameKeyPolicy;
  /**
   * `task-id`：仅按任务 `id` 对齐（默认）。
   * `asset-action`：同一 `assetId` + `actionType` 视为跨端「同一队列槽」，适合与云端工作流对账。
   */
  pendingKeyedBy?: 'task-id' | 'asset-action';
};

function normalizeMergeOptions(
  options: MergeWorkflowProjectBundlesOptions | WorkflowBundleMergeSameKeyPolicy
): MergeWorkflowProjectBundlesOptions {
  if (options && typeof options === 'object' && 'sameKey' in options) {
    return {
      sameKey: options.sameKey,
      pendingKeyedBy: options.pendingKeyedBy ?? 'task-id',
    };
  }
  return { sameKey: options as WorkflowBundleMergeSameKeyPolicy, pendingKeyedBy: 'task-id' };
}

function cloneDeep<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function executedAtForStep(asset: WorkflowAsset, stepId: string): number {
  const raw = asset.resultMeta?.[stepId]?.executedAt;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return Math.max(0, n);
}

function hasNonEmptyResult(asset: WorkflowAsset, stepId: string): boolean {
  const img = asset.results?.[stepId];
  const tx = asset.textResults?.[stepId];
  return (typeof img === 'string' && img.trim().length > 0) || (typeof tx === 'string' && tx.trim().length > 0);
}

/** 含 3D 模型、伴侣键或 Tripo 元数据等「无平面图」步骤 */
function stepHasPersistedContent(asset: WorkflowAsset, stepId: string): boolean {
  if (hasNonEmptyResult(asset, stepId)) return true;
  const modelUrls = asset.stepModelUrls?.[stepId];
  if (Array.isArray(modelUrls) && modelUrls.some((u) => typeof u === 'string' && u.trim().length > 0)) return true;
  const modelKeys = asset.stepModelCompanionKeys?.[stepId];
  if (Array.isArray(modelKeys) && modelKeys.some((k) => typeof k === 'string' && k.trim().length > 0)) return true;
  const meta = asset.resultMeta?.[stepId];
  if (meta?.tripoTaskId?.trim()) return true;
  if (meta?.mediaKind === 'model3d') return true;
  return false;
}

function collectStepIdsForAsset(a: WorkflowAsset): Set<string> {
  const s = new Set<string>();
  for (const k of Object.keys(a.results || {})) {
    if (k) s.add(k);
  }
  for (const k of Object.keys(a.textResults || {})) {
    if (k) s.add(k);
  }
  for (const k of Object.keys(a.resultMeta || {})) {
    if (k) s.add(k);
  }
  for (const k of Object.keys(a.stepModelFormats || {})) {
    if (k) s.add(k);
  }
  return s;
}

function mergeResultOrder(baseOrder: string[] | undefined, otherOrder: string[] | undefined, mergedKeys: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(baseOrder || []), ...(otherOrder || [])]) {
    if (!id || !mergedKeys.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const k of mergedKeys) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

function makeDupStepId(stepId: string, taken: Set<string>, suffix: string): string {
  const safeSuffix = suffix && suffix.trim() ? suffix.trim() : '__dup';
  let i = 0;
  for (;;) {
    const candidate = i === 0 ? `${stepId}${safeSuffix}` : `${stepId}${safeSuffix}_${i}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    i += 1;
  }
}

function mergeTwoAssets(
  baseA: WorkflowAsset,
  otherA: WorkflowAsset,
  sameKey: WorkflowBundleMergeSameKeyPolicy,
  conflicts: WorkflowBundleMergeConflict[]
): WorkflowAsset {
  const out = cloneDeep(baseA);
  const stepIds = new Set([...collectStepIdsForAsset(baseA), ...collectStepIdsForAsset(otherA)]);

  out.results = { ...(out.results || {}) };
  out.textResults = out.textResults ? { ...out.textResults } : {};
  out.resultMeta = out.resultMeta ? { ...out.resultMeta } : {};
  out.resultsObjectKeys = out.resultsObjectKeys ? { ...out.resultsObjectKeys } : undefined;
  out.resultsCompanionKeys = out.resultsCompanionKeys ? { ...out.resultsCompanionKeys } : undefined;
  out.stepModelUrls = out.stepModelUrls ? { ...out.stepModelUrls } : undefined;
  out.stepModelCompanionKeys = out.stepModelCompanionKeys ? { ...out.stepModelCompanionKeys } : undefined;
  out.stepModelFormats = out.stepModelFormats ? { ...out.stepModelFormats } : undefined;

  const takenResultKeys = new Set(Object.keys(out.results).concat(Object.keys(out.textResults || {})));

  const applyOtherStepToOut = (step: string) => {
    if (typeof otherA.results?.[step] === 'string' && otherA.results[step].trim()) {
      out.results[step] = otherA.results[step];
    } else {
      delete out.results[step];
    }
    if (typeof otherA.textResults?.[step] === 'string' && otherA.textResults![step].trim()) {
      out.textResults = { ...out.textResults, [step]: otherA.textResults![step] };
    } else if (out.textResults && step in out.textResults) {
      const { [step]: _tx, ...trest } = out.textResults;
      out.textResults = trest;
    }
    if (otherA.resultMeta?.[step]) {
      out.resultMeta = { ...out.resultMeta, [step]: cloneDeep(otherA.resultMeta[step]) };
    } else if (out.resultMeta && step in out.resultMeta) {
      const { [step]: _m, ...mrest } = out.resultMeta;
      out.resultMeta = Object.keys(mrest).length ? mrest : {};
    }
    if (otherA.resultsObjectKeys?.[step]) {
      out.resultsObjectKeys = { ...(out.resultsObjectKeys || {}), [step]: otherA.resultsObjectKeys[step] };
    } else if (out.resultsObjectKeys && step in out.resultsObjectKeys) {
      const { [step]: _r, ...rrest } = out.resultsObjectKeys;
      out.resultsObjectKeys = Object.keys(rrest).length ? rrest : undefined;
    }
    if (otherA.resultsCompanionKeys?.[step]) {
      out.resultsCompanionKeys = { ...(out.resultsCompanionKeys || {}), [step]: otherA.resultsCompanionKeys[step] };
    } else if (out.resultsCompanionKeys && step in out.resultsCompanionKeys) {
      const { [step]: _c, ...crest } = out.resultsCompanionKeys;
      out.resultsCompanionKeys = Object.keys(crest).length ? crest : undefined;
    }
    if (otherA.stepModelUrls?.[step]?.length) {
      out.stepModelUrls = { ...(out.stepModelUrls || {}), [step]: [...otherA.stepModelUrls[step]!] };
    } else if (out.stepModelUrls && step in out.stepModelUrls) {
      const { [step]: _su, ...srest } = out.stepModelUrls;
      out.stepModelUrls = Object.keys(srest).length ? srest : undefined;
    }
    if (otherA.stepModelCompanionKeys?.[step]?.length) {
      out.stepModelCompanionKeys = {
        ...(out.stepModelCompanionKeys || {}),
        [step]: [...otherA.stepModelCompanionKeys[step]!],
      };
    } else if (out.stepModelCompanionKeys && step in out.stepModelCompanionKeys) {
      const { [step]: _sm, ...smrest } = out.stepModelCompanionKeys;
      out.stepModelCompanionKeys = Object.keys(smrest).length ? smrest : undefined;
    }
    if (otherA.stepModelFormats?.[step]?.length) {
      out.stepModelFormats = { ...(out.stepModelFormats || {}), [step]: [...otherA.stepModelFormats[step]!] };
    } else if (out.stepModelFormats && step in out.stepModelFormats) {
      const { [step]: _sf, ...sfrest } = out.stepModelFormats;
      out.stepModelFormats = Object.keys(sfrest).length ? sfrest : undefined;
    }
  };

  for (const stepId of stepIds) {
    const oHas = stepHasPersistedContent(otherA, stepId);
    const bHas = stepHasPersistedContent(out, stepId);

    if (oHas && !bHas) {
      applyOtherStepToOut(stepId);
      continue;
    }

    if (!oHas) continue;

    const ar = out.results?.[stepId] ?? '';
    const br = otherA.results?.[stepId] ?? '';
    const at = out.textResults?.[stepId] ?? '';
    const bt = otherA.textResults?.[stepId] ?? '';
    if (ar === br && at === bt) continue;

    if (!bHas) continue;

    const tBase = executedAtForStep(out, stepId);
    const tOther = executedAtForStep(otherA, stepId);

    if (sameKey.kind === 'prefer-base') {
      continue;
    }
    if (sameKey.kind === 'prefer-other') {
      applyOtherStepToOut(stepId);
      continue;
    }

    if (sameKey.kind === 'timestamp-wins') {
      if (tOther > tBase) {
        applyOtherStepToOut(stepId);
      }
      continue;
    }

    if (sameKey.kind === 'keep-both') {
      const newId = makeDupStepId(stepId, takenResultKeys, sameKey.duplicateStepSuffix || '__dup');
      if (typeof otherA.results?.[stepId] === 'string' && otherA.results[stepId].trim()) {
        out.results[newId] = otherA.results[stepId];
      }
      if (typeof otherA.textResults?.[stepId] === 'string' && otherA.textResults![stepId].trim()) {
        out.textResults = { ...out.textResults, [newId]: otherA.textResults![stepId] };
      }
      if (otherA.resultMeta?.[stepId]) {
        const meta = cloneDeep(otherA.resultMeta[stepId]);
        if (!meta.displayStepLabel) {
          meta.displayStepLabel = `${stepId}（合并副本）`;
        }
        out.resultMeta = { ...out.resultMeta, [newId]: meta };
      }
      if (otherA.resultsObjectKeys?.[stepId]) {
        out.resultsObjectKeys = { ...(out.resultsObjectKeys || {}), [newId]: otherA.resultsObjectKeys[stepId] };
      }
      if (otherA.resultsCompanionKeys?.[stepId]) {
        out.resultsCompanionKeys = { ...(out.resultsCompanionKeys || {}), [newId]: otherA.resultsCompanionKeys[stepId] };
      }
      continue;
    }

    conflicts.push({
      kind: 'result-step',
      assetId: String(baseA.id || ''),
      stepId,
      baseExecutedAt: tBase,
      otherExecutedAt: tOther,
    });
  }

  const mergedKeys = collectStepIdsForAsset(out);
  out.resultOrder = mergeResultOrder(out.resultOrder, otherA.resultOrder, mergedKeys);

  return out;
}

function mergeCapabilityRefs(base: WorkflowProjectBundle, other: WorkflowProjectBundle) {
  const map = new Map<string, { kind: 'preset' | 'set'; id: string; snapshot?: unknown }>();
  for (const r of [...(base.capabilityRefs || []), ...(other.capabilityRefs || [])]) {
    if (!r || (r.kind !== 'preset' && r.kind !== 'set')) continue;
    const id = String(r.id || '').trim();
    if (!id) continue;
    const k = `${r.kind}:${id}`;
    if (!map.has(k)) map.set(k, { kind: r.kind, id, ...(r.snapshot != null ? { snapshot: r.snapshot } : {}) });
  }
  return Array.from(map.values());
}

function pendingKeyAssetAction(t: WorkflowPendingTask): string {
  return `${String(t.assetId || '').trim()}::${String(t.actionType || '').trim()}`;
}

function pendingPayloadStable(t: WorkflowPendingTask): Omit<WorkflowPendingTask, 'id'> {
  const { id: _i, ...rest } = t;
  return rest;
}

function pendingTasksEquivalent(a: WorkflowPendingTask, b: WorkflowPendingTask): boolean {
  return JSON.stringify(pendingPayloadStable(a)) === JSON.stringify(pendingPayloadStable(b));
}

function newPendingMergeId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `merge-p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolvePendingRowConflict(
  merged: WorkflowPendingTask[],
  rowIndex: number,
  t: WorkflowPendingTask,
  tid: string,
  sameKey: WorkflowBundleMergeSameKeyPolicy,
  conflicts: WorkflowBundleMergeConflict[],
  conflictKind: 'pending-task-id' | 'pending-asset-action'
): void {
  const baseT = merged[rowIndex]!;
  if (pendingTasksEquivalent(baseT, t)) return;
  if (sameKey.kind === 'prefer-base') return;
  if (sameKey.kind === 'prefer-other') {
    merged[rowIndex] = cloneDeep(t);
    return;
  }
  if (sameKey.kind === 'timestamp-wins') {
    const ab = Number(baseT.addedAt) || 0;
    const ao = Number(t.addedAt) || 0;
    if (ao > ab) merged[rowIndex] = cloneDeep(t);
    return;
  }
  if (sameKey.kind === 'keep-both') {
    const dup = cloneDeep(t);
    dup.id = newPendingMergeId();
    merged.push(dup);
    return;
  }
  conflicts.push({
    kind: conflictKind,
    assetId: String(t.assetId || ''),
    pendingTaskId: tid || undefined,
    actionType: conflictKind === 'pending-asset-action' ? String(t.actionType || '') : undefined,
    baseExecutedAt: Number(baseT.addedAt) || 0,
    otherExecutedAt: Number(t.addedAt) || 0,
  });
}

function mergePendingLists(
  basePending: WorkflowPendingTask[],
  otherPending: WorkflowPendingTask[],
  sameKey: WorkflowBundleMergeSameKeyPolicy,
  pendingKeyedBy: 'task-id' | 'asset-action',
  conflicts: WorkflowBundleMergeConflict[]
): WorkflowPendingTask[] {
  const merged: WorkflowPendingTask[] = cloneDeep(basePending);

  if (pendingKeyedBy === 'task-id') {
    const seen = new Set(merged.map((x) => String(x.id || '').trim()).filter(Boolean));
    for (const t of otherPending) {
      const tid = String(t.id || '').trim();
      if (!tid) continue;
      if (!seen.has(tid)) {
        merged.push(cloneDeep(t));
        seen.add(tid);
        continue;
      }
      const idx = merged.findIndex((x) => String(x.id || '').trim() === tid);
      if (idx < 0) continue;
      resolvePendingRowConflict(merged, idx, t, tid, sameKey, conflicts, 'pending-task-id');
    }
    return merged;
  }

  for (const t of otherPending) {
    const tid = String(t.id || '').trim();
    const idIdx = tid ? merged.findIndex((x) => String(x.id || '').trim() === tid) : -1;
    if (idIdx >= 0) {
      resolvePendingRowConflict(merged, idIdx, t, tid, sameKey, conflicts, 'pending-task-id');
      continue;
    }

    if (!String(t.assetId || '').trim() || !String(t.actionType || '').trim()) {
      if (tid) merged.push(cloneDeep(t));
      continue;
    }
    const ka = pendingKeyAssetAction(t);
    const aaIdx = merged.findIndex((x) => pendingKeyAssetAction(x) === ka);
    if (aaIdx < 0) {
      merged.push(cloneDeep(t));
      continue;
    }
    const baseRowId = String(merged[aaIdx]?.id || '').trim();
    resolvePendingRowConflict(merged, aaIdx, t, tid || baseRowId, sameKey, conflicts, 'pending-asset-action');
  }

  return merged;
}

/**
 * 将 `other` 合并进 `base`：按资产 id 对齐；`results` / `textResults` 按 stepId 合并——
 * 对方有非空而 base 该键无则填入；双方同键且内容不同则按 `sameKey` 策略处理。
 * `pending` 见 `MergeWorkflowProjectBundlesOptions.pendingKeyedBy`。
 */
export function mergeWorkflowProjectBundles(
  base: WorkflowProjectBundle,
  other: WorkflowProjectBundle,
  options: MergeWorkflowProjectBundlesOptions | WorkflowBundleMergeSameKeyPolicy
): MergeWorkflowProjectBundlesResult {
  const opt = normalizeMergeOptions(options);
  const conflicts: WorkflowBundleMergeConflict[] = [];
  const baseById = new Map(base.assets.map((a) => [String(a.id || '').trim(), a] as const));
  const otherById = new Map(other.assets.map((a) => [String(a.id || '').trim(), a] as const));

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const a of base.assets) {
    const id = String(a.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }
  for (const a of other.assets) {
    const id = String(a.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  const mergedAssets: WorkflowAsset[] = [];
  for (const id of orderedIds) {
    const b = baseById.get(id);
    const o = otherById.get(id);
    if (b && o) {
      mergedAssets.push(mergeTwoAssets(b, o, opt.sameKey, conflicts));
    } else if (b) {
      mergedAssets.push(cloneDeep(b));
    } else if (o) {
      mergedAssets.push(cloneDeep(o));
    }
  }

  const mergedPending = mergePendingLists(base.pending, other.pending, opt.sameKey, opt.pendingKeyedBy ?? 'task-id', conflicts);

  const merged: WorkflowProjectBundle = {
    assets: mergedAssets,
    pending: mergedPending,
    capabilityRefs: mergeCapabilityRefs(base, other),
    workflowBundleSchemaVersion: base.workflowBundleSchemaVersion ?? other.workflowBundleSchemaVersion,
  };

  const hygiene = sanitizeWorkflowProjectBundle(merged.assets, merged.pending);
  merged.assets = hygiene.assets;
  merged.pending = hygiene.pending;

  return { merged, conflicts };
}
