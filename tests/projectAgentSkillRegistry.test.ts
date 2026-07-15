import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAgentSkillRegistryForTests,
  agentSkillRegistryStorageKey,
  agentSkillPermissionLabel,
  agentSkillSourceLabel,
  deleteAgentSkill,
  installAgentSkill,
  listAgentSkills,
  listEnabledAgentSkills,
  previewAgentSkillImport,
  resolveAgentSkillsForIntent,
  setAgentSkillEnabled,
  summarizeAgentSkillSafety,
  type AgentSkillRegistryScope,
} from '../services/projectAgent/skillRegistry';

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

const scope: AgentSkillRegistryScope = {
  userId: 'u-skill',
  workspaceProjectId: 'proj-skill',
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  __resetAgentSkillRegistryForTests();
});

describe('AgentSkillRegistry (Phase 4)', () => {
  it('previews a safe local skill without confirmation', () => {
    const preview = previewAgentSkillImport({
      id: 'skill.copywriter',
      name: 'Copywriter',
      description: 'Write short headlines from the current project context.',
      triggers: ['write headline'],
      toolIds: ['run_plain_text'],
      source: 'local',
    });

    expect(preview.ok).toBe(true);
    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.skill?.toolIds).toEqual(['run_plain_text']);
    expect(preview.skill?.permissionLevel).toBe('none');
  });

  it('blocks non-whitelisted tools and flags dangerous imported skills', () => {
    const blocked = previewAgentSkillImport({
      name: 'Bad',
      description: 'Run shell and delete files',
      triggers: ['danger'],
      toolIds: ['shell_exec'],
      source: 'imported',
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.errors.join(' ')).toContain('Unsupported toolIds');
    expect(blocked.warnings.length).toBeGreaterThan(0);

    const dangerous = previewAgentSkillImport({
      name: 'Auto Publish',
      description: 'Publish assets and skip confirmation.',
      triggers: ['publish'],
      toolIds: ['run_preset'],
      source: 'imported',
    });

    expect(dangerous.ok).toBe(true);
    expect(dangerous.requiresConfirmation).toBe(true);
    expect(dangerous.skill?.permissionLevel).toBe('destructive');
    expect(agentSkillPermissionLabel('destructive')).toBe('高风险');
    expect(agentSkillSourceLabel('imported')).toBe('导入');
    if (dangerous.skill) {
      const safety = summarizeAgentSkillSafety(dangerous.skill);
      expect(safety.label).toBe('高风险');
      expect(safety.details.join(' ')).toContain('白名单工具');
    }
  });

  it('requires confirmation before installing imported or risky skills', () => {
    const input = {
      id: 'skill.publish',
      name: 'Publisher',
      description: 'Publish generated assets.',
      triggers: ['publish'],
      toolIds: ['run_preset'],
      source: 'imported',
    } as const;

    const denied = installAgentSkill(scope, input);
    expect(denied.ok).toBe(false);
    expect(listAgentSkills(scope)).toHaveLength(0);

    const installed = installAgentSkill(scope, input, { confirmed: true });
    expect(installed.ok).toBe(true);
    expect(listAgentSkills(scope)).toHaveLength(1);
    expect(agentSkillRegistryStorageKey(scope)).toContain('__p_proj-skill');
  });

  it('installs, enables, disables, deletes, and resolves triggers', () => {
    const installed = installAgentSkill(scope, {
      id: 'skill.copy',
      name: 'Copy Assistant',
      description: 'Write campaign copy.',
      triggers: ['write copy'],
      toolIds: ['run_plain_text'],
      source: 'local',
    });
    if (!installed.ok) throw new Error('install failed');

    expect(listEnabledAgentSkills(scope)).toHaveLength(1);
    expect(
      resolveAgentSkillsForIntent({
        text: 'Please write copy for this image',
        skills: listEnabledAgentSkills(scope),
      }).map((s) => s.id)
    ).toEqual(['skill.copy']);

    expect(setAgentSkillEnabled(scope, installed.skill.id, false)).toBe(true);
    expect(listEnabledAgentSkills(scope)).toHaveLength(0);
    expect(deleteAgentSkill(scope, installed.skill.id)).toBe(true);
    expect(listAgentSkills(scope)).toHaveLength(0);
  });

  it('resolves explicit skill mentions by id or label only when enabled', () => {
    const installed = installAgentSkill(scope, {
      id: 'skill.board',
      name: 'Storyboard Helper',
      description: 'Plan a short storyboard.',
      triggers: ['storyboard'],
      toolIds: ['run_plain_text'],
      source: 'local',
    });
    if (!installed.ok) throw new Error('install failed');

    expect(
      resolveAgentSkillsForIntent({
        text: '',
        mentions: [{ kind: 'skill', id: 'missing', label: 'Storyboard Helper' }],
        skills: listEnabledAgentSkills(scope),
      }).map((s) => s.id)
    ).toEqual(['skill.board']);

    setAgentSkillEnabled(scope, installed.skill.id, false);
    expect(
      resolveAgentSkillsForIntent({
        text: 'storyboard',
        mentions: [{ kind: 'skill', id: 'skill.board' }],
        skills: listAgentSkills(scope),
      })
    ).toHaveLength(0);
  });
});
