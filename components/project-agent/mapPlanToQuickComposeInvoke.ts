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
  preferTextPipelineWhenNoImagesAttached?: boolean;
  presetCardsOverride?: WorkspaceQuickComposePromptCard[];
  /** Host should call lightbox local-edit pipeline instead of submitQuickCompose. */
  useLightboxLocalEdit?: boolean;
  errorMessage?: string;
};

export type ResolvePresetCardFn = (presetId: string) => {
  label: string;
  instruction: string;
} | null;

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
  if (first.toolId === 'run_plain_t2i' || first.toolId === 'run_plain_i2i') {
    return { ...base, forceComposeMode: 'image' };
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
