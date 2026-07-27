import { describe, expect, it } from 'vitest';
import {
  finalizeStaleInFlightProjectAgentThread,
  PROJECT_AGENT_STALE_INTERRUPTED_MESSAGE,
  type ProjectAgentThread,
} from '../services/projectAgent/threadStore';
import type { QuickComposeThreadMessage } from '../types/quickComposeThread';

function baseThread(messages: QuickComposeThreadMessage[]): ProjectAgentThread {
  return {
    id: 't1',
    workspaceProjectId: 'p1',
    createdAt: 1,
    updatedAt: 2,
    messages,
  };
}

describe('finalizeStaleInFlightProjectAgentThread', () => {
  it('marks in-flight assistant + childRuns terminal after reload', () => {
    const thread = baseThread([
      {
        id: 'u1',
        role: 'user',
        text: '狗',
        timestamp: 10,
      },
      {
        id: 'a1',
        role: 'assistant',
        text: '计划：文生图',
        timestamp: 11,
        status: 'running',
        childRuns: [
          {
            id: 'c1',
            kind: 'tool',
            label: '文生图',
            status: 'running',
            startedAt: 11,
          },
          {
            id: 'c0',
            kind: 'tool',
            label: '制定计划',
            status: 'done',
            startedAt: 10,
            endedAt: 10,
          },
        ],
      },
    ]);

    const { thread: next, changed } = finalizeStaleInFlightProjectAgentThread(thread);
    expect(changed).toBe(true);
    const a = next.messages[1]!;
    expect(a.status).toBe('error');
    expect(a.errorMessage).toBe(PROJECT_AGENT_STALE_INTERRUPTED_MESSAGE);
    expect(a.childRuns?.[0]?.status).toBe('cancelled');
    expect(a.childRuns?.[0]?.errorMessage).toBe(PROJECT_AGENT_STALE_INTERRUPTED_MESSAGE);
    expect(a.childRuns?.[1]?.status).toBe('done');
    expect(next.updatedAt).toBeGreaterThan(thread.updatedAt);
  });

  it('is a no-op when nothing is in flight', () => {
    const thread = baseThread([
      {
        id: 'a1',
        role: 'assistant',
        text: 'ok',
        timestamp: 11,
        status: 'done',
      },
    ]);
    const { thread: next, changed } = finalizeStaleInFlightProjectAgentThread(thread);
    expect(changed).toBe(false);
    expect(next).toBe(thread);
  });
});
