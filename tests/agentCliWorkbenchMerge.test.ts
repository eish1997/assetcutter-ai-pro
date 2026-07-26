import { describe, expect, it } from 'vitest';
import {
  agentCliProjectToWorkspaceProject,
  isAgentCliProjectId,
  mergeAgentCliProjectsIntoWorkspace,
} from '../services/agentCliPlatformAssets';

describe('agent-cli workbench project merge', () => {
  it('detects agent-cli project ids', () => {
    expect(isAgentCliProjectId('agp_abc')).toBe(true);
    expect(isAgentCliProjectId('uuid-local')).toBe(false);
  });

  it('merges CLI projects to the front of the workbench list', () => {
    const current = [
      { id: 'local-1', name: '本地项目', createdAt: 1 },
      { id: 'agp_old', name: '旧名', createdAt: 2 },
    ];
    const next = mergeAgentCliProjectsIntoWorkspace(current, [
      {
        id: 'agp_old',
        name: 'CLI验收测试项目',
        createdAt: '2026-07-26T01:00:00.000Z',
      },
      {
        id: 'agp_new',
        name: '新 CLI 项目',
        createdAt: '2026-07-26T02:00:00.000Z',
      },
    ]);
    expect(next.map((p) => p.id)).toEqual(['agp_old', 'agp_new', 'local-1']);
    expect(next[0].name).toBe('CLI验收测试项目');
    expect(next[0].source).toBe('agent-cli');
    expect(next[1].source).toBe('agent-cli');
    expect(agentCliProjectToWorkspaceProject({ id: 'agp_x', name: 'X', createdAt: '2026-01-01T00:00:00.000Z' }).source).toBe(
      'agent-cli',
    );
  });
});
