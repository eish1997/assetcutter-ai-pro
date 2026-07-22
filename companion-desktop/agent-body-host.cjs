'use strict';

const {
  ALL_TOOL_SCHEMAS,
  P0_TOOL_SCHEMAS,
  P1_TOOL_SCHEMAS,
  P2_TOOL_SCHEMAS,
  buildToolCatalog,
} = require('./agent-tool-schemas.cjs');
const {
  listSkillEntries,
  readSkillById,
  listSkillRevisions,
  readSkillRevision,
  saveSkill,
  deleteSkill,
} = require('./agent-skills.cjs');
const {
  listMemoryNotes,
  appendMemoryNote,
  listProjectMemoryNotes,
  appendProjectMemoryNote,
} = require('./agent-memory.cjs');

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

const SCRIPT_TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SCRIPT_TOOL_PERMISSIONS = new Set(['path.pick', 'tool.run']);
const SCRIPT_TOOL_BLOCKED_COMMANDS = new Set(['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'bash', 'sh']);
const WORKBENCH_PRESET_CAPABILITIES = new Map([
  ['text.generate', new Set(['text'])],
  ['vision.describe', new Set(['image'])],
  ['workflow_text_to_image', new Set(['image'])],
  ['workflow_image_edit', new Set(['image'])],
  ['video.generate', new Set(['video'])],
  ['model3d.generate', new Set(['model3d'])],
]);
const WORKBENCH_ASSET_CONTEXT_MODES = new Set(['none', 'current_project', 'current_asset', 'selected_assets']);

function isSafeRelativePath(value) {
  const s = String(value || '').replace(/\\/g, '/').trim();
  return Boolean(s) && !s.startsWith('/') && !/^[a-zA-Z]:\//.test(s) && !s.split('/').includes('..');
}

function validateScriptHubManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'script_manifest_missing' };
  const manifest = raw;
  if (manifest.schemaVersion !== 1) return { ok: false, error: 'script_manifest_schema_version_invalid' };
  if (typeof manifest.id !== 'string' || !SCRIPT_TOOL_ID_PATTERN.test(manifest.id)) {
    return { ok: false, error: 'script_manifest_id_invalid' };
  }
  for (const field of ['name', 'description', 'semver']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
      return { ok: false, error: `script_manifest_${field}_required` };
    }
  }
  if (!manifest.launch || typeof manifest.launch !== 'object' || Array.isArray(manifest.launch)) {
    return { ok: false, error: 'script_manifest_launch_required' };
  }
  if (manifest.launch.kind !== 'shell_module') return { ok: false, error: 'script_manifest_launch_kind_invalid' };
  if (typeof manifest.launch.module !== 'string' || !isSafeRelativePath(manifest.launch.module)) {
    return { ok: false, error: 'script_manifest_launch_module_invalid' };
  }
  if (!Array.isArray(manifest.permissions) || manifest.permissions.length === 0) {
    return { ok: false, error: 'script_manifest_permissions_required' };
  }
  const permissions = [];
  for (const permission of manifest.permissions) {
    if (typeof permission !== 'string' || !SCRIPT_TOOL_PERMISSIONS.has(permission)) {
      return { ok: false, error: 'script_manifest_permission_invalid' };
    }
    if (!permissions.includes(permission)) permissions.push(permission);
  }
  if (permissions.includes('tool.run')) {
    const run = manifest.run;
    if (!run || typeof run !== 'object' || Array.isArray(run)) return { ok: false, error: 'script_manifest_run_required' };
    if (!Array.isArray(run.command) || run.command.length === 0 || run.command.some((part) => typeof part !== 'string' || !part)) {
      return { ok: false, error: 'script_manifest_run_command_invalid' };
    }
    const executable = String(run.command[0] || '').trim().toLowerCase();
    if (SCRIPT_TOOL_BLOCKED_COMMANDS.has(executable)) return { ok: false, error: 'script_manifest_run_shell_blocked' };
    for (const part of run.command.slice(1)) {
      if (typeof part === 'string' && (part.includes('..') || /^[a-zA-Z]:[\\/]/.test(part))) {
        return { ok: false, error: 'script_manifest_run_command_path_invalid' };
      }
    }
    if (run.cwd !== undefined && (typeof run.cwd !== 'string' || !isSafeRelativePath(run.cwd))) {
      return { ok: false, error: 'script_manifest_run_cwd_invalid' };
    }
    const paramsMode = run.paramsMode === undefined ? 'env' : run.paramsMode;
    if (paramsMode !== 'env') return { ok: false, error: 'script_manifest_run_params_mode_invalid' };
    if (run.timeoutMs !== undefined) {
      const timeoutMs = Number(run.timeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) {
        return { ok: false, error: 'script_manifest_run_timeout_invalid' };
      }
    }
  }
  return {
    ok: true,
    manifest: { id: manifest.id, semver: manifest.semver.trim(), permissions },
    checks: {
      script_hub_permission_checked: true,
      sandbox_policy_checked: true,
    },
  };
}

function validateWorkbenchPresetRouteSchema(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'workbench_preset_missing' };
  const preset = raw;
  const capability = typeof preset.capability === 'string' ? preset.capability.trim() : '';
  const modality = typeof preset.modality === 'string' ? preset.modality.trim() : '';
  const canonicalModelId = typeof preset.canonicalModelId === 'string' ? preset.canonicalModelId.trim() : '';
  const providerId = typeof preset.providerId === 'string' ? preset.providerId.trim() : '';
  if (!capability || !WORKBENCH_PRESET_CAPABILITIES.has(capability)) {
    return { ok: false, error: 'workbench_preset_capability_invalid' };
  }
  if (!modality || !WORKBENCH_PRESET_CAPABILITIES.get(capability).has(modality)) {
    return { ok: false, error: 'workbench_preset_modality_invalid' };
  }
  if (!canonicalModelId || canonicalModelId.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(canonicalModelId)) {
    return { ok: false, error: 'workbench_preset_canonical_model_invalid' };
  }
  if (providerId && (providerId.length > 80 || !/^[a-zA-Z0-9._:-]+$/.test(providerId))) {
    return { ok: false, error: 'workbench_preset_provider_invalid' };
  }
  const assetContext = preset.assetContext && typeof preset.assetContext === 'object' && !Array.isArray(preset.assetContext)
    ? preset.assetContext
    : {};
  const mode = typeof assetContext.mode === 'string' && assetContext.mode.trim() ? assetContext.mode.trim() : 'none';
  if (!WORKBENCH_ASSET_CONTEXT_MODES.has(mode)) return { ok: false, error: 'workbench_preset_asset_context_invalid' };
  return {
    ok: true,
    routeSchema: {
      capability,
      modality,
      canonicalModelId,
      ...(providerId ? { providerId } : {}),
      assetContext: { mode },
    },
  };
}

async function resolveWorkbenchPresetModelProviderReadiness(routeSchema) {
  if (!routeSchema || typeof routeSchema !== 'object') return { ok: false, error: 'route_schema_missing' };
  try {
    const mod = await import('../shared/aiGatewayModelRoutes.js');
    const route =
      typeof mod.resolveExecutableAiGatewayModelRoute === 'function'
        ? mod.resolveExecutableAiGatewayModelRoute({
            canonicalModelId: routeSchema.canonicalModelId,
            providerId: routeSchema.providerId,
            modality: routeSchema.modality,
          })
        : null;
    if (!route || route.gatewayExecutionStatus !== 'gateway_ready') {
      return { ok: false, error: 'gateway_route_not_ready' };
    }
    return {
      ok: true,
      route: {
        ruleId: route.ruleId ? String(route.ruleId) : '',
        canonicalModelId: route.canonicalModelId ? String(route.canonicalModelId) : String(routeSchema.canonicalModelId || ''),
        providerId: route.providerId ? String(route.providerId) : String(routeSchema.providerId || ''),
        gatewayExecutionStatus: route.gatewayExecutionStatus ? String(route.gatewayExecutionStatus) : '',
        executionStatus: route.executionStatus ? String(route.executionStatus) : '',
        platformKeyRequired: Boolean(route.platformKeyRequired),
      },
    };
  } catch (e) {
    return { ok: false, error: `gateway_route_check_failed: ${e && e.message ? e.message : String(e)}` };
  }
}

async function workflowPromotionPreflight(root, args, target, ctx) {
  const skillId = String(args && args.skillId ? args.skillId : '').trim();
  const skill = readSkillById(root, skillId);
  const targetConfig =
    target === 'script_hub_tool'
      ? {
          plannedTool: 'ac.workflow.promote_script_hub_tool',
          requiredGates: [
            'skill_draft_exists',
            'script_manifest_valid',
            'script_hub_permission_checked',
            'sandbox_policy_checked',
            'admin_confirmation',
            'audit_record_written',
          ],
          targetName: String(args && args.toolName ? args.toolName : skill && skill.name ? skill.name : skillId),
        }
      : {
          plannedTool: 'ac.workflow.promote_workbench_preset',
          requiredGates: [
            'skill_draft_exists',
            'capability_route_schema_valid',
            'workbench_login_e2e_ready',
            'model_provider_readiness_checked',
            'admin_confirmation',
            'audit_record_written',
          ],
          targetName: String(args && args.presetName ? args.presetName : skill && skill.name ? skill.name : skillId),
        };
  const passed = skill ? ['skill_draft_exists'] : [];
  let workbenchPreset = null;
  let modelProviderReadiness = null;
  let scriptManifest = null;
  if (skill && target === 'workbench_preset') {
    const validation = validateWorkbenchPresetRouteSchema(skill.workbenchPreset);
    workbenchPreset = validation;
    if (validation.ok) {
      passed.push('capability_route_schema_valid');
      modelProviderReadiness = await resolveWorkbenchPresetModelProviderReadiness(validation.routeSchema);
      if (modelProviderReadiness.ok) passed.push('model_provider_readiness_checked');
    }
  }
  if (skill && target === 'script_hub_tool') {
    const validation = validateScriptHubManifest(skill.scriptManifest);
    scriptManifest = validation;
    if (validation.ok) {
      passed.push('script_manifest_valid');
      if (validation.checks && validation.checks.script_hub_permission_checked) passed.push('script_hub_permission_checked');
      if (validation.checks && validation.checks.sandbox_policy_checked) passed.push('sandbox_policy_checked');
    }
  }
  if (ctx && ctx.adminConfirmationPassed === true) passed.push('admin_confirmation');
  if (ctx && (ctx.auditRecordWritten === true || ctx.toolCallId)) passed.push('audit_record_written');
  const missing = targetConfig.requiredGates.filter((gate) => !passed.includes(gate));
  const adminConfirmationPassed = passed.includes('admin_confirmation');
  const gateDetails = targetConfig.requiredGates.map((gate) => ({
    id: gate,
    status: passed.includes(gate) ? 'passed' : 'missing',
    owner: gate === 'admin_confirmation' ? 'admin' : gate === 'workbench_login_e2e_ready' ? 'user' : 'system',
  }));
  return {
    ok: false,
    code: skill ? 'AGENT_WORKFLOW_PROMOTION_NOT_READY' : 'AGENT_SKILL_NOT_FOUND',
    message: skill
      ? 'Workflow promotion is registered but blocked until governed promotion gates pass.'
      : `Skill/workflow not found: ${skillId}`,
    publishable: false,
    currentPhase: 'draft_only',
    target,
    plannedTool: targetConfig.plannedTool,
    skillId,
    targetName: targetConfig.targetName,
    skill: skill
      ? {
          id: skill.id,
          name: skill.name,
          revision: skill.revision,
          resourceUri: `skill://${skill.id}`,
        }
      : null,
    requiredGates: targetConfig.requiredGates,
    passedGates: passed,
    missingGates: missing,
    gateDetails,
    adminConfirmation: {
      required: true,
      passed: adminConfirmationPassed,
      sourceRequired: 'copilot_ui',
      source: ctx && ctx.adminConfirmationSource ? String(ctx.adminConfirmationSource) : '',
      policyDecision: ctx && ctx.policyDecision ? String(ctx.policyDecision) : '',
      autoConfirmCountsAsAdminApproval: false,
      nextStep: adminConfirmationPassed
        ? 'Admin approval was captured through the Copilot frontend for this preflight.'
        : 'Ask an admin to approve this confirm-risk promotion call in the Copilot frontend.',
    },
    ...(workbenchPreset ? { workbenchPreset } : {}),
    ...(modelProviderReadiness ? { modelProviderReadiness } : {}),
    ...(scriptManifest ? { scriptManifest } : {}),
    nextStep: skill
      ? 'Finish the missing gates before enabling this promotion path: ' + missing.join(', ') + '.'
      : 'Save the workflow draft with ac.skills.save before requesting promotion.',
  };
}

/**
 * @param {{
 *   getShellView: () => string;
 *   navigateShell: (view: string) => Promise<{ ok: boolean; error?: string }>;
 *   companionApiRequest: (method: string, pathname: string, body?: unknown, opts?: object) => Promise<{ ok: boolean; json?: unknown; text?: string; error?: string }>;
 *   getStateSummary: () => Promise<Record<string, unknown>>;
 *   shellLogin?: (args: { identifier: string; password: string }) => Promise<object>;
 *   workbenchClient?: ReturnType<import('./agent-workbench-client.cjs').createAgentWorkbenchClient>;
 *   scriptHubClient?: ReturnType<import('./agent-script-hub-client.cjs').createAgentScriptHubClient>;
 *   runShellTool?: (toolId: string) => Promise<{ ok: boolean; error?: string }>;
 *   runShellBootstrap?: (engine: string, opts?: object) => Promise<{ ok: boolean; error?: string; detail?: unknown }>;
 *   uploadCopilotUsageCloudDraft?: (opts?: object) => Promise<object>;
 *   probeCopilotUsageQuotaPolicy?: () => Promise<object>;
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

      if (name === 'ac.shell.login') {
        if (typeof deps.shellLogin !== 'function') {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_SHELL_LOGIN_UNAVAILABLE', message: 'shell login is unavailable' },
          };
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.shellLogin({
          identifier: String(safeArgs.identifier || ''),
          password: String(safeArgs.password || ''),
        });
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (!r || r.ok === false) {
          return {
            ok: false,
            content: JSON.stringify({ ...(r || {}), password: undefined }),
            error: {
              code: (r && r.code) || 'AGENT_SHELL_LOGIN_FAILED',
              message: (r && (r.error || r.message)) || 'shell login failed',
            },
          };
        }
        return {
          ok: true,
          content: JSON.stringify({
            ok: true,
            account: r.account || null,
            statusCode: r.statusCode || 0,
            cookieNames: Array.isArray(r.cookieNames) ? r.cookieNames : [],
          }),
          structured: {
            ok: true,
            account: r.account || null,
            statusCode: r.statusCode || 0,
            cookieNames: Array.isArray(r.cookieNames) ? r.cookieNames : [],
          },
        };
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

      if (name === 'ac.workbench.ensure_ready') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.ensureReady(safeArgs);
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

      if (name === 'ac.workbench.create_project') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.createProject(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.workbench.list_assets') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.listAssets(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.workbench.get_asset') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.getAsset(safeArgs);
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

      if (name === 'ac.skills.save') {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const r = saveSkill(root, safeArgs);
        if (!r.ok) {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_SKILL_SAVE_FAILED', message: r.error || 'save failed' },
          };
        }
        return {
          ok: true,
          content: JSON.stringify(
            {
              skill: r.skill,
              resourceUri: r.resourceUri,
              promptName: r.promptName,
            },
            null,
            2,
          ),
          structured: {
            skill: r.skill,
            resourceUri: r.resourceUri,
            promptName: r.promptName,
          },
        };
      }

      if (name === 'ac.skills.revisions') {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const r = listSkillRevisions(root, safeArgs.skillId);
        if (!r.ok) {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_SKILL_REVISIONS_FAILED', message: r.error || 'list revisions failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r, null, 2), structured: r };
      }

      if (name === 'ac.skills.revision_get') {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const r = readSkillRevision(root, safeArgs.skillId, safeArgs.revision);
        if (!r.ok) {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_SKILL_REVISION_GET_FAILED', message: r.error || 'read revision failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r, null, 2), structured: r };
      }

      if (name === 'ac.skills.delete') {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const r = deleteSkill(root, safeArgs.skillId);
        if (!r.ok) {
          return {
            ok: false,
            content: '',
            error: { code: 'AGENT_SKILL_DELETE_FAILED', message: r.error || 'delete failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r, null, 2), structured: r };
      }

      if (name === 'ac.workflow.promote_workbench_preset' || name === 'ac.workflow.promote_script_hub_tool') {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const target = name === 'ac.workflow.promote_script_hub_tool' ? 'script_hub_tool' : 'workbench_preset';
        const r = await workflowPromotionPreflight(root, safeArgs, target, ctx);
        return {
          ok: false,
          content: JSON.stringify(r, null, 2),
          structured: r,
          error: { code: r.code, message: r.message },
        };
      }

      if (name === 'ac.usage.upload_cloud_draft') {
        if (typeof deps.uploadCopilotUsageCloudDraft !== 'function') {
          return toolUnavailable('usage_cloud_upload');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.uploadCopilotUsageCloudDraft({
          days: safeArgs.days,
          limit: safeArgs.limit,
          dryRun: Boolean(safeArgs.dryRun),
        });
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const ok = Boolean(r && r.ok);
        return {
          ok,
          content: JSON.stringify(r, null, 2),
          structured: r,
          ...(ok
            ? {}
            : {
                error: {
                  code: r && r.code ? String(r.code) : 'AGENT_USAGE_UPLOAD_FAILED',
                  message: r && r.message ? String(r.message) : 'usage upload failed',
                },
              }),
        };
      }

      if (name === 'ac.usage.probe_quota_policy') {
        if (typeof deps.probeCopilotUsageQuotaPolicy !== 'function') {
          return toolUnavailable('usage_quota_policy_probe');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.probeCopilotUsageQuotaPolicy();
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const ok = Boolean(r && r.ok);
        return {
          ok,
          content: JSON.stringify(r, null, 2),
          structured: r,
          ...(ok
            ? {}
            : {
                error: {
                  code: r && r.code ? String(r.code) : 'AGENT_USAGE_POLICY_PROBE_FAILED',
                  message: r && r.message ? String(r.message) : 'usage policy probe failed',
                },
              }),
        };
      }

      if (name === 'ac.memory.list') {
        const root = typeof deps.getMemoryRoot === 'function' ? deps.getMemoryRoot() : '';
        let notes = safeArgs.projectId
          ? listProjectMemoryNotes(root, {
              projectId: safeArgs.projectId,
              kind: safeArgs.kind,
              includeDisabled: Boolean(safeArgs.includeDisabled),
            })
          : listMemoryNotes(root);
        const limit = Number(safeArgs.limit);
        if (Number.isFinite(limit) && limit > 0) {
          notes = notes.slice(-Math.min(100, Math.floor(limit)));
        }
        return { ok: true, content: JSON.stringify(notes, null, 2), structured: { notes } };
      }

      if (name === 'ac.memory.append') {
        const root = typeof deps.getMemoryRoot === 'function' ? deps.getMemoryRoot() : '';
        const r = safeArgs.projectId
          ? appendProjectMemoryNote(root, {
              projectId: safeArgs.projectId,
              projectName: safeArgs.projectName,
              kind: safeArgs.kind,
              text: safeArgs.text,
              tags: safeArgs.tags,
              source: 'ac.memory.append',
              contextEnabled: safeArgs.contextEnabled !== false,
            })
          : appendMemoryNote(root, { text: safeArgs.text, tags: safeArgs.tags, source: 'ac.memory.append' });
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
  buildToolCatalog,
};
