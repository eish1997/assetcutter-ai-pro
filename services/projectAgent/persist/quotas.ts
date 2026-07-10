/**
 * Project Agent local storage quotas — Phase 3D (§17.10 / §18).
 * Hot window 80 + byte estimate + QuotaExceeded degrade. No cloud 200–500 policy (P1).
 */

import { writeLocalStringOrThrow } from '../../clientPersist';
import {
  PROJECT_AGENT_THREAD_STORE_VERSION,
  projectAgentThreadStorageKey,
  trimProjectAgentThreadMessages,
  type ProjectAgentThread,
  type ProjectAgentThreadStoreKey,
} from '../threadStore';
import type { QuickComposeThreadMessage } from '../../../types/quickComposeThread';

export type SaveProjectAgentThreadGuardedResult =
  | { ok: true; thread: ProjectAgentThread }
  | { ok: false; reason: 'quota' };

/** Keep errorMessage on the newest N messages when stripping optional fields. */
const ERROR_MESSAGE_KEEP = 5;

/** Progressive hot-window sizes after QuotaExceeded (first pass uses MAX=80). Never 0 — empty write is fail. */
const AGGRESSIVE_MESSAGE_CAPS = [40, 20, 10, 5, 2, 1] as const;

/** Cap text / resultText length on aggressive slim. */
const AGGRESSIVE_TEXT_CHARS = 2000;

function isQuotaExceededError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    if (e.name === 'QuotaExceededError') return true;
  }
  if (e && typeof e === 'object' && 'name' in e) {
    const name = String((e as { name: unknown }).name ?? '');
    if (name === 'QuotaExceededError') return true;
  }
  if (e instanceof Error && /quota/i.test(e.message)) return true;
  return false;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function toStorageJson(thread: ProjectAgentThread): string {
  return JSON.stringify({
    version: PROJECT_AGENT_THREAD_STORE_VERSION,
    id: thread.id,
    workspaceProjectId: thread.workspaceProjectId,
    messages: thread.messages,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  });
}

/** Rough UTF-8 / JSON size estimate for quota decisions (matches on-disk payload). */
export function estimateProjectAgentThreadBytes(thread: ProjectAgentThread): number {
  try {
    return new TextEncoder().encode(toStorageJson(thread)).byteLength;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function slimMessage(
  message: QuickComposeThreadMessage,
  opts: { keepError: boolean; truncate: boolean }
): QuickComposeThreadMessage {
  const maxChars = opts.truncate ? AGGRESSIVE_TEXT_CHARS : Number.POSITIVE_INFINITY;
  const next: QuickComposeThreadMessage = {
    id: message.id,
    role: message.role,
    text: truncateText(typeof message.text === 'string' ? message.text : '', maxChars),
    timestamp: message.timestamp,
  };
  if (message.status) next.status = message.status;
  if (message.assetIds?.length) next.assetIds = message.assetIds;
  if (message.taskIds?.length) next.taskIds = message.taskIds;
  if (message.planSteps?.length) next.planSteps = message.planSteps;
  if (message.childRuns?.length) next.childRuns = message.childRuns;
  // Drop heavy optionals: resultText, taskAssetById. Keep errorMessage on recent few.
  if (opts.keepError && message.errorMessage) {
    next.errorMessage = truncateText(message.errorMessage, maxChars);
  }
  return next;
}

function slimThreadMessages(
  thread: ProjectAgentThread,
  opts: { keepErrorCount: number; truncate: boolean }
): ProjectAgentThread {
  const messages = thread.messages;
  const keepFrom = Math.max(0, messages.length - opts.keepErrorCount);
  return {
    ...thread,
    messages: messages.map((m, i) =>
      slimMessage(m, { keepError: i >= keepFrom, truncate: opts.truncate })
    ),
  };
}

function withMessageCap(thread: ProjectAgentThread, maxMessages: number): ProjectAgentThread {
  if (maxMessages <= 0) return { ...thread, messages: [] };
  if (thread.messages.length <= maxMessages) return thread;
  return { ...thread, messages: thread.messages.slice(-maxMessages) };
}

/**
 * Trim hot window (and optionally drop heavy optional fields) before write.
 * Must stay compatible with PROJECT_AGENT_THREAD_MAX_MESSAGES (80).
 */
export function trimProjectAgentThreadForQuota(thread: ProjectAgentThread): ProjectAgentThread {
  return {
    ...thread,
    messages: trimProjectAgentThreadMessages(thread.messages),
  };
}

function tryWriteThread(key: ProjectAgentThreadStoreKey, thread: ProjectAgentThread): void {
  writeLocalStringOrThrow(projectAgentThreadStorageKey(key), toStorageJson(thread));
}

/**
 * Save with trim + QuotaExceeded handling.
 * Success returns the thread actually written (may be trimmed/slimmed).
 * On quota failure returns `{ ok: false, reason: 'quota' }` — does not throw for quota.
 * Never silently succeeds with empty messages when the input had messages.
 */
export function saveProjectAgentThreadGuarded(
  key: ProjectAgentThreadStoreKey,
  thread: ProjectAgentThread
): SaveProjectAgentThreadGuardedResult {
  // Pass 1: hot window 80 (full optional fields)
  const candidate = trimProjectAgentThreadForQuota(thread);
  const hadMessages = candidate.messages.length > 0;

  const attempts: ProjectAgentThread[] = [
    candidate,
    // Pass 2: same window, strip heavy fields (keep recent errorMessage)
    slimThreadMessages(candidate, { keepErrorCount: ERROR_MESSAGE_KEEP, truncate: false }),
    // Pass 3+: smaller windows + strip + truncate long text (min 1 message)
    ...AGGRESSIVE_MESSAGE_CAPS.map((cap) =>
      slimThreadMessages(withMessageCap(candidate, cap), {
        keepErrorCount: ERROR_MESSAGE_KEEP,
        truncate: true,
      })
    ),
  ];

  for (const next of attempts) {
    // Forbid silent empty persist when input was non-empty
    if (hadMessages && next.messages.length === 0) continue;
    try {
      tryWriteThread(key, next);
      return { ok: true, thread: next };
    } catch (e) {
      if (isQuotaExceededError(e)) continue;
      // Non-quota write failures: do not masquerade as quota
      throw e;
    }
  }

  return { ok: false, reason: 'quota' };
}
