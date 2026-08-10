/**
 * Build ProjectAgentIntent from composer + surface (Phase 2).
 * Pure — no React.
 */

import type {
  AgentComposerMode,
  AgentMentionRef,
  AgentSurfaceContext,
  ProjectAgentIntent,
} from '../../types/projectAgent';
import type { ProjectAgentPerceptionContext } from '../../types/runtimePerception';

export type BuildProjectAgentIntentInput = {
  text: string;
  mode: AgentComposerMode;
  presetIds?: string[];
  mentions?: AgentMentionRef[];
  surface?: AgentSurfaceContext;
  mainAssetId?: string;
  referenceAssetIds?: string[];
  imageSettings?: ProjectAgentIntent['imageSettings'];
  textModel?: string;
  hasInlineImageRefs?: boolean;
  hasEnabled3dPreset?: boolean;
  enabledSkills?: ProjectAgentIntent['enabledSkills'];
  perception?: ProjectAgentPerceptionContext;
};

export function buildProjectAgentIntent(input: BuildProjectAgentIntentInput): ProjectAgentIntent {
  return {
    text: typeof input.text === 'string' ? input.text : '',
    mode: input.mode,
    presetIds: (input.presetIds ?? []).map((id) => id.trim()).filter(Boolean),
    mentions: input.mentions ?? [],
    surface: input.surface ?? { kind: 'none' },
    ...(input.mainAssetId?.trim() ? { mainAssetId: input.mainAssetId.trim() } : {}),
    ...(input.referenceAssetIds?.length
      ? { referenceAssetIds: input.referenceAssetIds.map((id) => id.trim()).filter(Boolean) }
      : {}),
    ...(input.imageSettings ? { imageSettings: input.imageSettings } : {}),
    ...(input.textModel ? { textModel: input.textModel } : {}),
    ...(typeof input.hasInlineImageRefs === 'boolean'
      ? { hasInlineImageRefs: input.hasInlineImageRefs }
      : {}),
    ...(typeof input.hasEnabled3dPreset === 'boolean'
      ? { hasEnabled3dPreset: input.hasEnabled3dPreset }
      : {}),
    ...(input.enabledSkills?.length ? { enabledSkills: input.enabledSkills } : {}),
    ...(input.perception ? { perception: input.perception } : {}),
  };
}
