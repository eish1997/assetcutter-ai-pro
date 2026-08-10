import { describe, expect, it } from 'vitest';
import { createRuntimePerceptionContextBus } from '../services/runtimePerception/contextBus';
import { buildProjectAgentPerceptionContext } from '../services/runtimePerception/visibleSummary';
import { buildRuntimeWorkspaceState } from '../services/runtimePerception/workbenchAdapter';
import { buildRuntimeWorkflowState } from '../services/runtimePerception/workflowAdapter';
import { buildRuntimeExternalAppState } from '../services/runtimePerception/externalAppAdapter';

describe('runtime perception context bus', () => {
  it('keeps a sanitized bounded event stream', () => {
    let now = 1000;
    const bus = createRuntimePerceptionContextBus({
      now: () => now,
      eventLimit: 2,
    });

    bus.emitEvent({
      source: 'user',
      type: 'user.selection.changed',
      summary: 'selected asset sk-1234567890abcdef1234567890abcdef',
    });
    now += 1;
    bus.emitEvent({
      source: 'agent',
      type: 'agent.large.payload',
      summary: `payload data:image/png;base64,${'a'.repeat(120)}`,
    });
    now += 1;
    bus.emitEvent({
      source: 'workflow',
      type: 'workflow.step.failed',
      summary: 'failed at C:\\Users\\Demo\\Project\\secret\\file.png',
    });

    const events = bus.listRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0].summary).toContain('[local-path]');
    expect(events[1].summary).toContain('[omitted-base64]');
    expect(events.map((event) => event.summary).join('\n')).not.toContain('sk-1234567890');
  });

  it('updates snapshot freshness without mutating old event order', () => {
    let now = 5000;
    const bus = createRuntimePerceptionContextBus({ now: () => now });
    bus.updatePartial({
      workspace: buildRuntimeWorkspaceState({
        projectId: 'project-a',
        projectName: 'Campaign A',
        activeSurface: 'canvas',
        selectedAssetIds: ['asset-1', 'asset-2'],
      }),
    });
    bus.emitEvent({
      source: 'user',
      type: 'user.selection.changed',
      summary: 'Selected 2 assets',
    });

    now += 300;
    const snapshot = bus.getSnapshot();
    expect(snapshot.workspace.selectedAssetIds).toEqual(['asset-1', 'asset-2']);
    expect(snapshot.freshnessMs).toBe(300);
    expect(snapshot.recentEvents[0].type).toBe('user.selection.changed');
  });

  it('builds visible context from workspace, workflow and external apps', () => {
    const bus = createRuntimePerceptionContextBus({ now: () => 1000 });
    bus.updatePartial({
      workspace: buildRuntimeWorkspaceState({
        projectName: 'Product Launch',
        activeSurface: 'workflow',
        selectedAssetIds: ['a', 'b', 'c', 'd', 'e'],
      }),
      workflow: buildRuntimeWorkflowState({
        activePlanId: 'maya-export',
        steps: [
          { id: 'preflight', title: 'Preflight', status: 'done' },
          { id: 'export', title: 'Export FBX', status: 'blocked', errorMessage: 'Maya connector disconnected' },
        ],
        blockers: ['Maya connector disconnected'],
      }),
      externalApps: [
        buildRuntimeExternalAppState({
          appId: 'maya',
          name: 'Maya',
          connected: false,
          selection: { kind: 'unknown' },
        }),
      ],
    });

    const context = buildProjectAgentPerceptionContext(bus.getSnapshot());
    expect(context.visibleSummary).toContain('Product Launch');
    expect(context.targetSummary).toContain('Selected 5 assets');
    expect(context.workflowSummary).toContain('maya-export');
    expect(context.workflowSummary).toContain('Blocked');
    expect(context.externalSummary).toContain('Maya: disconnected');
    expect(context.externalSummary).toContain('selection unknown');
  });

  it('marks stale context when the snapshot is too old', () => {
    const snapshot = createRuntimePerceptionContextBus({
      now: () => 60_000,
      initialSnapshot: {
        capturedAt: 0,
        workspace: buildRuntimeWorkspaceState({ activeSurface: 'workspace' }),
      },
    }).getSnapshot();

    const context = buildProjectAgentPerceptionContext(snapshot, 30_000);
    expect(context.stale).toBe(true);
    expect(context.visibleSummary).toContain('Context may be stale');
  });
});
