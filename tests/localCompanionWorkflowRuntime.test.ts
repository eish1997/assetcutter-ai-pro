import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createCapabilityPackageDraft,
  updateCapabilityPackageDraft,
} from '../local-companion/src/capabilities/capabilityPackageStore.js';
import { runMayaExportWorkflow } from '../local-companion/src/workflows/runtime/workflowExecution.js';
import { createMayaConnectorToolBridgeClient } from '../local-companion/src/workflows/runtime/workflowToolBridgeHttpClient.js';
import { preflightWorkflowCapability, runWorkflowCapability } from '../local-companion/src/workflows/runWorkflowCapability.js';
import { listWorkflowRuns } from '../local-companion/src/workflows/runtime/workflowRunHistory.js';
import { createWorkflowRun } from '../local-companion/src/workflows/runtime/workflowRuns.js';
import { runWorkflowFixtureSuite } from '../local-companion/src/workflows/runtime/workflowFixtureRunner.js';
import { getWorkflowSkill, listWorkflowSkills } from '../local-companion/src/workflows/runtime/workflowSkills.js';
import {
  createWorkflowDefinitionFromSkill,
  createWorkflowDraftFromSkill,
  createWorkflowRunObject,
} from '../local-companion/src/workflows/workflowObjects.js';
import {
  loadWorkflowObjectStore,
  upsertWorkflowDefinition,
  upsertWorkflowDraft,
  upsertWorkflowPin,
  upsertWorkflowVersion,
} from '../local-companion/src/workflows/workflowObjectStore.js';
import {
  archiveWorkflowDraft,
  createWorkflowDraft,
  getWorkflowDraft,
  listWorkflowDrafts,
  publishWorkflowDraftVersion,
  rollbackWorkflowDefaultVersion,
  saveWorkflowRunAsDraft,
  testRunWorkflowDraft,
  updateWorkflowDraft,
} from '../local-companion/src/workflows/workflowDrafts.js';
import {
  createWorkflowRepairSession,
  getWorkflowRepairSession,
  selectWorkflowRepairScope,
} from '../local-companion/src/workflows/workflowRepairSessions.js';
import {
  createWorkflowPin,
  deleteWorkflowPin,
  listWorkflowPins,
} from '../local-companion/src/workflows/workflowPins.js';

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

  it('starts the object store as an empty Workflow library with no migrated definitions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-objects-empty-'));
    const storePath = join(dir, 'workflow-objects.json');

    expect(loadWorkflowObjectStore(storePath)).toMatchObject({
      definitions: [],
      drafts: [],
      pins: [],
      schema_version: 1,
      versions: [],
    });

    rmSync(dir, { force: true, recursive: true });
  });

  it('stores Workflow definitions, versions, drafts, and pins separately from temporary runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-objects-'));
    const storePath = join(dir, 'workflow-objects.json');
    const skill = getWorkflowSkill('workflow.maya.export_selection_fbx');
    expect(skill).toBeDefined();
    const { definition, version } = createWorkflowDefinitionFromSkill({
      createdAt: '2026-08-11T08:00:00.000Z',
      skill: skill!,
      tags: ['maya', 'fbx'],
    });
    const draft = createWorkflowDraftFromSkill({
      createdAt: '2026-08-11T08:05:00.000Z',
      id: 'draft_from_successful_run',
      skill: skill!,
      source: { kind: 'run', run_id: 'run_success' },
    });
    const temporaryRun = createWorkflowRun({
      id: 'run_temporary_export',
      input,
      now: '2026-08-11T08:10:00.000Z',
      workflow: skill!,
    });

    upsertWorkflowDefinition(definition, storePath);
    upsertWorkflowVersion(version, storePath);
    upsertWorkflowDraft(draft, storePath);
    upsertWorkflowPin({
      created_at: '2026-08-11T08:15:00.000Z',
      id: 'pin_home_export_selection',
      scope: { kind: 'home' },
      sort_order: 10,
      version_policy: { kind: 'follow_default' },
      workflow_id: definition.id,
    }, storePath);

    const stored = loadWorkflowObjectStore(storePath);
    expect(stored.definitions).toHaveLength(1);
    expect(stored.definitions[0]).toMatchObject({
      current_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
      id: 'workflow.maya.export_selection_fbx',
      lifecycle: 'validated',
    });
    expect(stored.versions[0]).toMatchObject({
      id: 'workflow.maya.export_selection_fbx@0.1.0',
      validation: {
        status: 'real_software_validated',
      },
      workflow_id: definition.id,
    });
    expect(stored.drafts[0]).toMatchObject({
      id: 'draft_from_successful_run',
      source: { kind: 'run', run_id: 'run_success' },
      status: 'draft',
    });
    expect(stored.pins[0]).toMatchObject({
      id: 'pin_home_export_selection',
      version_policy: { kind: 'follow_default' },
      workflow_id: definition.id,
    });

    const runObject = createWorkflowRunObject({ run: temporaryRun });
    expect(runObject).toMatchObject({
      id: 'run_temporary_export',
      temporary: true,
      workflow_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
      workflow_definition_id: undefined,
    });
    expect(loadWorkflowObjectStore(storePath).definitions.map((item) => item.id)).not.toContain(runObject.id);

    rmSync(dir, { force: true, recursive: true });
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

  it('classifies existing output as a recoverable overwrite or rename repair', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({
        ok: false,
        error: {
          message: 'Output already exists: project://exports/hero.fbx',
        },
      })),
    }));

    const run = await runMayaExportWorkflow(input, {
      checkOutputExists: vi.fn().mockResolvedValue(false),
      client: createMayaConnectorToolBridgeClient('http://maya.local'),
      connectorStatus: connectedStatus,
      now: '2026-08-10T14:00:00.000Z',
      runId: 'run_output_exists',
    });

    expect(run.status).toBe('failed');
    expect(run.error).toMatchObject({
      code: 'output_exists',
      message: 'Output already exists: project://exports/hero.fbx',
      recoverable: true,
    });
    expect(run.repair_action_ids).toEqual(['confirm_overwrite_or_rename']);
    expect(run.repair_actions[0]).toMatchObject({
      actionType: 'confirm',
      suggestedInputPatch: { overwrite: true },
    });
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
      workflow_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
    });
    rmSync(dir, { force: true, recursive: true });
  });

  it('uses the connected Maya Command Port by default when no connector URL is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-command-port-'));
    const historyPath = join(dir, 'workflow-runs.json');
    const oldHost = process.env.COMPANION_MAYA_HOST;
    const oldPort = process.env.COMPANION_MAYA_PORT;
    const oldSandbox = process.env.COMPANION_SANDBOX_ROOT;
    process.env.COMPANION_SANDBOX_ROOT = dir;
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        const text = String(chunk);
        const resultPath = text.match(/open\(r'([^']*assetcutter-workflow-maya-result-[^']+\.json)'\)/)?.[1];
        if (!resultPath) {
          socket.end('{}');
          return;
        }
        writeFileSync(resultPath, JSON.stringify({
          ok: true,
          bytes: 768,
          exported_at: '2026-08-12T10:00:00.000Z',
          local_path: 'F:/exports/command-port.fbx',
          selected_objects: ['|pCube1'],
          selection_count: 1,
        }), 'utf8');
        socket.end(JSON.stringify({
          ok: true,
          bytes: 768,
          exported_at: '2026-08-12T10:00:00.000Z',
          local_path: 'F:/exports/command-port.fbx',
          selected_objects: ['|pCube1'],
          selection_count: 1,
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test command port did not bind');
    process.env.COMPANION_MAYA_HOST = '127.0.0.1';
    process.env.COMPANION_MAYA_PORT = String(address.port);

    try {
      const result = await runWorkflowCapability({
        checkOutputExists: vi.fn().mockResolvedValue(false),
        connectorStatus: connectedStatus,
        historyPath,
        params: {
          file_name: 'command-port',
          output_dir: 'project://exports',
          overwrite: true,
        },
        runId: 'run_command_port_default',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.result).toMatchObject({
        status: 'succeeded',
        workflow_id: 'workflow.maya.export_selection_fbx',
      });
      expect(result.result?.artifacts[0]).toMatchObject({
        metadata: { bytes: 768 },
        uri: 'project://exports/command-port.fbx',
      });
      expect(listWorkflowRuns(historyPath)[0]).toMatchObject({
        id: 'run_command_port_default',
        status: 'succeeded',
      });
    } finally {
      if (oldHost === undefined) delete process.env.COMPANION_MAYA_HOST;
      else process.env.COMPANION_MAYA_HOST = oldHost;
      if (oldPort === undefined) delete process.env.COMPANION_MAYA_PORT;
      else process.env.COMPANION_MAYA_PORT = oldPort;
      if (oldSandbox === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = oldSandbox;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('runs Maya Workflow against the already-connected software_connection Command Port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-connected-maya-'));
    const historyPath = join(dir, 'workflow-runs.json');
    const oldHost = process.env.COMPANION_MAYA_HOST;
    const oldPort = process.env.COMPANION_MAYA_PORT;
    const oldSandbox = process.env.COMPANION_SANDBOX_ROOT;
    process.env.COMPANION_SANDBOX_ROOT = dir;
    delete process.env.COMPANION_MAYA_HOST;
    delete process.env.COMPANION_MAYA_PORT;

    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        const text = String(chunk);
        const resultPath = text.match(/open\(r'([^']*assetcutter-workflow-maya-result-[^']+\.json)'\)/)?.[1];
        if (!resultPath) {
          socket.end('{}');
          return;
        }
        writeFileSync(resultPath, JSON.stringify({
          ok: true,
          bytes: 512,
          exported_at: '2026-08-24T02:00:00.000Z',
          local_path: 'F:/exports/connected-maya.fbx',
          selected_objects: ['|pCube1'],
          selection_count: 1,
        }), 'utf8');
        socket.end(JSON.stringify({
          ok: true,
          bytes: 512,
          exported_at: '2026-08-24T02:00:00.000Z',
          local_path: 'F:/exports/connected-maya.fbx',
          selected_objects: ['|pCube1'],
          selection_count: 1,
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test connected maya port did not bind');

    const created = createCapabilityPackageDraft({
      id: 'studio-maya',
      type: 'software_connection',
      name: 'Studio Maya',
      manifest: { executablePath: 'C:/Program Files/Autodesk/Maya2022/bin/maya.exe' },
    });
    expect(created.ok).toBe(true);
    updateCapabilityPackageDraft('studio-maya', (current) => ({
      ...current,
      lastProbe: {
        ok: true,
        softwareId: 'maya',
        result: { ok: true, host: '127.0.0.1', port: address.port, softwareId: 'maya' },
      },
    }));

    try {
      const result = await runWorkflowCapability({
        checkOutputExists: vi.fn().mockResolvedValue(false),
        historyPath,
        params: {
          file_name: 'connected-maya',
          output_dir: 'project://exports',
          overwrite: true,
        },
        runId: 'run_connected_maya_connection',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.result).toMatchObject({
        status: 'succeeded',
        workflow_id: 'workflow.maya.export_selection_fbx',
      });
      expect(result.result?.artifacts[0]).toMatchObject({
        metadata: { bytes: 512 },
        uri: 'project://exports/connected-maya.fbx',
      });
    } finally {
      if (oldHost === undefined) delete process.env.COMPANION_MAYA_HOST;
      else process.env.COMPANION_MAYA_HOST = oldHost;
      if (oldPort === undefined) delete process.env.COMPANION_MAYA_PORT;
      else process.env.COMPANION_MAYA_PORT = oldPort;
      if (oldSandbox === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = oldSandbox;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('saves a successful temporary WorkflowRun as an editable WorkflowDraft on demand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-save-draft-'));
    const historyPath = join(dir, 'workflow-runs.json');
    const storePath = join(dir, 'workflow-objects.json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        data: {
          bytes: 256,
          local_path: 'F:/exports/draft-source.fbx',
          selection_count: 1,
          storage_uri: 'project://exports/draft-source.fbx',
        },
      })),
    }));

    const runResult = await runWorkflowCapability({
      baseUrl: 'http://maya.local',
      checkOutputExists: vi.fn().mockResolvedValue(false),
      connectorStatus: connectedStatus,
      historyPath,
      params: {
        file_name: 'draft-source',
        output_dir: 'project://exports',
        overwrite: false,
      },
      runId: 'run_save_as_draft',
    });
    expect(runResult.ok).toBe(true);
    expect(loadWorkflowObjectStore(storePath).drafts).toEqual([]);

    const saved = saveWorkflowRunAsDraft({
      draftId: 'draft_saved_from_run',
      historyPath,
      name: '导出选择草稿',
      now: '2026-08-11T09:00:00.000Z',
      runId: 'run_save_as_draft',
      storePath,
    });

    expect(saved.ok).toBe(true);
    expect(saved.ok && saved.draft).toMatchObject({
      id: 'draft_saved_from_run',
      latest_test_run_id: 'run_save_as_draft',
      name: '导出选择草稿',
      source: { kind: 'run', run_id: 'run_save_as_draft' },
      status: 'draft',
    });
    expect(saved.ok && saved.draft.definition).toMatchObject({
      default_input: {
        file_name: 'draft-source.fbx',
        output_dir: 'project://exports',
        output_path: 'project://exports/draft-source.fbx',
        overwrite: false,
      },
      replay_snapshot_id: 'replay_run_save_as_draft',
      source_artifact_ids: [expect.any(String)],
    });
    expect(loadWorkflowObjectStore(storePath).drafts).toHaveLength(1);
    expect(listWorkflowRuns(historyPath)[0]).toMatchObject({
      id: 'run_save_as_draft',
      saved_as_draft_id: 'draft_saved_from_run',
    });

    rmSync(dir, { force: true, recursive: true });
  });

  it('creates, reads, updates, and archives WorkflowDraft records without deleting history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-draft-api-'));
    const storePath = join(dir, 'workflow-objects.json');

    const created = createWorkflowDraft({
      description: 'First reusable Maya export draft.',
      draftId: 'draft_api_maya_export',
      name: 'Maya 导出草稿',
      now: '2026-08-11T10:00:00.000Z',
      source: { kind: 'conversation', message_id: 'msg_create_draft' },
      storePath,
      workflowId: 'workflow.maya.export_selection_fbx',
    });

    expect(created.ok).toBe(true);
    expect(listWorkflowDrafts(storePath)).toHaveLength(1);
    expect(getWorkflowDraft('draft_api_maya_export', storePath)).toMatchObject({
      ok: true,
      draft: {
        description: 'First reusable Maya export draft.',
        id: 'draft_api_maya_export',
        source: { kind: 'conversation', message_id: 'msg_create_draft' },
        status: 'draft',
      },
    });

    const updated = updateWorkflowDraft({
      defaultInput: {
        file_name: 'updated.fbx',
        output_dir: 'project://exports',
        output_path: 'project://exports/updated.fbx',
        overwrite: true,
      },
      description: 'Updated draft description.',
      draftId: 'draft_api_maya_export',
      name: '更新后的 Maya 导出草稿',
      now: '2026-08-11T10:05:00.000Z',
      requiredConnectors: [{
        capability_package_id: 'maya',
        id: 'maya_connector',
        kind: 'software_connection',
        title: 'Maya Connector',
      }],
      status: 'ready_for_validation',
      storePath,
    });

    expect(updated.ok).toBe(true);
    expect(updated.ok && updated.draft).toMatchObject({
      description: 'Updated draft description.',
      name: '更新后的 Maya 导出草稿',
      status: 'ready_for_validation',
      updated_at: '2026-08-11T10:05:00.000Z',
    });
    expect(updated.ok && updated.draft.definition).toMatchObject({
      default_input: {
        file_name: 'updated.fbx',
        output_dir: 'project://exports',
        output_path: 'project://exports/updated.fbx',
        overwrite: true,
      },
      required_connectors: [{
        capability_package_id: 'maya',
        id: 'maya_connector',
        kind: 'software_connection',
        title: 'Maya Connector',
      }],
    });

    const archived = archiveWorkflowDraft({
      draftId: 'draft_api_maya_export',
      now: '2026-08-11T10:10:00.000Z',
      storePath,
    });

    expect(archived.ok).toBe(true);
    expect(listWorkflowDrafts(storePath)).toHaveLength(1);
    expect(getWorkflowDraft('draft_api_maya_export', storePath)).toMatchObject({
      ok: true,
      draft: {
        id: 'draft_api_maya_export',
        status: 'archived',
        updated_at: '2026-08-11T10:10:00.000Z',
      },
    });

    rmSync(dir, { force: true, recursive: true });
  });

  it('test-runs an editable WorkflowDraft without changing the stable WorkflowDefinition version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-draft-test-run-'));
    const historyPath = join(dir, 'workflow-runs.json');
    const storePath = join(dir, 'workflow-objects.json');
    const skill = getWorkflowSkill('workflow.maya.export_selection_fbx');
    expect(skill).toBeDefined();
    const stable = createWorkflowDefinitionFromSkill({
      createdAt: '2026-08-11T11:00:00.000Z',
      skill: skill!,
    });
    upsertWorkflowDefinition(stable.definition, storePath);
    upsertWorkflowVersion(stable.version, storePath);
    const draft = createWorkflowDraft({
      draftId: 'draft_test_run',
      name: '试运行草稿',
      now: '2026-08-11T11:05:00.000Z',
      storePath,
      workflowId: 'workflow.maya.export_selection_fbx',
    });
    expect(draft.ok).toBe(true);
    const updatedDraft = updateWorkflowDraft({
      defaultInput: {
        file_name: 'draft-test',
        output_dir: 'project://drafts',
        overwrite: false,
      },
      draftId: 'draft_test_run',
      storePath,
    });
    expect(updatedDraft.ok).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        data: {
          bytes: 1024,
          local_path: 'F:/exports/draft-test.fbx',
          selection_count: 1,
          storage_uri: 'project://drafts/draft-test.fbx',
        },
      })),
    }));

    const trial = await testRunWorkflowDraft({
      baseUrl: 'http://maya.local',
      checkOutputExists: vi.fn().mockResolvedValue(false),
      connectorStatus: connectedStatus,
      draftId: 'draft_test_run',
      historyPath,
      runId: 'run_draft_trial',
      storePath,
    });

    expect(trial.ok).toBe(true);
    expect('result' in trial && trial.result).toMatchObject({
      draft_id: 'draft_test_run',
      id: 'run_draft_trial',
      normalized_input: {
        file_name: 'draft-test.fbx',
        output_dir: 'project://drafts',
        output_path: 'project://drafts/draft-test.fbx',
        overwrite: false,
      },
      status: 'succeeded',
      workflow_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
    });
    expect(listWorkflowRuns(historyPath)[0]).toMatchObject({
      draft_id: 'draft_test_run',
      id: 'run_draft_trial',
    });
    expect(getWorkflowDraft('draft_test_run', storePath)).toMatchObject({
      ok: true,
      draft: {
        latest_test_run_id: 'run_draft_trial',
      },
    });
    expect(loadWorkflowObjectStore(storePath).definitions[0]).toMatchObject({
      current_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
    });

    rmSync(dir, { force: true, recursive: true });
  });

  it('publishes a tested WorkflowDraft as the default version and can roll back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-draft-publish-'));
    const storePath = join(dir, 'workflow-objects.json');
    const skill = getWorkflowSkill('workflow.maya.export_selection_fbx');
    expect(skill).toBeDefined();
    const stable = createWorkflowDefinitionFromSkill({
      createdAt: '2026-08-11T12:00:00.000Z',
      skill: skill!,
    });
    upsertWorkflowDefinition(stable.definition, storePath);
    upsertWorkflowVersion(stable.version, storePath);
    const untested = createWorkflowDraft({
      draftId: 'draft_untested_publish',
      storePath,
      workflowId: 'workflow.maya.export_selection_fbx',
    });
    expect(untested.ok).toBe(true);
    expect(publishWorkflowDraftVersion({
      draftId: 'draft_untested_publish',
      storePath,
    })).toMatchObject({
      ok: false,
      error: 'workflow_draft_not_tested',
    });

    const tested = createWorkflowDraft({
      draftId: 'draft_publish_ready',
      name: '发布后的 Maya 导出',
      storePath,
      workflowId: 'workflow.maya.export_selection_fbx',
    });
    expect(tested.ok).toBe(true);
    updateWorkflowDraft({
      defaultInput: {
        file_name: 'published',
        output_dir: 'project://exports',
        overwrite: false,
      },
      draftId: 'draft_publish_ready',
      now: '2026-08-11T12:05:00.000Z',
      status: 'ready_for_validation',
      storePath,
    });
    const readyDraft = getWorkflowDraft('draft_publish_ready', storePath);
    expect(readyDraft.ok).toBe(true);
    if (readyDraft.ok) {
      upsertWorkflowDraft({
        ...readyDraft.draft,
        latest_test_run_id: 'run_publish_ready',
      }, storePath);
    }

    const published = publishWorkflowDraftVersion({
      changeSummary: 'Use updated draft defaults.',
      draftId: 'draft_publish_ready',
      now: '2026-08-11T12:10:00.000Z',
      semver: '0.2.0',
      storePath,
    });

    expect(published.ok).toBe(true);
    expect(published.ok && published.definition).toMatchObject({
      current_version_id: 'workflow.maya.export_selection_fbx@0.2.0',
      lifecycle: 'validated',
      name: '发布后的 Maya 导出',
    });
    expect(published.ok && published.version).toMatchObject({
      change_summary: 'Use updated draft defaults.',
      id: 'workflow.maya.export_selection_fbx@0.2.0',
      source_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
      validation: {
        status: 'fixture_validated',
      },
    });
    expect(loadWorkflowObjectStore(storePath).versions.map((item) => item.id)).toEqual([
      'workflow.maya.export_selection_fbx@0.2.0',
      'workflow.maya.export_selection_fbx@0.1.0',
    ]);

    const rolledBack = rollbackWorkflowDefaultVersion({
      now: '2026-08-11T12:15:00.000Z',
      storePath,
      versionId: 'workflow.maya.export_selection_fbx@0.1.0',
      workflowId: 'workflow.maya.export_selection_fbx',
    });

    expect(rolledBack).toMatchObject({
      ok: true,
      definition: {
        current_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
        updated_at: '2026-08-11T12:15:00.000Z',
      },
    });
    expect(loadWorkflowObjectStore(storePath).versions).toHaveLength(2);

    rmSync(dir, { force: true, recursive: true });
  });

  it('creates a repair session from a failed WorkflowRun and requires preflight before reuse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-repair-session-'));
    const historyPath = join(dir, 'workflow-runs.json');
    const storePath = join(dir, 'workflow-objects.json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({
        ok: false,
        error: {
          message: 'Output already exists: project://exports/repair-me.fbx',
        },
      })),
    }));

    const failed = await runWorkflowCapability({
      baseUrl: 'http://maya.local',
      checkOutputExists: vi.fn().mockResolvedValue(false),
      connectorStatus: connectedStatus,
      historyPath,
      params: {
        file_name: 'repair-me',
        output_dir: 'project://exports',
        overwrite: false,
      },
      runId: 'run_needs_repair',
    });
    expect(failed.ok).toBe(false);
    expect(createWorkflowRepairSession({
      historyPath,
      now: '2026-08-11T13:00:00.000Z',
      runId: 'run_needs_repair',
      sessionId: 'repair_run_needs_repair',
      storePath,
    })).toMatchObject({
      ok: true,
      repairSession: {
        failure: {
          code: 'output_exists',
          run_id: 'run_needs_repair',
          status: 'failed',
        },
        repair_action_ids: ['confirm_overwrite_or_rename'],
        requires_preflight: true,
        scope_options: ['run_only', 'update_draft', 'new_version', 'rollback_default_version'],
        status: 'preflight_required',
      },
    });
    expect(selectWorkflowRepairScope({
      now: '2026-08-11T13:05:00.000Z',
      scope: 'new_version',
      sessionId: 'repair_run_needs_repair',
      storePath,
    })).toMatchObject({
      ok: true,
      repairSession: {
        selected_scope: 'new_version',
        status: 'preflight_required',
        updated_at: '2026-08-11T13:05:00.000Z',
      },
    });
    expect(getWorkflowRepairSession('repair_run_needs_repair', storePath)).toMatchObject({
      ok: true,
      repairSession: {
        requires_preflight: true,
      },
    });

    rmSync(dir, { force: true, recursive: true });
  });

  it('creates, lists, and deletes WorkflowPin references without copying definitions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assetcutter-workflow-pins-'));
    const storePath = join(dir, 'workflow-objects.json');
    const skill = getWorkflowSkill('workflow.maya.export_selection_fbx');
    expect(skill).toBeDefined();
    const stable = createWorkflowDefinitionFromSkill({
      createdAt: '2026-08-11T14:00:00.000Z',
      skill: skill!,
    });
    upsertWorkflowDefinition(stable.definition, storePath);
    upsertWorkflowVersion(stable.version, storePath);

    expect(createWorkflowPin({
      createdAt: '2026-08-11T14:05:00.000Z',
      pinId: 'pin_home_export',
      scope: { kind: 'home' },
      sortOrder: 1,
      storePath,
      workflowId: 'workflow.maya.export_selection_fbx',
    })).toMatchObject({
      ok: true,
      pin: {
        id: 'pin_home_export',
        scope: { kind: 'home' },
        version_policy: { kind: 'follow_default' },
        workflow_id: 'workflow.maya.export_selection_fbx',
      },
    });
    expect(createWorkflowPin({
      createdAt: '2026-08-11T14:06:00.000Z',
      pinId: 'pin_maya_locked',
      scope: { kind: 'connection', connection_id: 'maya' },
      storePath,
      versionPolicy: { kind: 'locked', version_id: 'workflow.maya.export_selection_fbx@0.1.0' },
      workflowId: 'workflow.maya.export_selection_fbx',
    })).toMatchObject({
      ok: true,
      pin: {
        id: 'pin_maya_locked',
        version_policy: { kind: 'locked', version_id: 'workflow.maya.export_selection_fbx@0.1.0' },
      },
    });

    expect(listWorkflowPins({ storePath })).toHaveLength(2);
    expect(listWorkflowPins({ scope: 'connection', storePath })).toMatchObject([{
      id: 'pin_maya_locked',
    }]);
    expect(loadWorkflowObjectStore(storePath).definitions).toHaveLength(1);

    expect(deleteWorkflowPin({
      pinId: 'pin_home_export',
      storePath,
    })).toMatchObject({
      ok: true,
      pins: [expect.objectContaining({ id: 'pin_maya_locked' })],
    });
    const afterDelete = loadWorkflowObjectStore(storePath);
    expect(afterDelete.pins).toHaveLength(1);
    expect(afterDelete.definitions).toHaveLength(1);
    expect(afterDelete.definitions[0]).toMatchObject({
      id: 'workflow.maya.export_selection_fbx',
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
