import type { WorkflowAsset } from '../../types';
import {
  VGP_SCHEMA_VERSION,
  type ImageVersion,
  type PromptArtifact,
  type SemanticState,
  type VgpAssetExtension,
} from '../../types/vgp';
import { createInitialVgpForAsset, newVgpId } from './vgpStore';

/** `versionOrder` 与 `versionsById` 不同步时（本地/同步损坏）会得到 0，大图左侧节点图会整段不渲染 */
function countValidVgpOrderedVersions(vgp: VgpAssetExtension): number {
  return vgp.versionOrder.filter((id) => Boolean(vgp.versionsById[id])).length;
}

/**
 * `resultOrder` 中每一步是否都能在 VGP 版本链上找到对应 `imageRef`（含 original）。
 * 若仅有「合法但过时」的 vgp（例如仅含原图节点），右侧「步骤时间线」仍可按 resultOrder 显示，
 * 左侧缩略图树会整段缺失；此时应丢弃并重建 vgp。
 */
function vgpStepKeysCoverResultOrder(asset: WorkflowAsset, vgp: VgpAssetExtension): boolean {
  const order = asset.resultOrder ?? [];
  if (order.length === 0) return true;
  const keys = new Set<string>();
  for (const id of vgp.versionOrder) {
    const v = vgp.versionsById[id];
    if (!v) continue;
    if (v.imageRef.kind === 'original_field') {
      keys.add('original');
      continue;
    }
    if (v.imageRef.kind === 'result_key') {
      keys.add(v.imageRef.key);
    }
  }
  for (const k of order) {
    if (!keys.has(k)) return false;
  }
  return true;
}

function expectedParentDisplayKeyForResult(asset: WorkflowAsset, resultKey: string): string | null {
  const snap = String(asset.resultMeta?.[resultKey]?.inputSourceDisplayKeySnapshot || '').trim();
  if (snap) return snap;
  const mediaKind = asset.resultMeta?.[resultKey]?.mediaKind;
  const hasModel =
    mediaKind === 'model3d' ||
    (asset.stepModelUrls?.[resultKey] || []).some((u) => String(u || '').trim() !== '') ||
    (asset.stepModelCompanionKeys?.[resultKey] || []).some((k) => String(k || '').trim() !== '');
  if (hasModel) return 'original';
  return null;
}

function findVersionIdForStepKey(vgp: VgpAssetExtension, stepKey: string): string | null {
  if (stepKey === 'original') {
    return vgp.originalVersionId ?? vgp.versionOrder[0] ?? null;
  }
  for (const id of vgp.versionOrder) {
    const v = vgp.versionsById[id];
    if (!v) continue;
    if (v.stepKey === stepKey) return id;
    if (v.imageRef.kind === 'result_key' && v.imageRef.key === stepKey) return id;
  }
  return null;
}

/** 已有节点齐全但父边与输入快照/3D 默认原图不一致时，也应重建（修复同卡多模型被串成链）。 */
function vgpParentsMatchExpected(asset: WorkflowAsset, vgp: VgpAssetExtension): boolean {
  for (const key of asset.resultOrder ?? []) {
    const expectedKey = expectedParentDisplayKeyForResult(asset, key);
    if (!expectedKey) continue;
    const vid = findVersionIdForStepKey(vgp, key);
    if (!vid) return false;
    const parentId = vgp.versionsById[vid]?.parentVersionId ?? null;
    const expectedParentId = findVersionIdForStepKey(vgp, expectedKey);
    if (!expectedParentId) continue;
    if (parentId !== expectedParentId) return false;
  }
  return true;
}

/** 迁移重建父节点：优先 meta 快照；3D 无快照时挂原图（避免同卡多模型被串成链）。 */
function resolveMigratedParentVersionId(
  asset: WorkflowAsset,
  vgp: VgpAssetExtension,
  resultKey: string,
  fallbackHeadId: string,
  origId: string
): string {
  const snap = String(asset.resultMeta?.[resultKey]?.inputSourceDisplayKeySnapshot || '').trim();
  if (snap) {
    return findVersionIdForStepKey(vgp, snap) || (snap === 'original' ? origId : fallbackHeadId);
  }
  const mediaKind = asset.resultMeta?.[resultKey]?.mediaKind;
  const hasModel =
    mediaKind === 'model3d' ||
    (asset.stepModelUrls?.[resultKey] || []).some((u) => String(u || '').trim() !== '') ||
    (asset.stepModelCompanionKeys?.[resultKey] || []).some((k) => String(k || '').trim() !== '');
  if (hasModel) return origId;
  return fallbackHeadId;
}

/**
 * 无 vgp 的旧资产：补全最小合法扩展；已有 resultOrder 时尽力重建链（语义/prompt 为占位）。
 * 若已存在 `vgp` 但 `versionOrder` 无法解析出任何版本节点，视为损坏并丢弃后按上式重建。
 * 若 vgp 与 `resultOrder` 不同步（常见于云同步只更新了 result 而未带 vgp），亦重建以对齐左侧节点图与右侧时间线。
 */
export function ensureWorkflowAssetVgp(asset: WorkflowAsset): WorkflowAsset {
  if (asset.vgp && countValidVgpOrderedVersions(asset.vgp) > 0) {
    if (vgpStepKeysCoverResultOrder(asset, asset.vgp) && vgpParentsMatchExpected(asset, asset.vgp)) {
      return asset;
    }
  }

  const source: WorkflowAsset = asset.vgp ? { ...asset, vgp: undefined } : asset;

  const base = createInitialVgpForAsset(source);
  const origId = base.originalVersionId!;
  let headId = base.headVersionId!;
  let stepIndex = 1;

  const order = source.resultOrder ?? [];
  if (order.length === 0) {
    return { ...source, vgp: base };
  }

  const vgp = {
    ...base,
    versionsById: { ...base.versionsById },
    versionOrder: [...base.versionOrder],
    semanticsById: { ...base.semanticsById },
    promptsById: { ...base.promptsById },
  };

  for (const key of order) {
    const semId = newVgpId();
    const semantic: SemanticState = {
      id: semId,
      schema_version: VGP_SCHEMA_VERSION,
      createdAt: Date.now(),
      target: { summary: 'legacy-migrated' },
      dimensions: {},
      locks: {},
      constraints: {},
      provenance: { kind: 'user', note: 'migrated-from-resultOrder' },
    };
    vgp.semanticsById[semId] = semantic;

    const artId = newVgpId();
    const artifact: PromptArtifact = {
      id: artId,
      schema_version: VGP_SCHEMA_VERSION,
      createdAt: Date.now(),
      compiled_prompt: '[历史记录] 此步骤在启用「生成记录」前已生成，无保留原文。',
      applied_rules: [{ ruleId: 'vgp.legacy-migrated', detail: key }],
      compiler_version: 'legacy-migrated-0',
    };
    vgp.promptsById[artId] = artifact;

    const verId = newVgpId();
    const lineageRoot = vgp.versionsById[origId]?.lineageRootId ?? origId;
    const parentVersionId = resolveMigratedParentVersionId(source, vgp, key, headId, origId);
    const iv: ImageVersion = {
      id: verId,
      assetId: source.id,
      parentVersionId,
      lineageRootId: lineageRoot,
      stepIndex,
      stepKey: key,
      role: key === 'cut_image' ? 'cut' : 'generated',
      imageRef: { kind: 'result_key', key },
      semanticStateId: semId,
      promptArtifactId: artId,
      createdAt: Date.now(),
    };
    vgp.versionsById[verId] = iv;
    vgp.versionOrder.push(verId);
    headId = verId;
    stepIndex += 1;
  }

  vgp.headVersionId = headId;
  return { ...source, vgp };
}
