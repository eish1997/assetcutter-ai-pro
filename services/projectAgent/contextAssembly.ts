/**
 * B-layer context assembly — Phase 4F (§18.5).
 * Contract frozen: do not change exported signatures without main-session merge.
 */

import type {
  ProjectAgentAssembledContext,
  ProjectAgentIntent,
} from '../../types/projectAgent';
import type { QuickComposeThreadMessage } from '../../types/quickComposeThread';
import {
  extractQuickComposeTurnRounds,
  type QuickComposeTurnRound,
} from '../quickComposeTurnContext';
import type { ProjectAgentThread } from './threadStore';
import {
  loadProjectAgentCompaction,
  PROJECT_AGENT_COMPACTION_KEEP_RECENT,
  type CompactionStoreKey,
} from './compaction';

export type AssembleProjectAgentContextInput = {
  key: CompactionStoreKey;
  thread: ProjectAgentThread;
  intent: ProjectAgentIntent;
  /** Optional pre-built expert context string from invoke path */
  expertContext?: string;
  recentRounds?: number;
};

const DEFAULT_RECENT_ROUNDS = Math.max(8, Math.floor(PROJECT_AGENT_COMPACTION_KEEP_RECENT / 2));
const MAX_LINE_CHARS = 2000;
const SUMMARY_CAP = 4000;

/** Strip data-URL / long base64 blobs from lean text (A22 / §18.6). */
function stripBase64(text: string): string {
  let out = String(text ?? '');
  out = out.replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=\s]+/gi, '[omitted-base64]');
  out = out.replace(/(?:^|[\s"'])([A-Za-z0-9+/]{80,}={0,2})(?=$|[\s"'])/g, ' [omitted-base64] ');
  return out.replace(/\s+/g, ' ').trim();
}

function leanBody(message: QuickComposeThreadMessage): string {
  const raw =
    (typeof message.resultText === 'string' && message.resultText.trim()
      ? message.resultText
      : message.text) || '';
  return stripBase64(raw).slice(0, MAX_LINE_CHARS);
}

function formatRoundLean(round: QuickComposeTurnRound): string {
  const lines: string[] = [];
  const userBody = leanBody(round.user);
  if (userBody) lines.push(`User: ${userBody}`);
  if (round.assistant) {
    const assistantBody = leanBody(round.assistant);
    if (assistantBody) lines.push(`Assistant: ${assistantBody}`);
  }
  return lines.join('\n');
}

function formatIntentSignals(intent: ProjectAgentIntent): string {
  const bits: string[] = [];
  const mode = String(intent.mode || '').trim();
  if (mode) bits.push(`mode=${mode}`);
  if (intent.presetIds?.length) bits.push(`presets=${intent.presetIds.join(',')}`);
  if (intent.mentions?.length) {
    bits.push(`mentions=${intent.mentions.map((m) => m.id).filter(Boolean).join(',')}`);
  }
  const surface = intent.surface?.kind ? `surface=${intent.surface.kind}` : '';
  if (surface) bits.push(surface);
  return bits.length ? `Intent: ${bits.join('; ')}` : '';
}

/**
 * B = compaction summary? + recent K rounds + intent signals + optional expertContext.
 * Must not embed base64 / full tool logs.
 */
export function assembleProjectAgentContext(
  input: AssembleProjectAgentContextInput
): ProjectAgentAssembledContext {
  const recentRounds = Math.max(
    1,
    Math.floor(input.recentRounds ?? DEFAULT_RECENT_ROUNDS)
  );
  const messages = Array.isArray(input.thread.messages) ? input.thread.messages : [];
  const rounds = extractQuickComposeTurnRounds(messages);
  const truncatedByWindow = rounds.length > recentRounds;
  const recent = rounds.slice(-recentRounds);
  const recentBlocks = recent.map(formatRoundLean).filter(Boolean);
  const intentLine = formatIntentSignals(input.intent);
  const recentParts = [...recentBlocks];
  if (intentLine) recentParts.push(intentLine);
  const recentText = recentParts.join('\n\n');

  const compaction = loadProjectAgentCompaction(input.key);
  const compactionSummary = compaction?.summaryText?.trim()
    ? stripBase64(compaction.summaryText).slice(0, SUMMARY_CAP)
    : undefined;

  const expertRaw = typeof input.expertContext === 'string' ? input.expertContext.trim() : '';
  const expertContext = expertRaw ? stripBase64(expertRaw).slice(0, SUMMARY_CAP) : undefined;

  const truncated =
    truncatedByWindow ||
    Boolean(compactionSummary) ||
    Boolean(compaction?.coveredMessageIds?.length);

  return {
    recentText,
    ...(compactionSummary ? { compactionSummary } : {}),
    ...(expertContext ? { expertContext } : {}),
    truncated,
  };
}

/** Tool ids that should receive B-layer conversation context (§16.8). Image/3d/preset skip. */
export const PROJECT_AGENT_CONTEXT_INJECT_TOOL_IDS = [
  'run_plain_text',
  'invoke_expert',
] as const;

export function planNeedsConversationContext(
  plan: ReadonlyArray<{ toolId: string }>
): boolean {
  return plan.some((step) =>
    (PROJECT_AGENT_CONTEXT_INJECT_TOOL_IDS as readonly string[]).includes(step.toolId)
  );
}

/**
 * Lean prefix for overrideUserText / invokeExpert.userText.
 * Omits trailing Intent: signal line (already on the turn intent).
 */
export function formatAssembledContextPrefix(
  assembled: ProjectAgentAssembledContext
): string {
  const parts: string[] = [];
  const summary = assembled.compactionSummary?.trim();
  if (summary) parts.push(`【更早摘要】\n${summary}`);
  const recent = String(assembled.recentText || '')
    .replace(/(?:\n\n)?Intent:[^\n]*\s*$/u, '')
    .trim();
  if (recent) parts.push(`【最近对话】\n${recent}`);
  return parts.join('\n\n');
}

/** Prefix current user text with assembled context; no-op when empty. */
export function injectAssembledContextIntoUserText(
  userText: string,
  assembled: ProjectAgentAssembledContext
): string {
  const prefix = formatAssembledContextPrefix(assembled);
  const body = String(userText ?? '').trim();
  if (!prefix) return body;
  if (!body) return prefix;
  return `${prefix}\n\n${body}`;
}
