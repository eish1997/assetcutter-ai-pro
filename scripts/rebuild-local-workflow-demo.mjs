import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { clearWorkflowRuns, listWorkflowRuns, saveWorkflowRun } from '../local-companion/src/workflows/runtime/workflowRunHistory.ts';
import { runMayaExportWorkflow } from '../local-companion/src/workflows/runtime/workflowExecution.ts';
import { mayaExportSelectionFbxWorkflowSkill } from '../local-companion/src/workflows/runtime/workflowSkills.ts';
import { saveWorkflowRunAsDraft, publishWorkflowDraftVersion } from '../local-companion/src/workflows/workflowDrafts.ts';
import { clearWorkflowObjectStore, loadWorkflowObjectStore } from '../local-companion/src/workflows/workflowObjectStore.ts';
import { createWorkflowPin } from '../local-companion/src/workflows/workflowPins.ts';

const root = process.cwd();
const runtimeDir = path.join(root, 'local-companion', '.assetcutter', 'workflow-runtime');
const exportsDir = path.join(runtimeDir, 'exports');
const historyPath = path.join(runtimeDir, 'workflow-runs.json');
const storePath = path.join(runtimeDir, 'workflow-objects.json');

mkdirSync(exportsDir, { recursive: true });

clearWorkflowRuns(historyPath);
clearWorkflowObjectStore(storePath);

const now = new Date().toISOString();
const outputDir = 'project://exports/demo';
const fileName = 'workflow_demo_asset';
const outputPath = `${outputDir}/${fileName}.fbx`;
const localPath = path.join(exportsDir, `${fileName}.fbx`);
const demoBytes = Buffer.from('AssetCutter local companion workflow demo FBX artifact\n', 'utf8');
writeFileSync(localPath, demoBytes);

const toolClient = {
  async callTool(request) {
    const finishedAt = new Date().toISOString();
    return {
      audit: {
        actor_id: request.caller_agent.id,
        actor_type: 'assetcutter',
        audit_id: 'audit_demo_maya_fbx_success',
        caller_agent_id: request.caller_agent.id,
        created_at: finishedAt,
        permissions_checked: ['workflow:run'],
        policy_decision: 'allow',
        risk_level: 'high',
        scopes: request.caller_agent.scopes ?? [],
        transport: request.caller_agent.transport,
      },
      conversation_id: request.conversation_id,
      finished_at: finishedAt,
      output: {
        asset_id: 'artifact_demo_maya_fbx_success',
        bytes: demoBytes.length,
        local_path: localPath,
        selection_count: 2,
        storage_uri: outputPath,
        trace_id: request.trace_id,
      },
      started_at: finishedAt,
      status: 'succeeded',
      tool_call_id: 'tc_demo_maya_fbx_success',
      tool_name: request.tool_name,
      trace_id: request.trace_id,
    };
  },
};

const run = await runMayaExportWorkflow(
  { file_name: fileName, output_dir: outputDir, overwrite: false },
  {
    checkOutputExists: async () => false,
    client: toolClient,
    connectorStatus: { mode: 'fixture', selectionCount: 2, state: 'connected' },
    now,
    runId: 'demo_workflow_maya_export_selection_fbx_success',
    traceId: 'trace_demo_workflow_maya_export_selection_fbx_success',
  },
);

if (run.status !== 'succeeded') {
  throw new Error(`Demo workflow run failed: ${run.status}`);
}

saveWorkflowRun(run, historyPath);

const draftResult = saveWorkflowRunAsDraft({
  historyPath,
  name: '示例：Maya 当前选择导出 FBX',
  now,
  runId: run.id,
  storePath,
});

if (!draftResult.ok) {
  throw new Error(draftResult.message);
}

const publishResult = publishWorkflowDraftVersion({
  changeSummary: '重建本地伴侣 Workflow 示例，并用成功运行记录验证。',
  draftId: draftResult.draft.id,
  now,
  semver: '0.1.1-demo',
  storePath,
});

if (!publishResult.ok) {
  throw new Error(publishResult.message);
}

const pinResult = createWorkflowPin({
  pinId: 'pin_demo_maya_fbx_home',
  scope: { kind: 'home' },
  sortOrder: 1,
  storePath,
  versionPolicy: { kind: 'locked', version_id: publishResult.version.id },
  workflowId: publishResult.definition.id,
});

if (!pinResult.ok) {
  throw new Error(pinResult.message);
}

const runs = listWorkflowRuns(historyPath);
const store = loadWorkflowObjectStore(storePath);

console.log(JSON.stringify({
  ok: true,
  historyPath,
  storePath,
  run: {
    id: run.id,
    status: run.status,
    artifact: run.artifacts[0],
    replay_snapshot_id: run.replay_snapshot_id,
    preflight: run.preflight_results.map((result) => ({
      id: result.check_id,
      status: result.status,
    })),
  },
  draft: {
    id: draftResult.draft.id,
    status: publishResult.draft.status,
    source: draftResult.draft.source,
  },
  definition: {
    id: publishResult.definition.id,
    current_version_id: publishResult.definition.current_version_id,
  },
  version: {
    id: publishResult.version.id,
    validation: publishResult.version.validation.status,
  },
  pin: pinResult.pin,
  counts: {
    runs: runs.length,
    definitions: store.definitions.length,
    drafts: store.drafts.length,
    versions: store.versions.length,
    pins: store.pins.length,
    repair_sessions: store.repair_sessions.length,
  },
}, null, 2));
