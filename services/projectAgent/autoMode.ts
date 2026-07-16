/**
 * P23 auto composer routing: thin deterministic resolve (no LLM).
 * Explicit text|image|video|3d chips must not be overwritten by callers; this only
 * resolves when mode === 'auto' (or returns the explicit mode unchanged).
 */

import type { AgentComposerMode, ProjectAgentIntent } from '../../types/projectAgent';

export type ResolvedComposerMode = Exclude<AgentComposerMode, 'auto'>;

const THREE_D_KEYWORD_RE =
  /(?:\b3d\b|三维|立体模型|生成\s*3d|做个?\s*3d|mesh|glb|tripo|文生3d|图生3d)/i;

const VIDEO_KEYWORD_RE =
  /(?:视频|生视频|生成视频|短片|镜头|动画|动起来|video|clip|animate|i2v|t2v)/i;

function hasMainImage(intent: ProjectAgentIntent): boolean {
  if (intent.hasInlineImageRefs === true) return true;
  if (intent.mainAssetId?.trim()) return true;
  if (intent.surface.kind === 'lightbox' && intent.surface.assetId.trim()) return true;
  if (intent.surface.kind === 'canvas' && intent.surface.selectedAssetIds.some((id) => id.trim())) {
    return true;
  }
  return false;
}

function hasAnyImageRef(intent: ProjectAgentIntent): boolean {
  if (hasMainImage(intent)) return true;
  if ((intent.referenceAssetIds ?? []).some((id) => id.trim())) return true;
  if (intent.mentions.some((m) => m.kind === 'asset' && m.id.trim())) return true;
  return false;
}

function isLightboxLocalEdit(intent: ProjectAgentIntent): boolean {
  return intent.surface.kind === 'lightbox' && intent.surface.hasLocalEdit === true;
}

function has3dKeywords(text: string): boolean {
  return THREE_D_KEYWORD_RE.test(text);
}

function hasVideoKeywords(text: string): boolean {
  return VIDEO_KEYWORD_RE.test(text);
}

/**
 * Resolve composer mode for routing.
 * Priority (auto only): video keywords -> video; local edit/image refs -> image;
 * clear 3D keywords + hasEnabled3dPreset -> 3d; else text.
 * Preset cards still short-circuit in planTools before mode is used.
 */
export function resolveComposerMode(intent: ProjectAgentIntent): ResolvedComposerMode {
  if (intent.mode !== 'auto') {
    return intent.mode;
  }

  if (hasVideoKeywords(intent.text)) {
    return 'video';
  }

  if (isLightboxLocalEdit(intent) || hasAnyImageRef(intent)) {
    return 'image';
  }

  if (has3dKeywords(intent.text) && intent.hasEnabled3dPreset) {
    return '3d';
  }

  return 'text';
}
