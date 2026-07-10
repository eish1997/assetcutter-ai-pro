/**
 * Expert tune protocol — Phase 4A/4B (§17.9).
 * Contract frozen: do not change exported signatures without main-session merge.
 */

import type {
  ExpertMemoryEntry,
  ExpertTuneProposal,
  ProjectAgentIntent,
} from '../../../types/projectAgent';
import { addExpertMemory } from './memoryStore';
import { getExpertProfile } from './registry';

function textOf(intent: ProjectAgentIntent): string {
  return (intent.text || '').trim();
}

/** 「记住 / 以后都…」→ memory draft */
function detectMemoryProposal(intent: ProjectAgentIntent, expertId: string): ExpertTuneProposal | null {
  const text = textOf(intent);
  if (!text) return null;
  const memoryTrigger =
    /记住|以后都|下次都|别再|不要再|偏好是|请记得|记一下|记着/.test(text);
  if (!memoryTrigger) return null;

  const kind: ExpertMemoryEntry['kind'] = /别再|不要再|别用|不要用/.test(text)
    ? 'rejection'
    : 'preference';

  return {
    kind: 'memory',
    expertId,
    memoryDraft: {
      scope: {
        userId: '',
        expertId,
      },
      kind,
      text: text.slice(0, 500),
    },
  };
}

/** 改人设 / 禁区 / 风格 → pending profilePatch（不直接写） */
function detectProfilePatchProposal(
  intent: ProjectAgentIntent,
  expertId: string
): ExpertTuneProposal | null {
  const text = textOf(intent);
  if (!text) return null;
  const profileTrigger =
    /改(成|为)?人设|更新人设|调整人设|人设改成|禁区(加|改|设)|风格改成|使命改成|把人设/.test(
      text
    );
  if (!profileTrigger) return null;

  const profile = getExpertProfile(expertId);
  if (!profile) return null;

  const patch: ExpertTuneProposal['profilePatch'] = {
    baseVersion: profile.version,
  };

  const missionMatch = text.match(/(?:使命|人设)(?:改成|改为|调整为|变成)\s*[「"']?([^」"'\n]+)[」"']?/);
  if (missionMatch?.[1]?.trim()) {
    patch.mission = missionMatch[1].trim().slice(0, 200);
  } else if (/更像|偏/.test(text)) {
    patch.mission = `${profile.mission}（调优意向：${text.slice(0, 120)}）`;
  }

  const tabooMatch = text.match(/禁区(?:加|加上|增加)\s*[「"']?([^」"'\n]+)[」"']?/);
  if (tabooMatch?.[1]?.trim()) {
    patch.taboos = [...profile.taboos, tabooMatch[1].trim().slice(0, 80)];
  }

  const styleMatch = text.match(/风格(?:改成|改为|调整为)\s*[「"']?([^」"'\n]+)[」"']?/);
  if (styleMatch?.[1]?.trim()) {
    patch.styleRules = [...profile.styleRules, styleMatch[1].trim().slice(0, 80)];
  }

  return {
    kind: 'profilePatch',
    expertId,
    profilePatch: patch,
  };
}

/** 改工具 / 加技能 → skillRequest（工作室确认） */
function detectSkillRequestProposal(
  intent: ProjectAgentIntent,
  expertId: string
): ExpertTuneProposal | null {
  const text = textOf(intent);
  if (!text) return null;
  const skillTrigger =
    /加上?.{0,12}(工具|技能|能力|预设)|开通.{0,8}(工具|技能)|改(工具|白名单|toolIds)|能直接存预设/.test(
      text
    );
  if (!skillTrigger) return null;

  return {
    kind: 'skillRequest',
    expertId,
    skillRequest: {
      toolIds: [],
      note: text.slice(0, 300),
    },
  };
}

export type DetectExpertTuneOptions = {
  userId: string;
  workspaceProjectId?: string;
};

/**
 * Detect explicit tune intents from user text ("记住", profile change, skill request).
 * Ordinary chat → empty array (no_silent_memory).
 * Pass opts.userId so memoryDraft.scope is not empty (review fix).
 */
export function detectExpertTuneProposals(
  intent: ProjectAgentIntent,
  expertId: string,
  opts?: DetectExpertTuneOptions
): ExpertTuneProposal[] {
  const id = String(expertId || '').trim();
  if (!id) return [];

  const out: ExpertTuneProposal[] = [];
  const memory = detectMemoryProposal(intent, id);
  if (memory) out.push(memory);
  const profile = detectProfilePatchProposal(intent, id);
  if (profile) out.push(profile);
  const skill = detectSkillRequestProposal(intent, id);
  if (skill) out.push(skill);

  const userId = String(opts?.userId ?? '').trim();
  const workspaceProjectId = String(opts?.workspaceProjectId ?? '').trim() || undefined;
  if (userId) {
    for (const p of out) {
      if (p.kind === 'memory' && p.memoryDraft) {
        p.memoryDraft = {
          ...p.memoryDraft,
          scope: {
            ...p.memoryDraft.scope,
            userId,
            expertId: id,
            ...(workspaceProjectId ? { workspaceProjectId } : {}),
          },
        };
      }
    }
  }
  return out;
}

/**
 * Apply a confirmed memory proposal (writes ExpertMemoryStore).
 * Profile/skill proposals must go through confirm APIs — not here.
 */
export function applyConfirmedMemoryProposal(proposal: ExpertTuneProposal): {
  ok: boolean;
  memoryId?: string;
} {
  if (proposal.kind !== 'memory' || !proposal.memoryDraft) {
    return { ok: false };
  }
  try {
    const entry = addExpertMemory({
      ...proposal.memoryDraft,
      scope: {
        ...proposal.memoryDraft.scope,
        expertId: proposal.expertId || proposal.memoryDraft.scope.expertId,
      },
    });
    return { ok: true, memoryId: entry.id };
  } catch {
    return { ok: false };
  }
}
