/**
 * Phase 3D — project Agent local quota trim (§17.10 / §18.6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as clientPersist from '../services/clientPersist';
import {
  estimateProjectAgentThreadBytes,
  saveProjectAgentThreadGuarded,
  trimProjectAgentThreadForQuota,
} from '../services/projectAgent/persist/quotas';
import {
  PROJECT_AGENT_THREAD_MAX_MESSAGES,
  type ProjectAgentThread,
} from '../services/projectAgent/threadStore';
import type { QuickComposeThreadMessage } from '../types/quickComposeThread';

function makeMessage(
  i: number,
  overrides?: Partial<QuickComposeThreadMessage>
): QuickComposeThreadMessage {
  return {
    id: `m-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `message-${i}-${'x'.repeat(200)}`,
    timestamp: 1_700_000_000_000 + i,
    status: i % 2 === 0 ? 'submitted' : 'done',
    resultText: `result-${i}-${'y'.repeat(400)}`,
    taskAssetById: { [`t-${i}`]: `a-${i}` },
    errorMessage: i % 7 === 0 ? `err-${i}-${'z'.repeat(80)}` : undefined,
    ...overrides,
  };
}

function makeThread(messageCount: number): ProjectAgentThread {
  return {
    id: 'thread-1',
    workspaceProjectId: 'proj-1',
    messages: Array.from({ length: messageCount }, (_, i) => makeMessage(i)),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

const storeKey = { userId: 'u1', workspaceProjectId: 'proj-1' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('estimateProjectAgentThreadBytes / trimProjectAgentThreadForQuota', () => {
  it('trims oversized messages to hot window and reduces estimated bytes', () => {
    const huge = makeThread(PROJECT_AGENT_THREAD_MAX_MESSAGES + 40);
    const before = estimateProjectAgentThreadBytes(huge);
    const trimmed = trimProjectAgentThreadForQuota(huge);
    const after = estimateProjectAgentThreadBytes(trimmed);

    expect(trimmed.messages).toHaveLength(PROJECT_AGENT_THREAD_MAX_MESSAGES);
    expect(trimmed.messages[0]?.id).toBe(`m-${40}`);
    expect(after).toBeLessThan(before);
  });

  it('is a no-op on message count when already within hot window', () => {
    const small = makeThread(10);
    const trimmed = trimProjectAgentThreadForQuota(small);
    expect(trimmed.messages).toHaveLength(10);
    expect(estimateProjectAgentThreadBytes(trimmed)).toBe(estimateProjectAgentThreadBytes(small));
  });
});

describe('saveProjectAgentThreadGuarded', () => {
  it('returns ok with the written thread when write succeeds', () => {
    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation(() => {});
    const thread = makeThread(5);
    const result = saveProjectAgentThreadGuarded(storeKey, thread);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.thread.messages).toHaveLength(5);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const raw = writeSpy.mock.calls[0]?.[1] ?? '';
    const parsed = JSON.parse(raw) as { version: number; messages: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.messages).toHaveLength(5);
  });

  it('returns { ok:false, reason:quota } when every attempt hits QuotaExceeded', () => {
    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const thread = makeThread(PROJECT_AGENT_THREAD_MAX_MESSAGES + 10);
    const result = saveProjectAgentThreadGuarded(storeKey, thread);
    expect(result).toEqual({ ok: false, reason: 'quota' });
    expect(writeSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('retries with a slimmer payload after QuotaExceeded and then succeeds with shorter thread', () => {
    let calls = 0;
    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation((_k, raw) => {
      calls += 1;
      const parsed = JSON.parse(raw) as {
        messages: Array<{ resultText?: string; errorMessage?: string }>;
      };
      // Fail until aggressive cap of 5 messages
      if (parsed.messages.length > 5) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      expect(parsed.messages.every((m) => m.resultText === undefined)).toBe(true);
    });

    const thread = makeThread(20);
    const result = saveProjectAgentThreadGuarded(storeKey, thread);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.thread.messages.length).toBeLessThan(20);
    expect(result.thread.messages.length).toBeLessThanOrEqual(5);
    expect(result.thread.messages.length).toBeGreaterThan(0);
    expect(writeSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not throw QuotaExceeded to the caller', () => {
    vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(() => saveProjectAgentThreadGuarded(storeKey, makeThread(3))).not.toThrow();
  });

  it('never returns ok with empty messages when input was non-empty', () => {
    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation((_k, raw) => {
      const parsed = JSON.parse(raw) as { messages: unknown[] };
      // Reject every non-empty write; if empty were attempted it would "succeed"
      if (parsed.messages.length > 0) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
    });

    const thread = makeThread(8);
    const result = saveProjectAgentThreadGuarded(storeKey, thread);
    expect(result).toEqual({ ok: false, reason: 'quota' });
    // No successful empty write — every call that reached write still had messages, or we skipped empty
    for (const call of writeSpy.mock.calls) {
      const parsed = JSON.parse(call[1] ?? '') as { messages: unknown[] };
      expect(parsed.messages.length).toBeGreaterThan(0);
    }
  });
});
