import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { runMayaExportWorkflow } from '../local-companion/src/workflows/runtime/workflowExecution.js';
import { createMayaConnectorToolBridgeClient } from '../local-companion/src/workflows/runtime/workflowToolBridgeHttpClient.js';
import { preflightWorkflowCapability, runWorkflowCapability } from '../local-companion/src/workflows/runWorkflowCapability.js';
import { listWorkflowRuns } from '../local-companion/src/workflows/runtime/workflowRunHistory.js';
import { runWorkflowFixtureSuite } from '../local-companion/src/workflows/runtime/workflowFixtureRunner.js';
import { getWorkflowSkill, listWorkflowSkills } from '../local-companion/src/workflows/runtime/workflowSkills.js';

const input = {
  file_name: 'hero',
  output_dir: 'project://exports',
  overwrite: false,
};

const connectedStatus = {
  mode: 'fixture',
  selectionCount: 1,
  state: 'connected' as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local companion workflow runtime', () => {
  it('keeps WorkflowSkill registry canonical while resolving legacy ScriptHub alias', () => {
    const skills = listWorkflowSkills();
    expect(skills.map((skill) => skill.id)).toContain('workflow.maya.export_selection_fbx');
    expect(skills.map((skill) => skill.id)).not.toContain('scriptHub.maya.export_selection_fbx');
    expect(getWorkflowSkill('workflow.maya.export_selection_fbx')).toBe(getWorkflowSkill('scriptHub.maya.export_selection_fbx'));
    expect(getWorkflowSkill('workflow.maya.export_selection_fbx')).toMatchObject({
      legacyIds: ['scriptHub.maya.export_selection_fbx'],
      systemContract: {
        requiredConnectors: [expect.objectContaining({
          capabilityPackageId: 'maya',
          kind: 'software_connection',
        })],
      },
    });
  });

  it('stops before execution and exposes RepairAction when Maya selection is empty', async () => {
    const client = {
      callTool: vi.fn(),
    };

    const run = await runMayaExportWorkflow(input, {
      client,
      connectorStatus: {
        mode: 'fixture',
        selectionCount: 0,
        state: 'connected',
      },
      now: '2026-08-10T14:01:00.000Z',
      runId: 'run_preflight_failed',
    });

    expect(client.callTool).not.toHaveBeenCalled();
    expect(run.status).toBe('preflight_failed');
    expect(run.repair_action_ids).toEqual(['select_maya_objects']);
    expect(run.repair_actions[0]).toMatchObject({
      actionLayer: 'user_confirmation',
      id: 'select_maya_objects',
    });
  });

  it('runs Maya FBX export through the in-process connector client and records artifact plus replay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        data: {
          bytes: 512,
          exported_at: '2026-08-10T14:00:02.000Z',
          local_path: 'F:/exports/hero.fbx',
          selection_count: 1,
          storage_uri: 'project://exports/hero.fbx',
          trace_id: 'trace_success',
        },
      })),
    }));

    const run = await runMayaExportWorkflow(input, {
      checkOutputExists: vi.fn().mockResolvedValue(false),
      client: createMayaConnectorToolBridgeClient('http://maya.local'),
      connectorStatus: connectedStatus,
      now: '2026-08-10T14:00:00.000Z',
      runId: 'run_success',
      traceId: 'trace_success',
    });

    expect(fetch).toHaveBeenCalledWith('http://maya.local/export/fbx', expect.objectContaining({
      method: 'POST',
    }));
    expect(run.status).toBe('succeeded');
    expect(run.step_runs[0].tool_call_id).toMatch(/^tc_/);
    expect(run.artifacts[0]).toMatchObject({
      metadata: {
        bytes: 512,
      },
      uri: 'project://exports/hero.fbx',
    });
    expect(run.replay_snapshot_id).toBe('replay_run_success');
  });

  it('runs the migrated workflow capability wrapper through local Workflow runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-history-'));
    const historyPath = join(dir, 'workflow-runs.json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        data: {
          bytes: 128,
          local_path: 'F:/exports/capability.fbx',
          selection_count: 1,
          storage_uri: 'project://exports/capability.fbx',
        },
      })),
    }));

    const result = await runWorkflowCapability({
      baseUrl: 'http://maya.local',
      checkOutputExists: vi.fn().mockResolvedValue(false),
      connectorStatus: connectedStatus,
      params: {
        file_name: 'capability',
        output_dir: 'project://exports',
        overwrite: false,
      },
      runId: 'run_capability',
      reusedFromRunId: 'run_source',
      workflowId: 'workflow.maya.export_selection_fbx',
      historyPath,
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      replay_snapshot_id: 'replay_run_capability',
      status: 'succeeded',
    });
    expect(listWorkflowRuns(historyPath)).toHaveLength(1);
    expect(listWorkflowRuns(historyPath)[0]).toMatchObject({
      id: 'run_capability',
      reused_from_run_id: 'run_source',
      status: 'succeeded',
      workflow_id: 'workflow.maya.export_selection_fbx',
    });
    rmSync(dir, { force: true, recursive: true });
  });

  it('runs the legacy ScriptHub alias through the canonical Workflow runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-legacy-'));
    const historyPath = join(dir, 'workflow-runs.json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        data: {
          bytes: 64,
          local_path: 'F:/exports/legacy.fbx',
          selection_count: 1,
          storage_uri: 'project://exports/legacy.fbx',
        },
      })),
    }));

    const result = await runWorkflowCapability({
      baseUrl: 'http://maya.local',
      checkOutputExists: vi.fn().mockResolvedValue(false),
      connectorStatus: connectedStatus,
      params: {
        file_name: 'legacy',
        output_dir: 'project://exports',
        overwrite: false,
      },
      runId: 'run_legacy_alias',
      historyPath,
      workflowId: 'scriptHub.maya.export_selection_fbx',
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      status: 'succeeded',
      workflow_id: 'workflow.maya.export_selection_fbx',
    });
    rmSync(dir, { force: true, recursive: true });
  });

  it('checks workflow preflight without executing or writing run history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-preflight-'));
    const historyPath = join(dir, 'workflow-runs.json');

    const result = await preflightWorkflowCapability({
      connectorStatus: {
        mode: 'fixture',
        selectionCount: 0,
        state: 'connected',
      },
      historyPath,
      params: input,
      runId: 'run_preflight_only',
      workflowId: 'workflow.maya.export_selection_fbx',
    });

    expect(result.ok).toBe(true);
    expect(result.preflight).toMatchObject({
      status: 'failed',
      workflow_id: 'workflow.maya.export_selection_fbx',
    });
    expect(result.preflight.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        check_id: 'maya_selection_non_empty',
        repair_action_id: 'select_maya_objects',
        status: 'failed',
      }),
    ]));
    expect(result.preflight.repair_actions[0]).toMatchObject({
      id: 'select_maya_objects',
      title: '选择 Maya 对象',
    });
    expect(listWorkflowRuns(historyPath)).toEqual([]);
    rmSync(dir, { force: true, recursive: true });
  });

  it('runs repeatable Workflow fixture cases without requiring real Maya', async () => {
    const cases = await runWorkflowFixtureSuite();
    const byId = new Map(cases.map((item) => [item.id, item.run]));

    expect([...byId.keys()]).toEqual([
      'maya_fbx_success',
      'maya_fbx_preflight_failed',
      'maya_fbx_execution_failed',
      'maya_fbx_artifact_missing',
    ]);
    expect(byId.get('maya_fbx_success')).toMatchObject({
      status: 'succeeded',
      replay_snapshot_id: 'replay_fixture_maya_fbx_success',
    });
    expect(byId.get('maya_fbx_success')?.artifacts[0]).toMatchObject({
      local_path: undefined,
      status: 'created',
      uri: 'project://exports/fixture_asset.fbx',
    });
    expect(byId.get('maya_fbx_preflight_failed')).toMatchObject({
      repair_action_ids: ['select_maya_objects'],
      status: 'preflight_failed',
    });
    expect(byId.get('maya_fbx_execution_failed')).toMatchObject({
      error: {
        code: 'maya_command_timeout',
      },
      status: 'failed',
    });
    expect(byId.get('maya_fbx_artifact_missing')?.artifacts[0]).toMatchObject({
      id: 'artifact_fixture_missing',
      status: 'missing',
    });
  });
});
