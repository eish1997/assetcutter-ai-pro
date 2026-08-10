import { describe, expect, it } from 'vitest';
import type { RuntimePerceptionSnapshot } from '../types/runtimePerception';
import { buildRuntimeExternalAppState } from '../services/runtimePerception/externalAppAdapter';
import { buildRuntimeWorkflowState } from '../services/runtimePerception/workflowAdapter';
import { buildRuntimeWorkspaceState } from '../services/runtimePerception/workbenchAdapter';

describe('runtime perception type builders', () => {
  it('creates a media-free snapshot shape', () => {
    const snapshot: RuntimePerceptionSnapshot = {
      version: 1,
      capturedAt: 1,
      freshnessMs: 0,
      workspace: buildRuntimeWorkspaceState({
        projectId: 'p',
        activeSurface: 'lightbox',
        activeAssetId: 'asset-a',
        selectedAssetIds: ['asset-a'],
      }),
      workflow: buildRuntimeWorkflowState({
        steps: [{ id: 's1', title: 'Check', status: 'running', taskIds: ['task-a'] }],
      }),
      externalApps: [
        buildRuntimeExternalAppState({
          appId: 'maya',
          name: 'Maya',
          connected: true,
          activeDocumentPath: 'C:\\Users\\demo\\project\\scene.mb',
          selection: { kind: 'mesh', count: 3 },
        }),
      ],
      capabilities: [],
      recentEvents: [],
      risks: [],
    };

    expect(snapshot.workspace.activeSurface).toBe('lightbox');
    expect(snapshot.workflow.hasPlan).toBe(true);
    expect(snapshot.externalApps[0].selection.kind).toBe('mesh');
    expect(JSON.stringify(snapshot)).not.toContain('base64');
    expect(JSON.stringify(snapshot)).not.toContain('C:\\Users\\demo\\project\\scene.mb');
  });
});
