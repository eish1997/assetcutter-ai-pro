/**
 * Expert invoke — Profile + Memory → 真 LLM（Host 注入）或确定性草稿回退。
 * 禁止静默写 Memory / 改 Profile（调优走 tuneProtocol）。
 */

import type { ExpertInvokeInput, ExpertInvokeResult, ExpertProfile } from '../../../types/projectAgent';
import { emitProjectAgentArtifact } from '../artifacts';
import {
  EXPERT_MEMORY_INJECT_CHAR_BUDGET,
  retrieveExpertMemoriesForInject,
  type RetrieveExpertMemoryResult,
} from './memoryStore';
import { getExpertProfile } from './registry';

function emptyMemoryResult(): RetrieveExpertMemoryResult {
  return { entries: [], truncated: false, memoryIdsInjected: [] };
}

function safeRetrieveMemories(input: ExpertInvokeInput): RetrieveExpertMemoryResult {
  try {
    return retrieveExpertMemoriesForInject({
      scope: {
        userId: input.userId,
        expertId: input.expertId,
        workspaceProjectId: input.workspaceProjectId,
      },
      charBudget: EXPERT_MEMORY_INJECT_CHAR_BUDGET,
      query: input.userText.slice(0, 120),
    });
  } catch {
    return emptyMemoryResult();
  }
}

/** 系统人设：使命 / 风格 / 禁区（给 LLM）。 */
export function buildExpertSystemPrompt(profile: ExpertProfile): string {
  const style = profile.styleRules.filter(Boolean).slice(0, 8);
  const taboos = profile.taboos.filter(Boolean).slice(0, 8);
  const lines = [
    `你是「${profile.displayName}」（${profile.expertId}，人设 v${profile.version}）。`,
    `使命：${profile.mission}`,
    style.length ? `风格规则：\n${style.map((s) => `- ${s}`).join('\n')}` : '',
    taboos.length ? `禁区（必须遵守）：\n${taboos.map((t) => `- ${t}`).join('\n')}` : '',
    '直接输出对用户有用的正文；不要复述整段人设标题；不要编造用户未提供的参考细节。',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** 用户侧：记忆注入 + 用户请求。 */
export function buildExpertUserPrompt(userText: string, memoryLines: string[]): string {
  const body = userText.trim() || '（无额外说明）';
  const memoryBlock =
    memoryLines.length > 0
      ? `【相关记忆】\n${memoryLines.map((l) => `- ${l}`).join('\n')}\n\n`
      : '';
  return `${memoryBlock}【用户请求】\n${body}`;
}

/** 无 LLM 时的确定性草稿（回退 / 测试）。 */
export function buildExpertDeterministicDraft(
  profile: ExpertProfile,
  userText: string,
  memoryLines: string[]
): string {
  const memoryBlock =
    memoryLines.length > 0
      ? `\n【注入记忆】\n${memoryLines.map((l) => `- ${l}`).join('\n')}\n`
      : '';
  const style = profile.styleRules.slice(0, 4).join('；');
  const taboos = profile.taboos.slice(0, 3).join('；');
  const body = userText.trim() || '（无额外说明）';

  if (profile.expertId === 'expert.prompt_smith') {
    return [
      `【${profile.displayName} · v${profile.version}】`,
      `使命：${profile.mission}`,
      style ? `风格：${style}` : '',
      taboos ? `禁区：${taboos}` : '',
      memoryBlock.trimEnd(),
      '——',
      '提示词草稿：',
      body,
      '',
      '约束：保持可送模；不编造未提供的参考细节。',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  if (profile.expertId === 'expert.brief_outliner') {
    return [
      `【${profile.displayName} · v${profile.version}】`,
      `使命：${profile.mission}`,
      style ? `风格：${style}` : '',
      taboos ? `禁区：${taboos}` : '',
      memoryBlock.trimEnd(),
      '——',
      '大纲 / 分镜草稿：',
      `1. 开场 — ${body}`,
      '2. 发展 — 推进冲突与信息点',
      '3. 收束 — 明确下一镜可执行动作',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  return [
    `【${profile.displayName} · v${profile.version}】`,
    `使命：${profile.mission}`,
    memoryBlock.trimEnd(),
    '——',
    body,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function safeEmitArtifact(input: ExpertInvokeInput, text: string, profile: ExpertProfile): string {
  try {
    return emitProjectAgentArtifact(
      { userId: input.userId, workspaceProjectId: input.workspaceProjectId },
      {
        kind: 'expert_text',
        text,
        meta: {
          expertId: profile.expertId,
          expertVersion: profile.version,
          displayName: profile.displayName,
        },
        expertId: profile.expertId,
        sourceTurnId: input.turnId,
      }
    );
  } catch {
    return `expert-art-${profile.expertId}-${input.turnId}`;
  }
}

async function resolveExpertOutputText(
  input: ExpertInvokeInput,
  profile: ExpertProfile,
  memoryLines: string[]
): Promise<{ text: string; usedLlm: boolean }> {
  const preferDraft = input.preferDeterministicDraft === true || typeof input.generateText !== 'function';
  if (preferDraft) {
    return {
      text: buildExpertDeterministicDraft(profile, input.userText, memoryLines),
      usedLlm: false,
    };
  }

  const system = buildExpertSystemPrompt(profile);
  const user = buildExpertUserPrompt(input.userText, memoryLines);
  try {
    const raw = await input.generateText!({
      system,
      user,
      model: input.textModel,
    });
    const text = String(raw || '').trim();
    if (!text) {
      return {
        text: buildExpertDeterministicDraft(profile, input.userText, memoryLines),
        usedLlm: false,
      };
    }
    return { text, usedLlm: true };
  } catch {
    const draft = buildExpertDeterministicDraft(profile, input.userText, memoryLines);
    return {
      text: `（模型暂不可用，已回退模板草稿）\n\n${draft}`,
      usedLlm: false,
    };
  }
}

/**
 * Load Profile + Memory budget + optional artifacts → produce text Artifact.
 * Must NOT silently write memory / mutate Profile (use tuneProtocol).
 */
export async function invokeExpert(input: ExpertInvokeInput): Promise<ExpertInvokeResult> {
  const expertId = String(input.expertId || '').trim();
  if (!expertId) {
    return {
      ok: false,
      expertId: '',
      artifactIds: [],
      memoryIdsInjected: [],
      errorMessage: 'Missing expertId',
    };
  }

  const profile = getExpertProfile(expertId);
  if (!profile) {
    return {
      ok: false,
      expertId,
      artifactIds: [],
      memoryIdsInjected: [],
      errorMessage: `Unknown expert: ${expertId}`,
    };
  }

  const memory = safeRetrieveMemories({ ...input, expertId });
  const memoryLines = memory.entries
    .map((e) => e.text.trim())
    .filter(Boolean)
    .slice(0, 12);

  const { text } = await resolveExpertOutputText(input, profile, memoryLines);
  const artifactId = safeEmitArtifact(input, text, profile);

  return {
    ok: true,
    expertId: profile.expertId,
    artifactIds: [artifactId],
    memoryIdsInjected: memory.memoryIdsInjected,
    text,
  };
}
