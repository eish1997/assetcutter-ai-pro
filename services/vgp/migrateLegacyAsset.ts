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
 * 无 vgp 的旧资产：补全最小合法扩展；已有 resultOrder 时尽力重建链（语义/prompt 为占位）。
 * 若已存在 `vgp` 但 `versionOrder` 无法解析出任何版本节点，视为损坏并丢弃后按上式重建。
 */
export function ensureWorkflowAssetVgp(asset: WorkflowAsset): WorkflowAsset {
  if (asset.vgp && countValidVgpOrderedVersions(asset.vgp) > 0) {
    return asset;
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

  const vgp = { ...base, versionsById: { ...base.versionsById }, versionOrder: [...base.versionOrder], semanticsById: { ...base.semanticsById }, promptsById: { ...base.promptsById } };

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
    const iv: ImageVersion = {
      id: verId,
      assetId: source.id,
      parentVersionId: headId,
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
