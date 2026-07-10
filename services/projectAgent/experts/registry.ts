/**
 * Expert registry — Phase 4A (§17).
 * Contract frozen: do not change exported signatures without main-session merge.
 */

import type { ExpertId, ExpertProfile } from '../../../types/projectAgent';

/** Built-in expert ids (U3 minimum: two experts, same pipe). */
export const EXPERT_PROMPT_SMITH_ID = 'expert.prompt_smith' as const;
export const EXPERT_BRIEF_OUTLINER_ID = 'expert.brief_outliner' as const;

export type BuiltinExpertId =
  | typeof EXPERT_PROMPT_SMITH_ID
  | typeof EXPERT_BRIEF_OUTLINER_ID;

const BUILTIN_PROFILES: readonly ExpertProfile[] = [
  {
    expertId: EXPERT_PROMPT_SMITH_ID,
    version: 1,
    displayName: '提示词专家',
    mentionAliases: ['提示词专家', 'prompt_smith', 'prompt-smith', '提示词', 'PromptSmith'],
    mission: '把用户意图炼成可直接送模的高质量提示词',
    styleRules: ['结构清晰', '可执行', '中英按需混排', '突出主体与约束'],
    taboos: ['不编造未提供的参考图细节', '不输出 API Key 或密钥', '不静默改人设'],
    toolIds: ['invoke_expert'],
  },
  {
    expertId: EXPERT_BRIEF_OUTLINER_ID,
    version: 1,
    displayName: '大纲分镜专家',
    mentionAliases: ['大纲分镜专家', '大纲专家', '分镜专家', 'brief_outliner', '大纲', '分镜'],
    mission: '把需求整理成可执行的大纲与分镜文案',
    styleRules: ['条目化', '镜头感', '节奏清楚', '可交给下游执行'],
    taboos: ['不擅自改剧情主线', '不输出媒体字节', '不静默改工具白名单'],
    toolIds: ['invoke_expert'],
  },
];

/** Runtime overrides after confirmed profile patches (expertId → profile). */
const profileOverrides = new Map<ExpertId, ExpertProfile>();

function cloneProfile(p: ExpertProfile): ExpertProfile {
  return {
    ...p,
    mentionAliases: [...p.mentionAliases],
    styleRules: [...p.styleRules],
    taboos: [...p.taboos],
    ...(p.fewShotRefIds ? { fewShotRefIds: [...p.fewShotRefIds] } : {}),
    toolIds: [...p.toolIds],
  };
}

function normalizeMentionToken(token: string): string {
  return token.trim().replace(/^@+/, '').trim();
}

function tokenMatchesProfile(token: string, profile: ExpertProfile): boolean {
  const t = normalizeMentionToken(token);
  if (!t) return false;
  const lower = t.toLowerCase();
  if (profile.expertId.toLowerCase() === lower) return true;
  if (profile.displayName.toLowerCase() === lower) return true;
  return profile.mentionAliases.some((a) => a.toLowerCase() === lower);
}

/**
 * List all registered expert profiles (built-ins + any runtime overrides).
 */
export function listExpertProfiles(): ExpertProfile[] {
  const seen = new Set<ExpertId>();
  const out: ExpertProfile[] = [];
  for (const p of BUILTIN_PROFILES) {
    const live = profileOverrides.get(p.expertId) ?? p;
    out.push(cloneProfile(live));
    seen.add(p.expertId);
  }
  for (const [id, p] of profileOverrides) {
    if (seen.has(id)) continue;
    out.push(cloneProfile(p));
  }
  return out;
}

export function getExpertProfile(expertId: ExpertId): ExpertProfile | null {
  const id = String(expertId || '').trim();
  if (!id) return null;
  const overridden = profileOverrides.get(id);
  if (overridden) return cloneProfile(overridden);
  const builtin = BUILTIN_PROFILES.find((p) => p.expertId === id);
  return builtin ? cloneProfile(builtin) : null;
}

/** Resolve @alias / displayName / expertId → profile. */
export function resolveExpertByMention(token: string): ExpertProfile | null {
  const t = normalizeMentionToken(token);
  if (!t) return null;
  for (const p of listExpertProfiles()) {
    if (tokenMatchesProfile(t, p)) return p;
  }
  return null;
}

/**
 * Apply confirmed profile patch (version must match baseVersion → version++).
 * Returns null if version mismatch or unknown expert.
 */
export function applyExpertProfilePatch(
  expertId: ExpertId,
  patch: Partial<ExpertProfile> & { baseVersion: number }
): ExpertProfile | null {
  const current = getExpertProfile(expertId);
  if (!current) return null;
  if (current.version !== patch.baseVersion) return null;

  const { baseVersion: _bv, expertId: _eid, version: _ver, ...rest } = patch;
  void _bv;
  void _eid;
  void _ver;

  const next: ExpertProfile = {
    ...current,
    ...rest,
    expertId: current.expertId,
    version: current.version + 1,
    mentionAliases: rest.mentionAliases ? [...rest.mentionAliases] : [...current.mentionAliases],
    styleRules: rest.styleRules ? [...rest.styleRules] : [...current.styleRules],
    taboos: rest.taboos ? [...rest.taboos] : [...current.taboos],
    toolIds: rest.toolIds ? [...rest.toolIds] : [...current.toolIds],
    ...(rest.fewShotRefIds
      ? { fewShotRefIds: [...rest.fewShotRefIds] }
      : current.fewShotRefIds
        ? { fewShotRefIds: [...current.fewShotRefIds] }
        : {}),
  };
  profileOverrides.set(current.expertId, next);
  return cloneProfile(next);
}

/** Test helper: clear runtime profile overrides. */
export function __resetExpertRegistryForTests(): void {
  profileOverrides.clear();
}
