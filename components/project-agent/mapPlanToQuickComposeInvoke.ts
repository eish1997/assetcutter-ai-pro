/**
 * Map Agent plan tools → QuickCompose submit invoke options (Host bridge helper).
 * Pure — no React / WorkflowSection.
 */

import type { AgentPlannedTool, ProjectAgentIntent } from '../../types/projectAgent';
import type {
  WorkspaceQuickComposeComposeMode,
  WorkspaceQuickComposePromptCard,
} from '../WorkspaceQuickComposeBar';

export type QuickComposeInvokeFromPlan = {
  overrideUserText: string;
  skipPromptCards: boolean;
  forceComposeMode?: WorkspaceQuickComposeComposeMode;
  allowVisionText?: boolean;
  preferTextPipelineWhenNoImagesAttached?: boolean;
  /** Existing asset that should receive generated result history. */
  reuseAssetId?: string;
  /** Existing assets that should receive generated result history. */
  reuseAssetIds?: string[];
  /** Mentioned/reference assets captured at submit time. */
  referenceAssetIds?: string[];
  presetCardsOverride?: WorkspaceQuickComposePromptCard[];
  /** Host should call lightbox local-edit pipeline instead of submitQuickCompose. */
  useLightboxLocalEdit?: boolean;
  /** Host should call invokeExpert for each id (same pipe; may be multiple @experts). */
  invokeExpertIds?: string[];
  /** @deprecated use invokeExpertIds — kept for one-release compat */
  invokeExpertId?: string;
  errorMessage?: string;
};

export type ResolvePresetCardFn = (presetId: string) => {
  label: string;
  instruction: string;
} | null;

function resolveMainAssetId(intent: ProjectAgentIntent, step?: AgentPlannedTool): string | undefined {
  const fromStep = String(step?.args?.mainAssetId ?? step?.args?.assetId ?? '').trim();
  if (fromStep) return fromStep;
  if (intent.mainAssetId?.trim()) return intent.mainAssetId.trim();
  if (intent.surface.kind === 'lightbox') return intent.surface.assetId.trim() || undefined;
  if (intent.surface.kind === 'canvas') {
    return intent.surface.selectedAssetIds.find((id) => id.trim())?.trim();
  }
  return undefined;
}

function resolveMainAssetIds(intent: ProjectAgentIntent, step?: AgentPlannedTool): string[] {
  const fromStep = step?.args?.mainAssetIds;
  if (Array.isArray(fromStep)) {
    return fromStep.map((id) => String(id || '').trim()).filter(Boolean);
  }
  if (intent.surface.kind === 'canvas' && intent.surface.selectedAssetIds.length > 1) {
    return intent.surface.selectedAssetIds.map((id) => id.trim()).filter(Boolean);
  }
  const one = resolveMainAssetId(intent, step);
  if (one) return [one];
  if (intent.surface.kind === 'canvas') {
    return intent.surface.selectedAssetIds.map((id) => id.trim()).filter(Boolean);
  }
  return [];
}

function resolveReferenceAssetIds(intent: ProjectAgentIntent, step?: AgentPlannedTool): string[] {
  const fromStep = step?.args?.referenceAssetIds;
  if (Array.isArray(fromStep)) {
    return fromStep.map((id) => String(id || '').trim()).filter(Boolean);
  }
  return (intent.referenceAssetIds ?? []).map((id) => id.trim()).filter(Boolean);
}

export function mapPlanToQuickComposeInvoke(
  intent: ProjectAgentIntent,
  plan: AgentPlannedTool[],
  resolvePreset: ResolvePresetCardFn,
  genCardKey: () => string
): QuickComposeInvokeFromPlan {
  if (!plan.length) {
    return {
      overrideUserText: intent.text,
      skipPromptCards: true,
      errorMessage: 'Empty plan',
    };
  }
  const first = plan[0]!;
  if (first.toolId === 'run_lightbox_local_edit') {
    return {
      overrideUserText: intent.text,
      skipPromptCards: true,
      useLightboxLocalEdit: true,
    };
  }
  if (first.toolId === 'invoke_expert') {
    const ids: string[] = [];
    for (const step of plan) {
      if (step.toolId !== 'invoke_expert') break;
      const expertId = String(step.args?.expertId ?? '').trim();
      if (expertId) ids.push(expertId);
    }
    return {
      overrideUserText: intent.text,
      skipPromptCards: true,
      invokeExpertIds: ids,
      invokeExpertId: ids[0],
      ...(ids.length ? {} : { errorMessage: 'invoke_expert missing expertId' }),
    };
  }

  const base: QuickComposeInvokeFromPlan = {
    overrideUserText: intent.text,
    skipPromptCards: true,
  };

  if (first.toolId === 'run_plain_text') {
    return {
      ...base,
      forceComposeMode: 'text',
      preferTextPipelineWhenNoImagesAttached: true,
    };
  }
  if (first.toolId === 'run_plain_i2t') {
    const reuseAssetIds = resolveMainAssetIds(intent, first);
    const referenceAssetIds = resolveReferenceAssetIds(intent, first);
    return {
      ...base,
      forceComposeMode: 'text',
      allowVisionText: true,
      ...(reuseAssetIds[0] ? { reuseAssetId: reuseAssetIds[0] } : {}),
      ...(reuseAssetIds.length ? { reuseAssetIds } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
    };
  }
  if (first.toolId === 'run_plain_t2i' || first.toolId === 'run_plain_i2i') {
    const reuseAssetIds = first.toolId === 'run_plain_i2i' ? resolveMainAssetIds(intent, first) : [];
    const referenceAssetIds = resolveReferenceAssetIds(intent, first);
    return {
      ...base,
      forceComposeMode: 'image',
      ...(reuseAssetIds[0] ? { reuseAssetId: reuseAssetIds[0] } : {}),
      ...(reuseAssetIds.length ? { reuseAssetIds } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
    };
  }
  if (first.toolId === 'run_plain_video') {
    const reuseAssetIds = resolveMainAssetIds(intent, first);
    const referenceAssetIds = resolveReferenceAssetIds(intent, first);
    return {
      ...base,
      forceComposeMode: 'video',
      ...(reuseAssetIds[0] ? { reuseAssetId: reuseAssetIds[0] } : {}),
      ...(reuseAssetIds.length ? { reuseAssetIds } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
    };
  }
  if (first.toolId === 'run_plain_3d') {
    return { ...base, forceComposeMode: '3d' };
  }
  if (first.toolId === 'run_preset') {
    const cards: WorkspaceQuickComposePromptCard[] = [];
    for (const step of plan) {
      if (step.toolId !== 'run_preset') continue;
      const presetId = String(step.args?.presetId ?? '').trim();
      if (!presetId) continue;
      const mod = resolvePreset(presetId);
      cards.push({
        key: genCardKey(),
        presetId,
        label: mod?.label || presetId,
        instruction: mod?.instruction ?? '',
      });
    }
    if (!cards.length) {
      return { ...base, errorMessage: 'No valid presets in plan' };
    }
    return {
      ...base,
      skipPromptCards: false,
      presetCardsOverride: cards,
    };
  }
  return { ...base, errorMessage: `Unsupported tool: ${first.toolId}` };
}
