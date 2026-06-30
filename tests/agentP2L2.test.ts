import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createAgentStore } = require('../companion-desktop/agent-store.cjs');
const { createAgentSessionService } = require('../companion-desktop/agent-session/index.cjs');

function createEchoBrain(id: string, prefix: string) {
  return {
    id,
    displayName: id,
    probe: async () => ({ ok: true, detail: id }),
    async *streamTurn(input: { signal?: AbortSignal }) {
      if (input.signal?.aborted) {
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }
      const messages = input.messages || [];
      const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
      const text = lastUser?.content || '';
      yield { type: 'text_delta', text: `${prefix}:${text}` };
      yield { type: 'done', stopReason: 'stop' };
    },
  };
}

function readContextSnapshot(storeRoot: string, sessionId: string) {
  const file = path.join(storeRoot, 'sessions', sessionId, 'context-snapshot.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('agent P2 body host concurrency', () => {
  it('serializes concurrent executeTool calls', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    let active = 0;
    let maxActive = 0;
    const host = createAgentBodyHost({
      getShellView: () => 'home',
      navigateShell: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 25));
        active -= 1;
        return { ok: true };
      },
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
    });
    await Promise.all([
      host.executeTool('ac.shell.navigate', { view: 'home' }, {}),
      host.executeTool('ac.shell.navigate', { view: 'home' }, {}),
    ]);
    expect(maxActive).toBe(1);
  });
});

describe('agent P2 L2 cross-brain continuity', () => {
  it('keeps session messages and updates context snapshot after brain switch', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-l2-'));
    const store = createAgentStore({ getRoot: () => tmp });
    store.ensureLayout();

    const brainA = createEchoBrain('brain_a', 'A');
    const brainB = createEchoBrain('brain_b', 'B');
    let activeBrain = brainA;

    const bodyHost = {
      listTools: async () => [],
      executeTool: async () => ({ ok: true, content: '{}' }),
    };

    const session = createAgentSessionService({
      store,
      bodyHost,
      getBrain: () => activeBrain,
      getShellView: () => 'home',
      gateTool: () => 'allow',
      onEvent: () => {},
    });

    const sessionId = store.getOrCreateDefaultSessionId();

    const r1 = await session.sendUserMessage('first turn');
    expect(r1.ok).toBe(true);
    expect(session.getBrainId()).toBe('brain_a');

    let messages = session.listMessages(sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].meta.brainId).toBe('brain_a');
    expect(messages[1].content).toContain('A:first turn');

    let snap = readContextSnapshot(tmp, sessionId);
    expect(snap.brainId).toBe('brain_a');
    expect(snap.messageCount).toBe(2);
    expect(snap.schemaVersion).toBe(1);

    activeBrain = brainB;
    store.writeSettings({ defaultBrainId: 'brain_b' });

    const r2 = await session.sendUserMessage('second turn');
    expect(r2.ok).toBe(true);
    expect(session.getBrainId()).toBe('brain_b');

    messages = session.listMessages(sessionId);
    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('second turn');
    expect(messages[3].role).toBe('assistant');
    expect(messages[3].meta.brainId).toBe('brain_b');
    expect(messages[3].content).toContain('B:second turn');

    snap = readContextSnapshot(tmp, sessionId);
    expect(snap.brainId).toBe('brain_b');
    expect(snap.messageCount).toBe(4);
  });

  it('profile system prompt includes seeded skills after layout init', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-profile-'));
    const store = createAgentStore({ getRoot: () => tmp });
    store.ensureLayout();
    const prompt = store.readProfileSystemPrompt();
    expect(prompt).toContain('navigate-scripts');
  });
});
