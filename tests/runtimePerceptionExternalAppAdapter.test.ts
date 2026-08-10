import { describe, expect, it } from 'vitest';
import {
  buildDisconnectedCompanionExternalApp,
  buildExternalAppCapabilities,
  buildExternalAppPerceptionRisks,
  buildRuntimeExternalAppsFromConnectionPackages,
} from '../services/runtimePerception/externalAppAdapter';
import { buildProjectAgentPerceptionContext } from '../services/runtimePerception/visibleSummary';
import { createRuntimePerceptionContextBus } from '../services/runtimePerception/contextBus';
import { buildRuntimeWorkspaceState } from '../services/runtimePerception/workbenchAdapter';
import { buildRuntimeWorkflowState } from '../services/runtimePerception/workflowAdapter';

describe('runtime perception external app adapter', () => {
  it('maps connected software capability packages without guessing host selection', () => {
    const apps = buildRuntimeExternalAppsFromConnectionPackages([
      {
        id: 'maya',
        type: 'software_connection',
        name: 'Maya',
        manifest: {
          appName: 'Maya',
          activeDocumentPath: 'C:\\Users\\demo\\scene\\hero.mb',
        },
        connectionState: {
          maturity: 'connected',
          label: 'Connected',
          availableActions: ['probe'],
          blockedReason: '',
          nextAction: 'Ready for read-only inspection',
        },
        lastProbe: {
          ok: true,
          at: '2026-08-10T08:00:00.000Z',
          result: { message: 'Maya heartbeat connected' },
        },
      },
    ]);

    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      appId: 'maya',
      name: 'Maya',
      connected: true,
      health: 'ok',
      selection: { kind: 'unknown', summary: 'selection unknown' },
    });
    expect(JSON.stringify(apps)).not.toContain('C:\\Users\\demo\\scene\\hero.mb');
  });

  it('exposes repair capability and risk for disconnected hosts', () => {
    const apps = buildRuntimeExternalAppsFromConnectionPackages([
      {
        id: 'spine',
        type: 'software_connection',
        name: 'Spine',
        connectionState: {
          maturity: 'template_missing',
          label: 'Template missing',
          blockedReason: 'No real probe template exists.',
          nextAction: 'Create a bridge template draft.',
        },
      },
    ]);
    const capabilities = buildExternalAppCapabilities(apps);
    const risks = buildExternalAppPerceptionRisks(apps);

    expect(apps[0].connected).toBe(false);
    expect(apps[0].selection.kind).toBe('unknown');
    expect(capabilities).toContainEqual(
      expect.objectContaining({
        id: 'external.spine.repair_connection',
        enabled: true,
        risk: 'light',
      })
    );
    expect(risks).toContainEqual(
      expect.objectContaining({
        id: 'external.spine.disconnected',
        level: 'block',
      })
    );
  });

  it('surfaces local companion outage in visible perception summary', () => {
    const companion = buildDisconnectedCompanionExternalApp('connect ECONNREFUSED 127.0.0.1:18765');
    const bus = createRuntimePerceptionContextBus({ now: () => 1000 });
    bus.updatePartial({
      workspace: buildRuntimeWorkspaceState({ projectName: 'Launch', activeSurface: 'workflow' }),
      workflow: buildRuntimeWorkflowState({}),
      externalApps: [companion],
      capabilities: buildExternalAppCapabilities([companion]),
      risks: buildExternalAppPerceptionRisks([companion]),
    });

    const context = buildProjectAgentPerceptionContext(bus.getSnapshot());
    expect(context.externalSummary).toContain('Local companion: disconnected');
    expect(context.riskSummary).toContain('Local companion is not connected');
    expect(context.capabilitySummary).toContain('Repair Local companion connection');
  });
});
