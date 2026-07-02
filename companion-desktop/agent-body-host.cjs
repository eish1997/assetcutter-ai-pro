'use strict';

const { ALL_TOOL_SCHEMAS, P0_TOOL_SCHEMAS, P1_TOOL_SCHEMAS, P2_TOOL_SCHEMAS } = require('./agent-tool-schemas.cjs');
const { listSkillEntries, readSkillById } = require('./agent-skills.cjs');
const { listMemoryNotes, appendMemoryNote } = require('./agent-memory.cjs');

const VALID_SHELL_VIEWS = new Set(['home', 'workbench', 'scripts', 'tools', 'settings']);

function toolAborted(ctx) {
  return Boolean(ctx && ctx.signal && ctx.signal.aborted);
}

function abortedToolResult() {
  return {
    ok: false,
    content: '',
    error: { code: 'AGENT_ABORTED', message: 'turn aborted' },
  };
}

function abortIfNeeded(ctx) {
  if (toolAborted(ctx)) return abortedToolResult();
  return null;
}

function httpOpts(ctx, extra) {
  const base = extra && typeof extra === 'object' ? { ...extra } : {};
  if (ctx && ctx.signal) base.signal = ctx.signal;
  return base;
}

function validateArgs(schema, args) {
  if (!schema || typeof schema !== 'object') return { ok: true, value: args || {} };
  const a = args && typeof args === 'object' ? args : {};
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const k of Object.keys(a)) {
      if (!allowed.has(k)) return { ok: false, error: `unexpected field: ${k}` };
    }
  }
  if (schema.required) {
    for (const k of schema.required) {
      if (a[k] === undefined || a[k] === null || a[k] === '') {
        return { ok: false, error: `missing required: ${k}` };
      }
    }
  }
  const view = a.view;
  if (view != null && schema.properties?.view?.enum && !schema.properties.view.enum.includes(view)) {
    return { ok: false, error: 'invalid view' };
  }
  const engine = a.engine;
  if (engine != null && schema.properties?.engine?.enum && !schema.properties.engine.enum.includes(engine)) {
    return { ok: false, error: 'invalid engine' };
  }
  const targetType = a.targetType;
  if (
    targetType != null &&
    schema.properties?.targetType?.enum &&
    !schema.properties.targetType.enum.includes(targetType)
  ) {
    return { ok: false, error: 'invalid targetType' };
  }
  return { ok: true, value: a };
}

/**
 * @param {{
 *   getShellView: () => string;
 *   navigateShell: (view: string) => Promise<{ ok: boolean; error?: string }>;
 *   companionApiRequest: (method: string, pathname: string, body?: unknown, opts?: object) => Promise<{ ok: boolean; json?: unknown; text?: string; error?: string }>;
 *   getStateSummary: () => Promise<Record<string, unknown>>;
 *   workbenchClient?: ReturnType<import('./agent-workbench-client.cjs').createAgentWorkbenchClient>;
 *   scriptHubClient?: ReturnType<import('./agent-script-hub-client.cjs').createAgentScriptHubClient>;
 *   runShellTool?: (toolId: string) => Promise<{ ok: boolean; error?: string }>;
 *   runShellBootstrap?: (engine: string, opts?: object) => Promise<{ ok: boolean; error?: string; detail?: unknown }>;
 *   getSkillsRoot?: () => string;
 *   getMemoryRoot?: () => string;
 * }} deps
 */
function createAgentBodyHost(deps) {
  const schemaByName = new Map(ALL_TOOL_SCHEMAS.map((t) => [t.name, t]));
  /** @type {Promise<unknown>} */
  let toolRunChain = Promise.resolve();

  async function listTools() {
    return [...ALL_TOOL_SCHEMAS];
  }

  async function executeToolInternal(name, args, ctx) {
    if (toolAborted(ctx)) return abortedToolResult();
    const schema = schemaByName.get(name);
    if (!schema) {
      return { ok: false, content: '', error: { code: 'AGENT_TOOL_UNKNOWN', message: name } };
    }
    const v = validateArgs(schema.inputSchema, args);
    if (!v.ok) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: v.error || 'invalid args' },
      };
    }
    const safeArgs = v.value;

    try {
      if (name === 'ac.shell.navigate') {
        const view = String(safeArgs.view || '').trim();
        if (!VALID_SHELL_VIEWS.has(view)) {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'invalid view' },
          };
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const nav = await deps.navigateShell(view);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (!nav.ok) {
          return {
            ok: false,
            content: JSON.stringify(nav),
            error: { code: 'AGENT_NAVIGATE_FAILED', message: nav.error || 'navigate failed' },
          };
        }
        return {
          ok: true,
          content: JSON.stringify({ navigated: view, shellView: deps.getShellView() }),
          structured: { view },
        };
      }

      if (name === 'ac.shell.get_state') {
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const summary = await deps.getStateSummary();
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return { ok: true, content: JSON.stringify(summary, null, 2), structured: summary };
      }

      if (name === 'ac.companion.runtime_status') {
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.companionApiRequest(
          'GET',
          '/v1/runtime-status',
          null,
          httpOpts(ctx, { timeoutMs: 12000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_COMPANION_HTTP', message: r.text || 'runtime-status failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.workbench.get_context') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.getContext();
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.workbench.open_project') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.openProject(safeArgs.projectId);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.workbench.run_capability') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.runCapability(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.script_hub.list_scripts') {
        if (!deps.scriptHubClient) {
          return toolUnavailable('script_hub_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.scriptHubClient.listScripts(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.script_hub.run_script') {
        if (!deps.scriptHubClient) {
          return toolUnavailable('script_hub_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.scriptHubClient.runScript(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.script_hub.get_run') {
        if (!deps.scriptHubClient) {
          return toolUnavailable('script_hub_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.scriptHubClient.getRun(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.script_hub.export_maya_selection') {
        if (!deps.scriptHubClient) {
          return toolUnavailable('script_hub_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.scriptHubClient.exportMayaSelection(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.companion.compute') {
        const jobBody = {
          type: String(safeArgs.type || '').trim(),
          projectId: safeArgs.projectId ? String(safeArgs.projectId) : undefined,
          inputs: safeArgs.inputs && typeof safeArgs.inputs === 'object' ? safeArgs.inputs : undefined,
          params: safeArgs.params && typeof safeArgs.params === 'object' ? safeArgs.params : undefined,
        };
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.companionApiRequest(
          'POST',
          '/v1/compute/jobs',
          jobBody,
          httpOpts(ctx, { timeoutMs: 120000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_COMPANION_HTTP', message: r.text || 'compute submit failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.shell_tool.run') {
        if (typeof deps.runShellTool !== 'function') {
          return toolUnavailable('shell_tool');
        }
        const toolId = String(safeArgs.toolId || '').trim();
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.runShellTool(toolId);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (!r.ok) {
          return {
            ok: false,
            content: JSON.stringify(r),
            error: { code: 'AGENT_SHELL_TOOL_FAILED', message: r.error || 'shell tool failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r, null, 2), structured: r };
      }

      if (name === 'ac.shell.bootstrap') {
        if (typeof deps.runShellBootstrap !== 'function') {
          return toolUnavailable('shell_bootstrap');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.runShellBootstrap(String(safeArgs.engine), {
          useGpu: Boolean(safeArgs.useGpu),
        });
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (!r.ok) {
          return {
            ok: false,
            content: JSON.stringify(r),
            error: { code: 'AGENT_BOOTSTRAP_FAILED', message: r.error || 'bootstrap failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r, null, 2), structured: r };
      }

      if (name === 'ac.skills.list') {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const skills = listSkillEntries(root);
        return { ok: true, content: JSON.stringify(skills, null, 2), structured: { skills } };
      }

      if (name === 'ac.skills.get') {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const skill = readSkillById(root, safeArgs.skillId);
        if (!skill) {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_SKILL_NOT_FOUND', message: String(safeArgs.skillId || '') },
          };
        }
        return { ok: true, content: JSON.stringify(skill, null, 2), structured: skill };
      }

      if (name === 'ac.memory.list') {
        const root = typeof deps.getMemoryRoot === 'function' ? deps.getMemoryRoot() : '';
        let notes = listMemoryNotes(root);
        const limit = Number(safeArgs.limit);
        if (Number.isFinite(limit) && limit > 0) {
          notes = notes.slice(-Math.min(100, Math.floor(limit)));
        }
        return { ok: true, content: JSON.stringify(notes, null, 2), structured: { notes } };
      }

      if (name === 'ac.memory.append') {
        const root = typeof deps.getMemoryRoot === 'function' ? deps.getMemoryRoot() : '';
        const r = appendMemoryNote(root, { text: safeArgs.text, tags: safeArgs.tags, source: 'ac.memory.append' });
        if (!r.ok) {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_MEMORY_APPEND_FAILED', message: r.error || 'append failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.note, null, 2), structured: r.note };
      }

      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_UNKNOWN', message: name },
      };
    } catch (e) {
      if (toolAborted(ctx)) return abortedToolResult();
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, content: '', error: { code: 'AGENT_TOOL_EXEC_FAILED', message: msg } };
    }
  }

  async function executeTool(name, args, ctx) {
    const run = () => executeToolInternal(name, args, ctx);
    const resultPromise = toolRunChain.then(run, run);
    toolRunChain = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    return resultPromise;
  }

  return { listTools, executeTool, ALL_TOOL_SCHEMAS, VALID_SHELL_VIEWS };
}

function toolUnavailable(code) {
  return {
    ok: false,
    content: '',
    error: { code: 'AGENT_TOOL_UNAVAILABLE', message: code },
  };
}

module.exports = {
  createAgentBodyHost,
  ALL_TOOL_SCHEMAS,
  P0_TOOL_SCHEMAS,
  P1_TOOL_SCHEMAS,
  P2_TOOL_SCHEMAS,
  VALID_SHELL_VIEWS,
  validateArgs,
};
