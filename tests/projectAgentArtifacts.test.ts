/**
 * Phase 4D — Project Agent Artifacts + Promote (P1c).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as clientPersist from '../services/clientPersist';
import {
  __resetProjectAgentArtifactsForTests,
  emitProjectAgentArtifact,
  getProjectAgentArtifact,
  listProjectAgentArtifacts,
  tryRunArtifactAsPrompt,
} from '../services/projectAgent/artifacts';
import { promoteProjectAgentArtifact } from '../services/projectAgent/promote';
import * as capabilityPresetStore from '../services/capabilityPresetStore';
import type { CustomAppModule } from '../types';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

const key = { userId: 'u-art-1', workspaceProjectId: 'proj-art-1' };

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  __resetProjectAgentArtifactsForTests();
});

afterEach(() => {
  __resetProjectAgentArtifactsForTests();
  vi.restoreAllMocks();
});

describe('projectAgent artifacts store', () => {
  it('emit → get → list round-trip', () => {
    const id = emitProjectAgentArtifact(key, {
      kind: 'prompt_draft',
      text: 'Rewrite this as a cinematic shot list.',
      meta: { label: 'Shot list' },
      expertId: 'prompt_smith',
      sourceTurnId: 'turn-1',
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');

    const got = getProjectAgentArtifact(key, id);
    expect(got).not.toBeNull();
    expect(got?.id).toBe(id);
    expect(got?.kind).toBe('prompt_draft');
    expect(got?.text).toBe('Rewrite this as a cinematic shot list.');
    expect(got?.workspaceProjectId).toBe('proj-art-1');
    expect(got?.expertId).toBe('prompt_smith');
    expect(got?.sourceTurnId).toBe('turn-1');
    expect(typeof got?.createdAt).toBe('number');

    const listed = listProjectAgentArtifacts(key);
    expect(listed.some((a) => a.id === id)).toBe(true);
  });

  it('stores no base64 / data-URL fields in meta', () => {
    const id = emitProjectAgentArtifact(key, {
      kind: 'text',
      text: 'clean prompt',
      meta: {
        label: 'ok',
        previewImage: 'data:image/png;base64,iVBORw0KGgo=',
        base64: 'AAAA',
        nested: { dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' },
      },
    });
    const got = getProjectAgentArtifact(key, id);
    expect(got?.meta?.label).toBe('ok');
    expect(got?.meta).not.toHaveProperty('previewImage');
    expect(got?.meta).not.toHaveProperty('base64');
    const raw = JSON.stringify(got);
    expect(raw.toLowerCase()).not.toContain('base64');
    expect(raw).not.toMatch(/data:image\/[^;]+;base64,/i);
  });

  it('tryRunArtifactAsPrompt returns quick-compose text', () => {
    const id = emitProjectAgentArtifact(key, {
      kind: 'prompt_draft',
      text: '  try me on canvas  ',
    });
    const result = tryRunArtifactAsPrompt(key, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('try me on canvas');
    expect(result.artifactId).toBe(id);
  });

  it('tryRunArtifactAsPrompt fails for missing id', () => {
    const result = tryRunArtifactAsPrompt(key, 'missing');
    expect(result).toEqual({ ok: false, errorMessage: 'artifact_not_found' });
  });
});

describe('promoteProjectAgentArtifact', () => {
  it('promotes artifact text to capability_preset via saveCapabilityPresets', async () => {
    const id = emitProjectAgentArtifact(key, {
      kind: 'prompt_draft',
      text: 'Always keep character consistency across shots.',
      meta: { label: 'Consistency rule', category: 'text_to_text' },
    });

    const existing: CustomAppModule[] = [
      {
        id: 'seed',
        label: 'Seed',
        category: 'text_to_text',
        instruction: 'seed',
        engine: 'gen_text',
        enabled: true,
        order: 0,
      },
    ];
    const loadSpy = vi.spyOn(capabilityPresetStore, 'loadCapabilityPresets').mockReturnValue(existing);
    const saveSpy = vi.spyOn(capabilityPresetStore, 'saveCapabilityPresets').mockImplementation(() => {});

    const result = await promoteProjectAgentArtifact(
      key,
      id,
      {
        targetKind: 'capability_preset',
        name: 'My Consistency Preset',
      },
      { confirmed: true }
    );

    expect(result.ok).toBe(true);
    expect(result.presetId).toBeTruthy();
    expect(loadSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0]?.[0] as CustomAppModule[];
    expect(saved).toHaveLength(2);
    const created = saved.find((p) => p.id === result.presetId);
    expect(created?.label).toBe('My Consistency Preset');
    expect(created?.instruction).toBe('Always keep character consistency across shots.');
    expect(created?.category).toBe('text_to_text');
    expect(JSON.stringify(created).toLowerCase()).not.toContain('base64');
  });

  it('returns ok:false when artifact missing', async () => {
    const result = await promoteProjectAgentArtifact(
      key,
      'nope',
      {
        targetKind: 'capability_preset',
      },
      { confirmed: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('artifact_not_found');
  });

  it('returns ok:false without confirmed:true gate', async () => {
    const id = emitProjectAgentArtifact(key, { kind: 'text', text: 'x' });
    const result = await promoteProjectAgentArtifact(key, id, {
      targetKind: 'capability_preset',
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('promote_requires_confirm');
  });

  it('returns ok:false for unsupported targetKind', async () => {
    const id = emitProjectAgentArtifact(key, { kind: 'text', text: 'x' });
    const result = await promoteProjectAgentArtifact(
      key,
      id,
      {
        targetKind: 'not_a_preset' as 'capability_preset',
      },
      { confirmed: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('unsupported_target_kind');
  });

  it('returns structured ok:false when save throws', async () => {
    const id = emitProjectAgentArtifact(key, { kind: 'text', text: 'hello' });
    vi.spyOn(capabilityPresetStore, 'loadCapabilityPresets').mockReturnValue([]);
    vi.spyOn(capabilityPresetStore, 'saveCapabilityPresets').mockImplementation(() => {
      throw new Error('disk_full');
    });
    const result = await promoteProjectAgentArtifact(
      key,
      id,
      { targetKind: 'capability_preset' },
      { confirmed: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('disk_full');
  });
});

describe('artifacts persistence key', () => {
  it('writes via clientPersist scoped key (userId + workspaceProjectId)', () => {
    const writeSpy = vi.spyOn(clientPersist, 'writeLocalJson');
    emitProjectAgentArtifact(key, { kind: 'text', text: 'persist me' });
    expect(writeSpy).toHaveBeenCalled();
    const storageKey = String(writeSpy.mock.calls[0]?.[0] ?? '');
    expect(storageKey).toContain('ac_project_agent_artifacts_v1');
    expect(storageKey).toContain('u-art-1');
    expect(storageKey).toContain('proj-art-1');
  });
});
