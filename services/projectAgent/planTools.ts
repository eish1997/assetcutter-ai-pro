/**
 * Rule router: Intent → ordered tool plan (§5.2 / §16.4).
 * Pure function — no React / WorkflowSection.
 */

import type { AgentPlanResult, AgentPlannedTool, ProjectAgentIntent } from '../../types/projectAgent';
import { PROJECT_AGENT_MAX_TOOL_STEPS } from '../../types/projectAgent';
import { getToolDefinition } from './tools/registry';

function labelFor(toolId: AgentPlannedTool['toolId']): string {
  return getToolDefinition(toolId)?.label ?? toolId;
}

function step(toolId: AgentPlannedTool['toolId'], args?: Record<string, unknown>): AgentPlannedTool {
  return { toolId, label: labelFor(toolId), ...(args ? { args } : {}) };
}

function hasMainImage(intent: ProjectAgentIntent): boolean {
  if (intent.mainAssetId?.trim()) return true;
  if (intent.surface.kind === 'lightbox' && intent.surface.assetId.trim()) return true;
  if (intent.surface.kind === 'canvas' && intent.surface.selectedAssetIds.some((id) => id.trim())) {
    return true;
  }
  return false;
}

function resolveMainAssetId(intent: ProjectAgentIntent): string | undefined {
  if (intent.mainAssetId?.trim()) return intent.mainAssetId.trim();
  if (intent.surface.kind === 'lightbox') return intent.surface.assetId.trim() || undefined;
  if (intent.surface.kind === 'canvas') {
    const id = intent.surface.selectedAssetIds.find((x) => x.trim());
    return id?.trim();
  }
  return undefined;
}

function isLightboxLocalEdit(intent: ProjectAgentIntent): boolean {
  return intent.surface.kind === 'lightbox' && intent.surface.hasLocalEdit === true;
}

function textNonEmpty(intent: ProjectAgentIntent): boolean {
  return intent.text.trim().length > 0;
}

function hasAnyRef(intent: ProjectAgentIntent): boolean {
  if (hasMainImage(intent)) return true;
  if ((intent.referenceAssetIds ?? []).some((id) => id.trim())) return true;
  if (intent.mentions.some((m) => m.kind === 'asset' && m.id.trim())) return true;
  return false;
}

/**
 * Deterministic routing. Presets beat mode chips. Caps at PROJECT_AGENT_MAX_TOOL_STEPS.
 */
function collectPresetIds(intent: ProjectAgentIntent): string[] {
  const fromCards = (intent.presetIds ?? []).map((id) => id.trim()).filter(Boolean);
  const fromMentions = intent.mentions
    .filter((m) => m.kind === 'preset' && m.id.trim())
    .map((m) => m.id.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...fromCards, ...fromMentions]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function planTools(intent: ProjectAgentIntent): AgentPlanResult {
  const presetIds = collectPresetIds(intent);

  // Priority 1: explicit presets (each card → one run_preset)
  if (presetIds.length > 0) {
    const plan = presetIds.map((presetId) => step('run_preset', { presetId }));
    if (plan.length > PROJECT_AGENT_MAX_TOOL_STEPS) {
      return {
        ok: false,
        errorMessage: `Plan exceeds max ${PROJECT_AGENT_MAX_TOOL_STEPS} tool steps`,
      };
    }
    return { ok: true, plan };
  }

  // Lightbox local edit (more specific than plain image)
  if (isLightboxLocalEdit(intent)) {
    const assetId = intent.surface.kind === 'lightbox' ? intent.surface.assetId : '';
    if (!assetId.trim()) {
      return { ok: false, errorMessage: 'Lightbox local edit requires assetId' };
    }
    return {
      ok: true,
      plan: [
        step('run_lightbox_local_edit', {
          assetId,
          displayKey: intent.surface.kind === 'lightbox' ? intent.surface.displayKey : '',
          localEdit: true,
          text: intent.text,
        }),
      ],
    };
  }

  // Mode 3D
  if (intent.mode === '3d') {
    if (!intent.hasEnabled3dPreset) {
      return { ok: false, errorMessage: 'No enabled 3D preset available' };
    }
    return {
      ok: true,
      plan: [
        step('run_plain_3d', {
          text: intent.text,
          mainAssetId: resolveMainAssetId(intent),
        }),
      ],
    };
  }

  // Mode image
  if (intent.mode === 'image') {
    if (!textNonEmpty(intent) && !hasAnyRef(intent)) {
      return { ok: false, errorMessage: 'Empty text and no image reference' };
    }
    if (hasMainImage(intent)) {
      return {
        ok: true,
        plan: [
          step('run_plain_i2i', {
            text: intent.text,
            mainAssetId: resolveMainAssetId(intent),
            referenceAssetIds: intent.referenceAssetIds,
          }),
        ],
      };
    }
    if (!textNonEmpty(intent)) {
      return { ok: false, errorMessage: 'Text-to-image requires a prompt' };
    }
    return {
      ok: true,
      plan: [step('run_plain_t2i', { text: intent.text })],
    };
  }

  // Mode text (default)
  if (!textNonEmpty(intent) && !hasAnyRef(intent) && presetIds.length === 0) {
    return { ok: false, errorMessage: 'Empty text with no attachment or preset' };
  }
  if (!textNonEmpty(intent)) {
    return { ok: false, errorMessage: 'Text mode requires non-empty text' };
  }
  return {
    ok: true,
    plan: [step('run_plain_text', { text: intent.text, textModel: intent.textModel })],
  };
}
