import type { WorkflowAsset } from '../../types';
import {
  VGP_SCHEMA_VERSION,
  type ImageVersion,
  type PromptArtifact,
  type SemanticState,
  type VgpAssetExtension,
  type VgpGenStepCapture,
} from '../../types/vgp';

type AppliedRuleRef = { ruleId: string; detail?: string };

const RESULT_VER_SEP = '__v__';

function baseActionId(k: string): string {
  return k.includes(RESULT_VER_SEP) ? k.split(RESULT_VER_SEP)[0]! : k;
}

/**
 * 根据入队时的展示 key 解析「作为输入的那张图」对应的版本 id（支持从链上任意一步继续生图）。
 */
export function resolveParentVersionIdForInput(
  vgp: VgpAssetExtension,
  inputSourceDisplayKey: string | undefined
): string | null {
  if (!inputSourceDisplayKey) {
    return vgp.headVersionId ?? vgp.versionOrder[vgp.versionOrder.length - 1] ?? null;
  }
  if (inputSourceDisplayKey === 'original') {
    return vgp.originalVersionId ?? vgp.versionOrder[0] ?? null;
  }
  let best: string | null = null;
  for (let i = 0; i < vgp.versionOrder.length; i++) {
    const vid = vgp.versionOrder[i]!;
    const v = vgp.versionsById[vid];
    if (v?.stepKey === inputSourceDisplayKey) best = vid;
  }
  if (best != null) return best;
  const base = baseActionId(inputSourceDisplayKey);
  for (let i = vgp.versionOrder.length - 1; i >= 0; i--) {
    const vid = vgp.versionOrder[i]!;
    const v = vgp.versionsById[vid];
    if (v && baseActionId(v.stepKey) === base) return vid;
  }
  return vgp.headVersionId ?? null;
}

export function newVgpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `vgp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function deepCloneVgp(v: VgpAssetExtension): VgpAssetExtension {
  return JSON.parse(JSON.stringify(v)) as VgpAssetExtension;
}

export function createInitialVgpForAsset(asset: { id: string; createdAt: number }): VgpAssetExtension {
  const now = Date.now();
  const semId = newVgpId();
  const origVerId = newVgpId();

  const semantic: SemanticState = {
    id: semId,
    schema_version: VGP_SCHEMA_VERSION,
    createdAt: now,
    target: { summary: '原始图像' },
    dimensions: {},
    locks: {},
    constraints: {},
    provenance: { kind: 'user', note: 'original-placeholder' },
  };

  const originalVersion: ImageVersion = {
    id: origVerId,
    assetId: asset.id,
    parentVersionId: null,
    lineageRootId: origVerId,
    stepIndex: 0,
    stepKey: 'original',
    role: 'original',
    imageRef: { kind: 'original_field' },
    semanticStateId: semId,
    createdAt: asset.createdAt,
  };

  return {
    schema_version: VGP_SCHEMA_VERSION,
    versionsById: { [origVerId]: originalVersion },
    versionOrder: [origVerId],
    semanticsById: { [semId]: semantic },
    promptsById: {},
    headVersionId: origVerId,
    originalVersionId: origVerId,
  };
}

function cloneSemanticInherited(prev: SemanticState, now: number, summary?: string): SemanticState {
  const id = newVgpId();
  return {
    ...prev,
    id,
    createdAt: now,
    target: summary != null && summary !== '' ? { summary } : { ...prev.target },
    provenance: { kind: 'inherited', parentSemanticId: prev.id },
  };
}

export function buildCombinedPromptArtifact(
  captures: VgpGenStepCapture[],
  now: number,
  extraRules: AppliedRuleRef[]
): PromptArtifact {
  const id = newVgpId();
  const compiled =
    captures.length === 1
      ? captures[0].understoodPrompt
      : captures.map((c) => `【${c.presetLabel}】\n${c.understoodPrompt}`).join('\n\n---\n\n');
  const rules: AppliedRuleRef[] = [...extraRules];
  for (const c of captures) {
    rules.push({ ruleId: 'capability.preset_understand', detail: c.presetId });
  }
  return {
    id,
    schema_version: VGP_SCHEMA_VERSION,
    createdAt: now,
    compiled_prompt: compiled,
    applied_rules: rules,
    compiler_version: 'legacy-understand-1',
    raw_understood_instruction: captures.length === 1 ? captures[0].understoodPrompt : undefined,
  };
}

function buildPlaceholderArtifact(compiled: string, now: number, extraRules: AppliedRuleRef[]): PromptArtifact {
  const id = newVgpId();
  return {
    id,
    schema_version: VGP_SCHEMA_VERSION,
    createdAt: now,
    compiled_prompt: compiled,
    applied_rules: [...extraRules, { ruleId: 'vgp.placeholder' }],
    compiler_version: 'legacy-understand-1',
  };
}

export function applyVgpAfterSuccessfulGen(
  asset: WorkflowAsset,
  params: {
    resultKey: string;
    vgpSteps: VgpGenStepCapture[];
    semanticSummary: string;
    hadPromptOverride: boolean;
    /** 入队时的 displayKey，用于父版本（任意图继续生图） */
    inputSourceDisplayKey?: string;
    now?: number;
  }
): WorkflowAsset {
  const now = params.now ?? Date.now();
  const vgpBase = asset.vgp ? deepCloneVgp(asset.vgp) : createInitialVgpForAsset({ id: asset.id, createdAt: asset.createdAt });
  const parentVersionId = resolveParentVersionIdForInput(vgpBase, params.inputSourceDisplayKey);
  const parentVer = parentVersionId ? vgpBase.versionsById[parentVersionId] : undefined;

  const prevSemantic = parentVer ? vgpBase.semanticsById[parentVer.semanticStateId] : undefined;

  let semantic: SemanticState;
  if (prevSemantic) {
    semantic = cloneSemanticInherited(prevSemantic, now, params.semanticSummary);
  } else {
    semantic = {
      id: newVgpId(),
      schema_version: VGP_SCHEMA_VERSION,
      createdAt: now,
      target: { summary: params.semanticSummary },
      dimensions: {},
      locks: {},
      constraints: {},
      provenance: { kind: 'user' },
    };
  }
  vgpBase.semanticsById[semantic.id] = semantic;

  const extraRules: AppliedRuleRef[] = [];
  if (params.hadPromptOverride) extraRules.push({ ruleId: 'user.prompt_override' });
  if (params.vgpSteps.length > 1) {
    extraRules.push({ ruleId: 'capability.set', detail: params.vgpSteps.map((s) => s.presetId).join(',') });
  }

  const artifact =
    params.vgpSteps.length > 0
      ? buildCombinedPromptArtifact(params.vgpSteps, now, extraRules)
      : buildPlaceholderArtifact('（无文本步骤记录：执行器未返回提示词快照）', now, extraRules);

  vgpBase.promptsById[artifact.id] = artifact;

  const lineageRoot =
    parentVer?.lineageRootId ?? vgpBase.originalVersionId ?? vgpBase.versionOrder[0] ?? newVgpId();
  const stepIndex = vgpBase.versionOrder.length;
  const newVerId = newVgpId();
  const cap = params.vgpSteps[params.vgpSteps.length - 1];
  const imageVersion: ImageVersion = {
    id: newVerId,
    assetId: asset.id,
    parentVersionId,
    lineageRootId: lineageRoot,
    stepIndex,
    stepKey: params.resultKey,
    role: 'generated',
    imageRef: { kind: 'result_key', key: params.resultKey },
    semanticStateId: semantic.id,
    promptArtifactId: artifact.id,
    createdAt: now,
    ...(cap
      ? {
          modelInvocation: {
            modelId: cap.modelId,
            gear: cap.gear,
            aspectRatio: cap.aspectRatio,
            imageSize: cap.imageSize,
          },
        }
      : {}),
  };
  vgpBase.versionsById[newVerId] = imageVersion;
  vgpBase.versionOrder = [...vgpBase.versionOrder, newVerId];
  vgpBase.headVersionId = newVerId;

  return { ...asset, vgp: vgpBase };
}

export function applyVgpAfterCutStep(
  asset: WorkflowAsset,
  params: { stepKey: string; inputSourceDisplayKey?: string; now?: number }
): WorkflowAsset {
  const now = params.now ?? Date.now();
  const vgpBase = asset.vgp ? deepCloneVgp(asset.vgp) : createInitialVgpForAsset({ id: asset.id, createdAt: asset.createdAt });
  const parentVersionId = resolveParentVersionIdForInput(vgpBase, params.inputSourceDisplayKey);
  const parentVer = parentVersionId ? vgpBase.versionsById[parentVersionId] : undefined;
  const prevSemantic = parentVer ? vgpBase.semanticsById[parentVer.semanticStateId] : undefined;

  const semantic: SemanticState = prevSemantic
    ? cloneSemanticInherited(prevSemantic, now, '切割分组')
    : {
        id: newVgpId(),
        schema_version: VGP_SCHEMA_VERSION,
        createdAt: now,
        target: { summary: '切割分组' },
        dimensions: {},
        locks: {},
        constraints: {},
        provenance: { kind: 'user' },
      };
  vgpBase.semanticsById[semantic.id] = semantic;

  const artifactId = newVgpId();
  const artifact: PromptArtifact = {
    id: artifactId,
    schema_version: VGP_SCHEMA_VERSION,
    createdAt: now,
    compiled_prompt: '',
    applied_rules: [{ ruleId: 'builtin.cut', detail: params.stepKey }],
    compiler_version: 'builtin-cut-1',
  };
  vgpBase.promptsById[artifactId] = artifact;

  const lineageRoot =
    parentVer?.lineageRootId ?? vgpBase.originalVersionId ?? vgpBase.versionOrder[0] ?? newVgpId();
  const stepIndex = vgpBase.versionOrder.length;
  const newVerId = newVgpId();
  const imageVersion: ImageVersion = {
    id: newVerId,
    assetId: asset.id,
    parentVersionId,
    lineageRootId: lineageRoot,
    stepIndex,
    stepKey: params.stepKey,
    role: 'cut',
    imageRef: { kind: 'result_key', key: params.stepKey },
    semanticStateId: semantic.id,
    promptArtifactId: artifactId,
    createdAt: now,
  };
  vgpBase.versionsById[newVerId] = imageVersion;
  vgpBase.versionOrder = [...vgpBase.versionOrder, newVerId];
  vgpBase.headVersionId = newVerId;

  return { ...asset, vgp: vgpBase };
}

export function attachInitialVgpToNewAsset(asset: WorkflowAsset): WorkflowAsset {
  if (asset.vgp) return asset;
  return { ...asset, vgp: createInitialVgpForAsset(asset) };
}

function findVersionIdForDisplayKey(vgp: VgpAssetExtension, displayKey: string): string | null {
  for (const id of vgp.versionOrder) {
    const v = vgp.versionsById[id];
    if (!v) continue;
    const k = v.imageRef.kind === 'original_field' ? 'original' : v.imageRef.key;
    if (k === displayKey) return id;
  }
  return null;
}

/**
 * 丢弃某展示版本前：原始图、组预览、或仍有后续步骤以其为父节点时不可删。
 * 无对应 VGP 节点时不拦截（仅删 results 等，兼容旧数据）。
 */
export function isVgpBlockingDiscardForDisplayKey(vgp: VgpAssetExtension, displayKey: string): boolean {
  if (displayKey === 'original' || displayKey === 'group_preview') return true;
  const vid = findVersionIdForDisplayKey(vgp, displayKey);
  if (!vid) return false;
  const v = vgp.versionsById[vid];
  if (!v || v.role === 'original') return true;
  for (const id of vgp.versionOrder) {
    const w = vgp.versionsById[id];
    if (w?.parentVersionId === vid) return true;
  }
  return false;
}

/**
 * 从 VGP 中移除与 `displayKey` 对应的叶子版本（调用方需先 `isVgpBlockingDiscardForDisplayKey === false`）。
 * 无匹配节点时返回 `undefined`（不修改 vgp）。
 */
export function pruneVgpAfterDiscard(vgp: VgpAssetExtension, displayKey: string): VgpAssetExtension | undefined {
  if (displayKey === 'original' || displayKey === 'group_preview') return undefined;
  const vid = findVersionIdForDisplayKey(vgp, displayKey);
  if (!vid) return undefined;
  const v = vgp.versionsById[vid];
  if (!v || v.role === 'original') return undefined;
  for (const id of vgp.versionOrder) {
    const w = vgp.versionsById[id];
    if (w?.parentVersionId === vid) return undefined;
  }

  const semId = v.semanticStateId;
  const promptId = v.promptArtifactId;
  const nextOrder = vgp.versionOrder.filter((id) => id !== vid);
  const nextVersions = { ...vgp.versionsById };
  delete nextVersions[vid];

  const semStillUsed = nextOrder.some((id) => nextVersions[id]?.semanticStateId === semId);
  const nextSem = { ...vgp.semanticsById };
  if (!semStillUsed) delete nextSem[semId];

  const nextPrompts = { ...vgp.promptsById };
  if (promptId) {
    const promptStillUsed = nextOrder.some((id) => nextVersions[id]?.promptArtifactId === promptId);
    if (!promptStillUsed) delete nextPrompts[promptId];
  }

  let headVersionId = vgp.headVersionId;
  if (headVersionId === vid) {
    headVersionId = nextOrder[nextOrder.length - 1] ?? vgp.originalVersionId;
  }

  return {
    ...vgp,
    versionOrder: nextOrder,
    versionsById: nextVersions,
    semanticsById: nextSem,
    promptsById: nextPrompts,
    headVersionId,
  };
}
