/**
 * VGP (Visual Goal Protocol) — 阶段 A 数据骨架。
 * @see docs/spec/PHASE_A_VGP_FOUNDATION.md
 */

export const VGP_SCHEMA_VERSION = 'vgp-1' as const;

export type SemanticProvenanceKind = 'user' | 'inherited' | 'agent_derived';

export type SemanticState = {
  id: string;
  schema_version: typeof VGP_SCHEMA_VERSION;
  createdAt: number;
  target: { summary?: string };
  dimensions: Record<string, string | undefined>;
  locks: Record<string, boolean>;
  constraints: Record<string, unknown>;
  provenance: {
    kind: SemanticProvenanceKind;
    parentSemanticId?: string;
    note?: string;
  };
};

export type AppliedRuleRef = { ruleId: string; detail?: string };

export type PromptArtifact = {
  id: string;
  schema_version: typeof VGP_SCHEMA_VERSION;
  createdAt: number;
  compiled_prompt: string;
  negative_prompt?: string;
  applied_rules: AppliedRuleRef[];
  compiler_version: string;
  raw_understood_instruction?: string;
};

export type ImageVersionRole = 'original' | 'generated' | 'cut' | 'imported';

export type ImageRef =
  | { kind: 'result_key'; key: string }
  | { kind: 'original_field' };

export type ImageVersion = {
  id: string;
  assetId: string;
  parentVersionId: string | null;
  lineageRootId: string;
  stepIndex: number;
  stepKey: string;
  role: ImageVersionRole;
  imageRef: ImageRef;
  semanticStateId: string;
  promptArtifactId?: string;
  modelInvocation?: {
    modelId: string;
    gear?: string;
    aspectRatio?: string;
    imageSize?: string;
  };
  createdAt: number;
};

/** 阶段 C 预留 */
export type Evaluation = {
  id: string;
  subjectVersionId: string;
  againstSemanticId: string;
  scores: Record<string, number>;
  pass: boolean;
  thresholds_snapshot?: Record<string, number>;
  failure_axes?: string[];
  recommended_action?: string;
};

export type VgpAssetExtension = {
  schema_version: typeof VGP_SCHEMA_VERSION;
  versionsById: Record<string, ImageVersion>;
  versionOrder: string[];
  semanticsById: Record<string, SemanticState>;
  promptsById: Record<string, PromptArtifact>;
  headVersionId?: string;
  originalVersionId?: string;
  evaluationsById?: Record<string, Evaluation>;
};

/** 执行器上报的单次生图步骤（供 UI 写入 VGP） */
export type VgpGenStepCapture = {
  stepKey: string;
  understoodPrompt: string;
  presetId: string;
  presetLabel: string;
  modelId: string;
  gear?: string;
  aspectRatio?: string;
  imageSize?: string;
};
