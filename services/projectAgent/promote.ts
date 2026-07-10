/**
 * Promote Artifact → capability preset (L3) — Phase 4D (§17 / P1c / P13).
 * Contract frozen: do not change exported signatures without main-session merge.
 *
 * Call only after user confirm at the call site. Default personal domain (P13).
 */

import type { CapabilityCategory, CustomAppModule } from '../../types';
import type { ProjectAgentArtifact, PromoteTarget } from '../../types/projectAgent';
import { loadCapabilityPresets, saveCapabilityPresets } from '../capabilityPresetStore';
import {
  artifactTextForQuickCompose,
  getProjectAgentArtifact,
  type ArtifactStoreKey,
} from './artifacts';
import { addExpertMemory } from './experts/memoryStore';
import { EXPERT_PROMPT_SMITH_ID } from './experts/registry';

export type PromoteArtifactResult = {
  ok: boolean;
  presetId?: string;
  errorMessage?: string;
};

const CAPABILITY_CATEGORY_IDS = new Set<string>([
  'text_to_text',
  'text_to_image',
  'image_to_image',
  'image_process',
  'image_to_text',
  'generate_3d',
  'generate_video',
]);

function genPresetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `pa-preset-${crypto.randomUUID()}`;
  }
  return `pa-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveCategory(artifact: ProjectAgentArtifact): CapabilityCategory {
  const raw = artifact.meta?.category;
  if (typeof raw === 'string' && CAPABILITY_CATEGORY_IDS.has(raw)) {
    return raw as CapabilityCategory;
  }
  return 'text_to_text';
}

function resolveLabel(artifact: ProjectAgentArtifact, target: PromoteTarget): string {
  const fromTarget = typeof target.name === 'string' ? target.name.trim() : '';
  if (fromTarget) return fromTarget;
  const meta = artifact.meta;
  if (meta && typeof meta === 'object') {
    for (const k of ['label', 'name', 'title'] as const) {
      const v = meta[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  const kind = String(artifact.kind || 'artifact').trim() || 'artifact';
  return `Agent · ${kind}`;
}

function buildPresetFromArtifact(
  artifact: ProjectAgentArtifact,
  target: PromoteTarget,
  order: number
): CustomAppModule | null {
  const instruction = artifactTextForQuickCompose(artifact);
  if (!instruction) return null;
  const category = resolveCategory(artifact);
  const label = resolveLabel(artifact, target);
  const id = genPresetId();
  const preset: CustomAppModule = {
    id,
    label,
    category,
    instruction,
    enabled: true,
    order,
    ...(category === 'text_to_text' || category === 'image_to_text'
      ? { engine: 'gen_text' as const }
      : category === 'text_to_image' || category === 'image_to_image'
        ? { engine: 'gen_image' as const }
        : {}),
  };
  return preset;
}

/**
 * Optionally write a pointer memory after successful promote.
 * memoryStore may still be a 4B stub — skip quietly with comment.
 */
function maybeWritePromotePointerMemory(
  key: ArtifactStoreKey,
  artifact: ProjectAgentArtifact,
  presetId: string
): void {
  // Optional promote_pointer_memory (§17.9).
  // If memoryStore is still the 4B stub (throws), skip quietly — do not fail promote.
  try {
    const expertId =
      typeof artifact.expertId === 'string' && artifact.expertId.trim()
        ? artifact.expertId.trim()
        : EXPERT_PROMPT_SMITH_ID;
    addExpertMemory({
      scope: {
        userId: key.userId,
        expertId,
        workspaceProjectId: key.workspaceProjectId,
      },
      kind: 'pointer',
      text: `Promoted artifact ${artifact.id} → preset ${presetId}`,
      pointer: { type: 'preset', id: presetId },
      ...(artifact.sourceTurnId ? { sourceTurnId: artifact.sourceTurnId } : {}),
    });
  } catch {
    // memoryStore not implemented (4B stub) — skip pointer write
  }
}

/**
 * User-confirmed promote only. Default personal domain.
 * Must pass `opts.confirmed: true` or returns ok:false (review gate).
 */
export async function promoteProjectAgentArtifact(
  key: ArtifactStoreKey,
  artifactId: string,
  target: PromoteTarget,
  opts?: { confirmed?: boolean }
): Promise<PromoteArtifactResult> {
  if (opts?.confirmed !== true) {
    return { ok: false, errorMessage: 'promote_requires_confirm' };
  }
  if (!target || target.targetKind !== 'capability_preset') {
    return { ok: false, errorMessage: 'unsupported_target_kind' };
  }
  const artifact = getProjectAgentArtifact(key, artifactId);
  if (!artifact) {
    return { ok: false, errorMessage: 'artifact_not_found' };
  }
  try {
    const existing = loadCapabilityPresets();
    const preset = buildPresetFromArtifact(artifact, target, existing.length);
    if (!preset) {
      return { ok: false, errorMessage: 'artifact_empty' };
    }
    const next = [...existing, preset];
    saveCapabilityPresets(next);
    maybeWritePromotePointerMemory(key, artifact, preset.id);
    return { ok: true, presetId: preset.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errorMessage: msg || 'promote_failed' };
  }
}
