import { runWorkflowFixtureSuite } from './runtime/workflowFixtureRunner.js';
import { listWorkflowSkills, MANUAL_TRACE_WORKFLOW_ID } from './runtime/workflowSkills.js';
import { listCloudWorkflowPackages, shelfSkillOrigin } from './skillCloud.js';
import { buildTraceSkillPrompt, ensureExampleShelfSkills, listShelfSkills, saveShelfSkill } from './skillShelf.js';
import { createWorkflowDraft, listWorkflowDrafts } from './workflowDrafts.js';

export const MAYA_EXPORT_FBX_WORKFLOW_ID = 'workflow.maya.export_selection_fbx';
export { MANUAL_TRACE_WORKFLOW_ID };

export const REPLAY_NO_TRACE = 'replay_no_trace';
export const REPLAY_NO_EXECUTOR = 'replay_no_executor';
export const REPLAY_FIXTURE_FAILED = 'replay_fixture_failed';
export const REPLAY_COMPILE_SOURCE = 'replay_compile';

export type ReplayTrace = {
  args?: unknown;
  at?: string;
  tool: string;
};

export type ReplayCompileFail = {
  code: typeof REPLAY_NO_TRACE | typeof REPLAY_NO_EXECUTOR | typeof REPLAY_FIXTURE_FAILED;
  error: typeof REPLAY_NO_TRACE | typeof REPLAY_NO_EXECUTOR | typeof REPLAY_FIXTURE_FAILED;
  ok: false;
  workflowId?: string;
};

export type ReplayCompileOk = {
  draft?: unknown;
  ok: true;
  status: 'available';
  workflowId: string;
};

function traceBlob(traces: ReplayTrace[]): string {
  return traces
    .map((row) => `${row.tool} ${typeof row.args === 'string' ? row.args : JSON.stringify(row.args || {})}`)
    .join('\n')
    .toLowerCase();
}

function isManualHostTrace(blob: string): boolean {
  return (
    blob.includes('unreal') ||
    blob.includes('ue5') ||
    blob.includes('ue4') ||
    blob.includes('ue-fog') ||
    blob.includes('fog') ||
    blob.includes('holdout') ||
    blob.includes('connection_probe') ||
    blob.includes('connection_create') ||
    blob.includes('connection_discover')
  );
}

export function inferReplayTitle(traces: ReplayTrace[]): string {
  const blob = traceBlob(traces);
  const unreal = blob.includes('unreal') || blob.includes('ue5') || blob.includes('ue4') || blob.includes('ue-fog');
  const fog = blob.includes('fog') || blob.includes('holdout');
  if (unreal && fog) return 'Unreal fog holdout';
  if (unreal) return 'Unreal 连接';
  if (fog) return 'fog holdout';
  return '手册复现';
}

function formatTraceSteps(traces: ReplayTrace[]): string {
  return traces
    .map((row) => {
      const tool = String(row.tool || '').trim();
      if (!tool) return '';
      const args = row.args && typeof row.args === 'object' ? JSON.stringify(row.args) : String(row.args || '').trim();
      return args ? `${tool} ${args}` : tool;
    })
    .filter(Boolean)
    .join('\n');
}

export function bindReplayExecutor(traces: ReplayTrace[]): string | null {
  const blob = traceBlob(traces);
  if (isManualHostTrace(blob)) return MANUAL_TRACE_WORKFLOW_ID;
  if (
    blob.includes('maya') ||
    blob.includes('fbx') ||
    blob.includes('export_selection') ||
    blob.includes('host.import_file')
  ) {
    return MAYA_EXPORT_FBX_WORKFLOW_ID;
  }
  return null;
}

export function compileReplayFromTrace(traces: ReplayTrace[]): ReplayCompileFail | { ok: true; workflowId: string } {
  const list = Array.isArray(traces) ? traces.filter((row) => row && String(row.tool || '').trim()) : [];
  if (!list.length) {
    return { ok: false, error: REPLAY_NO_TRACE, code: REPLAY_NO_TRACE };
  }
  const workflowId = bindReplayExecutor(list);
  if (!workflowId) {
    return { ok: false, error: REPLAY_NO_EXECUTOR, code: REPLAY_NO_EXECUTOR };
  }
  return { ok: true, workflowId };
}

export async function compileReplayWithFixture(input: {
  createDraft?: (workflowId: string) => unknown;
  runFixture?: (workflowId: string) => boolean | Promise<boolean>;
  traces: ReplayTrace[];
}): Promise<ReplayCompileFail | ReplayCompileOk> {
  const compiled = compileReplayFromTrace(input.traces);
  if (!compiled.ok) return compiled;
  if (typeof input.runFixture === 'function') {
    const passed = await input.runFixture(compiled.workflowId);
    if (!passed) {
      return { ok: false, error: REPLAY_FIXTURE_FAILED, code: REPLAY_FIXTURE_FAILED, workflowId: compiled.workflowId };
    }
  }
  const draft = typeof input.createDraft === 'function' ? input.createDraft(compiled.workflowId) : undefined;
  return {
    ok: true,
    workflowId: compiled.workflowId,
    status: 'available',
    draft,
  };
}

export async function runRegisteredReplayFixture(workflowId: string): Promise<boolean> {
  if (workflowId === MANUAL_TRACE_WORKFLOW_ID) return true;
  if (workflowId !== MAYA_EXPORT_FBX_WORKFLOW_ID) return false;
  const cases = await runWorkflowFixtureSuite();
  const success = cases.find((item) => item.id === 'maya_fbx_success');
  return Boolean(success && success.run && success.run.status === 'succeeded');
}

export function compileReplayRequest(traces: ReplayTrace[], opts: { skillsDir?: string; storePath?: string } = {}) {
  return compileReplayWithFixture({
    traces,
    runFixture: runRegisteredReplayFixture,
    createDraft: (workflowId) => {
      const manual = workflowId === MANUAL_TRACE_WORKFLOW_ID;
      if (manual) {
        const name = inferReplayTitle(traces);
        const steps = formatTraceSteps(traces);
        const saved = saveShelfSkill({
          name,
          description: steps,
          prompt: buildTraceSkillPrompt(name, steps),
          skillsDir: opts.skillsDir,
        });
        return saved.ok ? saved.skill : undefined;
      }
      const result = createWorkflowDraft({
        source: { kind: 'conversation' },
        workflowId,
        storePath: opts.storePath,
      });
      return result.ok ? result.draft : undefined;
    },
  });
}

function wallCardFromShelfSkill(skill: ReturnType<typeof listShelfSkills>[number], hasCloud: boolean) {
  const origin = shelfSkillOrigin(skill.id);
  return {
    id: skill.id,
    name: skill.name,
    status: 'available' as const,
    replayKind: 'skill' as const,
    origin,
    hasLocal: true,
    hasCloud,
    removable: true,
    publishable: true,
    installable: false,
    userSummary: {
      title: skill.name,
      inputSummary: skill.description || skill.prompt,
      outputSummary: '',
    },
    skillPrompt: skill.prompt,
    aiContract: { inputSchema: { properties: {} } },
  };
}

export function listReplayWallWorkflows(storePath?: string, skillsDir?: string) {
  const shelfRoot = skillsDir || undefined;
  ensureExampleShelfSkills(shelfRoot);
  const cloudPkgs = listCloudWorkflowPackages();
  const cloudById = new Map(cloudPkgs.map((pkg) => [pkg.id, pkg]));
  const shelf = listShelfSkills(skillsDir).map((skill) => wallCardFromShelfSkill(skill, cloudById.has(skill.id)));
  const shelfIds = new Set(shelf.map((row) => row.id));
  const cloudOnly = cloudPkgs
    .filter((pkg) => !shelfIds.has(pkg.id))
    .map((pkg) => {
      const prompt = String((pkg.manifest && pkg.manifest.skillPrompt) || pkg.description || '').trim();
      return {
        id: pkg.id,
        name: pkg.name,
        status: 'available' as const,
        replayKind: 'skill' as const,
        origin: 'cloud' as const,
        hasLocal: false,
        hasCloud: true,
        removable: false,
        publishable: false,
        installable: true,
        userSummary: {
          title: pkg.name,
          inputSummary: pkg.description || prompt,
          outputSummary: '',
        },
        skillPrompt: prompt,
        aiContract: { inputSchema: { properties: {} } },
      };
    });
  const compiled = listWorkflowDrafts(storePath)
    .filter((draft) => {
      const source = draft.source;
      return (
        source &&
        source.kind === 'conversation' &&
        source.message_id === REPLAY_COMPILE_SOURCE &&
        draft.status !== 'archived' &&
        !shelfIds.has(draft.id)
      );
    })
    .map((draft) => ({
      id: draft.id,
      name: draft.name,
      status: 'available' as const,
      replayKind: 'manual' as const,
      origin: 'shelf' as const,
      hasLocal: true,
      hasCloud: cloudById.has(draft.id),
      removable: false,
      publishable: false,
      installable: false,
      userSummary: {
        title: draft.name,
        inputSummary: String(draft.description || '').trim() || '按整理好的步骤由管家代办。本机没有自动执行器。',
        outputSummary: '',
      },
      aiContract: { inputSchema: { properties: {} } },
    }));
  const executors = listWorkflowSkills().map((workflow) => ({
    ...workflow,
    replayKind: 'executor' as const,
    origin: 'executor' as const,
    hasLocal: true,
    hasCloud: false,
    removable: false,
    publishable: false,
    installable: false,
  }));
  return [...shelf, ...cloudOnly, ...compiled, ...executors];
}
