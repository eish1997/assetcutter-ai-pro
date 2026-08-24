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

const VALID_SHELL_VIEWS = new Set(['home', 'workbench', 'workflow', 'tools', 'connections', 'settings']);

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

function hostBridgeAcceptanceInstruction(groupId, hostId) {
  const id = String(hostId || '').trim();
  const host = id || 'this host';
  const commonRule = '只在真实软件启动并产生 HTTP health、heartbeat、command port 或插件回调后记录通过。';
  const byGroup = {
    maya: {
      instruction: `打开 ${host}，一键安装桥接后重启宿主，再探测 Command Port。`,
      steps: ['确认 scripts 目录或已保存版本目录', '点击一键安装', '打开或重启宿主', '点击探测连接', '探测成功后记录真实版本、路径和端口证据'],
      evidence: 'Command Port 可连接，并能返回真实宿主响应。',
    },
    adobe: {
      instruction: `打开 ${host}，安装 ExtendScript 桥接，重启或在宿主内运行脚本，再探测 heartbeat。`,
      steps: ['确认 Adobe 宿主版本和脚本目录', '点击一键安装', '重启宿主或运行已安装 JSX', '点击探测连接', 'heartbeat 新鲜且 host id 匹配后记录证据'],
      evidence: 'heartbeat 文件新鲜、内容有效，并且 host id 与当前 Adobe 宿主匹配。',
    },
    python_dcc: {
      instruction: `打开 ${host}，安装 Python HTTP 桥接，重启宿主或加载启动脚本，再探测 /health。`,
      steps: ['确认宿主版本或启动脚本目录', '点击一键安装', '打开或重启宿主', '确认 Python 桥接脚本已加载', '点击探测连接并记录 /health 成功证据'],
      evidence: '本机 HTTP /health 返回真实宿主名称或版本信息。',
    },
    lua_heartbeat: {
      instruction: `打开 ${host}，安装 Lua/脚本桥接，在宿主内运行脚本后探测 heartbeat。`,
      steps: ['确认脚本目录属于当前宿主', '点击一键安装', '在宿主内运行安装的脚本或菜单项', '点击探测连接', 'heartbeat 新鲜且 host id 匹配后记录证据'],
      evidence: 'heartbeat 文件由当前宿主刚刚写入，时间新鲜且内容有效。',
    },
    project_plugin: {
      instruction: `选择真实 ${host} 项目，安装项目插件，打开项目并加载插件后探测连接。`,
      steps: ['选择包含真实项目文件的项目根目录', '点击一键安装', '打开项目并允许插件加载或重新编译', '必要时在项目设置中启用插件', '点击探测连接并记录插件回调证据'],
      evidence: '项目内插件已加载，并返回真实 HTTP health 或插件回调。',
    },
    manual_script_dir: {
      instruction: `为 ${host} 选择真实脚本目录，安装脚本，在宿主内运行后探测 heartbeat。`,
      steps: ['手动选择该宿主真实脚本目录', '确认不是上级目录、缓存目录或其它软件目录', '点击一键安装', '在宿主内运行安装脚本', '点击探测连接并记录 heartbeat 证据'],
      evidence: '脚本由当前宿主执行并产生新鲜 heartbeat。',
    },
    paired_software: {
      instruction: `打开 ${host}，确认成对软件安装、探测、卸载都只影响自己，不覆盖另一款软件。`,
      steps: ['确认当前选择的是目标软件自己的目录', '点击一键安装', '打开当前宿主并运行桥接', '点击探测连接', '检查成对软件的脚本文件未被覆盖后记录证据'],
      evidence: '当前宿主连接成功，且成对软件文件没有被当前操作覆盖。',
    },
  };
  const guide = byGroup[String(groupId || '').trim()] || {
    instruction: `打开 ${host}，安装并探测桥接，只用真实连接信号记录验收。`,
    steps: ['点击一键安装', '打开或重启宿主', '点击探测连接', '记录真实连接证据'],
    evidence: '真实宿主连接信号。',
  };
  return { ...guide, rule: commonRule };
}

const HOST_BRIDGE_INSTALL_TARGET_FIELDS = {
  maya: ['scriptsDirs'],
  blender: ['startupDirs'],
  '3ds-max': ['startupDirs'],
  motionbuilder: ['startupDirs'],
  'substance-painter': ['pluginDirs'],
  krita: ['pluginDirs'],
  gimp: ['pluginDirs'],
  inkscape: ['extensionsDirs'],
  houdini: ['prefsDirs'],
  nuke: ['userDirs'],
  'nuke-studio': ['userDirs'],
  hiero: ['userDirs'],
  natron: ['userDirs'],
  unity: ['projectDirs'],
  unreal: ['projectDirs'],
  godot: ['projectDirs'],
  'fusion-360': ['addinDirs'],
  freecad: ['modDirs'],
  autocad: ['supportDirs'],
  'lightroom-classic': ['modulesDirs'],
  darktable: ['configDirs'],
};

function buildHostBridgeInstallBody(hostId, args) {
  const id = String(hostId || '').trim();
  const targetDir = String((args && args.targetDir) || '').trim();
  const body = {
    targetDir,
    port: args && typeof args.port === 'number' ? args.port : undefined,
  };
  if (targetDir) {
    const fields = HOST_BRIDGE_INSTALL_TARGET_FIELDS[id] || ['scriptsDirs'];
    for (const field of fields) body[field] = [targetDir];
  }
  return body;
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
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    if (
      a[key] != null &&
      prop &&
      typeof prop === 'object' &&
      Array.isArray(prop.enum) &&
      !prop.enum.includes(a[key])
    ) {
      return { ok: false, error: `invalid ${key}` };
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

function normalizeCapabilityDraftId(seed, fallbackPrefix) {
  const normalized = String(seed || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  if (/^[a-z][a-z0-9._-]{1,62}$/.test(normalized)) return normalized;
  const prefix = /^[a-z][a-z0-9-]{1,24}$/.test(String(fallbackPrefix || 'capability'))
    ? String(fallbackPrefix)
    : 'capability';
  return `${prefix}-${Date.now().toString(36).slice(-6)}`;
}

function inferCapabilityDraftType(args) {
  const explicit = String(args && args.type ? args.type : '').trim();
  if (explicit === 'tool' || explicit === 'software_connection' || explicit === 'workflow') return explicit;
  const text = `${String(args?.name || '')} ${String(args?.intent || '')} ${String(args?.description || '')}`.toLowerCase();
  if (/工具流|工作流|流程|自动化|workflow|flow|pipeline|automation/.test(text)) return 'workflow';
  if (/连接|宿主|软件|打开|启动|photoshop|maya|blender|unity|unreal|spine|connect|connection|host|software/.test(text)) {
    return 'software_connection';
  }
  if (/工具|插件|脚本|小工具|tool|plugin|script|utility/.test(text)) return 'tool';
  return 'software_connection';
}

function buildConnectionTemplateDraft(args) {
  const hostId = normalizeCapabilityDraftId(String((args && (args.hostId || args.appName)) || 'unknown-host'), 'host');
  const list = (value) => (Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12) : []);
  const allowedKind = new Set(['executable', 'script_dcc', 'project_plugin', 'command_port', 'heartbeat', 'unknown']);
  const kind = allowedKind.has(String(args && args.kind)) ? String(args.kind) : 'unknown';
  const appName = String((args && args.appName) || (args && args.hostId) || hostId).trim() || hostId;
  const defaultsByKind = {
    executable: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`],
      requiredUserDirs: ['软件安装目录或可执行文件路径'],
      probeSignal: '目标软件真实进程存在，且可由白名单 hostId 匹配到可执行文件路径',
      safetyBoundaries: ['只能启动用户确认过的可执行文件路径', '不能把进程存在当作桥接已连通', '未真实 probe 前不能发布云端正式版本'],
    },
    script_dcc: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-heartbeat.js`],
      requiredUserDirs: ['宿主脚本目录或用户插件目录'],
      probeSignal: `${appName} 内运行脚本后写入的新鲜 heartbeat 文件`,
      safetyBoundaries: ['只写入用户选择的脚本目录', 'heartbeat 必须由真实宿主脚本生成', '未真实验收前不能写入生产 bridge definition'],
    },
    project_plugin: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-project-plugin/`],
      requiredUserDirs: ['真实项目根目录'],
      probeSignal: `${appName} 项目插件加载后返回的 HTTP health 或插件回调`,
      safetyBoundaries: ['只修改用户选择的项目目录', '不能跨项目安装', '插件未加载前不能标记 connected'],
    },
    command_port: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-command-port.js`],
      requiredUserDirs: ['宿主脚本目录或启动脚本目录'],
      probeSignal: `${appName} command port 返回真实宿主响应`,
      safetyBoundaries: ['端口必须绑定本机', '命令必须走白名单', '不能用端口打开但无宿主响应冒充成功'],
    },
    heartbeat: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-heartbeat.js`],
      requiredUserDirs: ['宿主脚本目录'],
      probeSignal: `${appName} 写入的新鲜 heartbeat 文件，内容包含 hostId 和时间戳`,
      safetyBoundaries: ['heartbeat 必须新鲜且 hostId 匹配', '不能用历史 heartbeat 冒充成功', '未真实运行宿主前不能发布'],
    },
    unknown: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`],
      requiredUserDirs: ['待 Copilot 与用户确认的软件目录或脚本目录'],
      probeSignal: '真实软件进程、HTTP health、command port 或 heartbeat 信号',
      safetyBoundaries: ['先识别软件形态再生成正式模板', '不能把文件存在或安装记录当作连接成功', '未真实验收前不能发布云端正式版本'],
    },
  };
  const defaults = defaultsByKind[kind] || defaultsByKind.unknown;
  const safetyBoundaries = list(args && args.safetyBoundaries);
  return {
    schemaVersion: 1,
    status: 'draft',
    hostId,
    appName,
    kind,
    files: list(args && args.files).length ? list(args && args.files) : defaults.files,
    requiredUserDirs: list(args && args.requiredUserDirs).length ? list(args && args.requiredUserDirs) : defaults.requiredUserDirs,
    probeSignal: String((args && args.probeSignal) || '').trim() || defaults.probeSignal,
    safetyBoundaries: safetyBoundaries.length
      ? safetyBoundaries
      : defaults.safetyBoundaries,
    notes: String((args && args.notes) || '').trim(),
    productionDefinition: false,
  };
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

      if (name === 'ac.workbench.create_text_asset') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.createTextAsset(safeArgs);
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        return out;
      }

      if (name === 'ac.workbench.create_image_asset') {
        if (!deps.workbenchClient) {
          return toolUnavailable('workbench_client');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const out = await deps.workbenchClient.createImageAsset(safeArgs);
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

      if (name === 'ac.shell_tool.list') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const installed = await deps.companionApiRequest('GET', '/v1/shell-tools', null, httpOpts(ctx, { timeoutMs: 15000 }));
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const authored = await deps.companionApiRequest('GET', '/v1/shell-tools/authored', null, httpOpts(ctx, { timeoutMs: 15000 }));
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const payload = {
          installed: installed.ok ? installed.json?.tools || [] : [],
          authored: authored.ok ? authored.json?.tools || [] : [],
          installedError: installed.ok ? null : installed.text || 'list failed',
          authoredError: authored.ok ? null : authored.text || 'list failed',
        };
        return { ok: true, content: JSON.stringify(payload, null, 2), structured: payload };
      }

      if (name === 'ac.shell_tool.scaffold') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const body = {
          id: String(safeArgs.id || '').trim(),
          name: safeArgs.name != null ? String(safeArgs.name) : undefined,
          description: safeArgs.description != null ? String(safeArgs.description) : undefined,
          tags: Array.isArray(safeArgs.tags) ? safeArgs.tags.map(String) : undefined,
          overwrite: Boolean(safeArgs.overwrite),
          install: true,
        };
        const r = await deps.companionApiRequest(
          'POST',
          '/v1/shell-tools/authored/scaffold',
          body,
          httpOpts(ctx, { timeoutMs: 60000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_SHELL_TOOL_SCAFFOLD_FAILED', message: r.text || 'scaffold failed' },
          };
        }
        const toolId = r.json?.toolId;
        if (toolId) {
          try {
            await deps.companionApiRequest(
              'POST',
              '/v1/capability-packages/drafts',
              {
                id: String(toolId),
                type: 'tool',
                name: body.name || String(toolId),
                description: body.description || '',
                tags: body.tags,
                semver: '0.1.0',
                manifest: {
                  authoredToolId: String(toolId),
                  authoredPath: r.json?.path || '',
                },
                createdBy: 'copilot',
              },
              httpOpts(ctx, { timeoutMs: 30000 }),
            );
          } catch {
            /* Tool scaffold remains valid; capability draft sync can be retried. */
          }
        }
        if (safeArgs.open !== false && toolId && typeof deps.runShellTool === 'function') {
          await deps.runShellTool(String(toolId));
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.shell_tool.authored_upsert') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const files = Array.isArray(safeArgs.files)
          ? safeArgs.files.map((f) => ({
              path: String(f?.path || ''),
              content: String(f?.content ?? ''),
            }))
          : [];
        const r = await deps.companionApiRequest(
          'POST',
          '/v1/shell-tools/authored',
          { toolId: String(safeArgs.toolId || '').trim(), files },
          httpOpts(ctx, { timeoutMs: 60000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_SHELL_TOOL_UPSERT_FAILED', message: r.text || 'upsert failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.draft_create') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const body = {
          id: safeArgs.id ? String(safeArgs.id).trim() : undefined,
          type: safeArgs.type ? String(safeArgs.type).trim() : 'software_connection',
          name: String(safeArgs.name || '').trim(),
          appName: safeArgs.appName ? String(safeArgs.appName).trim() : undefined,
          description: safeArgs.description ? String(safeArgs.description).trim() : undefined,
          tags: Array.isArray(safeArgs.tags) ? safeArgs.tags.map(String).filter(Boolean) : undefined,
          templateHint: safeArgs.templateHint ? String(safeArgs.templateHint).trim() : undefined,
          semver: safeArgs.semver ? String(safeArgs.semver).trim() : undefined,
          createdBy: 'copilot',
        };
        const r = await deps.companionApiRequest(
          'POST',
          '/v1/capability-packages/drafts',
          body,
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_DRAFT_CREATE_FAILED', message: r.text || 'capability draft create failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.create_draft') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const inferredType = inferCapabilityDraftType(safeArgs);
        const baseName = String(safeArgs.name || '').trim();
        const intent = String(safeArgs.intent || '').trim();
        const idSeed =
          inferredType === 'software_connection'
            ? String(safeArgs.appName || baseName || intent).trim()
            : `${baseName} ${intent}`;
        const id = safeArgs.id
          ? normalizeCapabilityDraftId(safeArgs.id, inferredType === 'tool' ? 'tool' : inferredType === 'workflow' ? 'workflow' : 'connection')
          : normalizeCapabilityDraftId(idSeed, inferredType === 'tool' ? 'tool' : inferredType === 'workflow' ? 'workflow' : 'connection');
        if (inferredType === 'tool') {
          const body = {
            id,
            name: baseName || id,
            description: safeArgs.description ? String(safeArgs.description).trim() : intent || 'Copilot 创建的本机工具',
            tags: Array.isArray(safeArgs.tags) ? safeArgs.tags.map(String).filter(Boolean) : undefined,
            overwrite: false,
            install: true,
          };
          const scaffold = await deps.companionApiRequest(
            'POST',
            '/v1/shell-tools/authored/scaffold',
            body,
            httpOpts(ctx, { timeoutMs: 60000 }),
          );
          aborted = abortIfNeeded(ctx);
          if (aborted) return aborted;
          if (scaffold.error === 'aborted') return abortedToolResult();
          if (!scaffold.ok) {
            return {
              ok: false,
              content: scaffold.text || '',
              error: { code: 'AGENT_CAPABILITY_CREATE_TOOL_FAILED', message: scaffold.text || 'capability tool create failed' },
            };
          }
          const toolId = String(scaffold.json?.toolId || id);
          let context = null;
          try {
            const contextResult = await deps.companionApiRequest(
              'GET',
              `/v1/capability-packages/${encodeURIComponent(toolId)}/context`,
              null,
              httpOpts(ctx, { timeoutMs: 30000 }),
            );
            if (contextResult.ok) context = contextResult.json;
          } catch {
            /* The created tool is still valid; context can be fetched later. */
          }
          if (safeArgs.open !== false && toolId && typeof deps.runShellTool === 'function') {
            await deps.runShellTool(toolId);
          }
          const structured = { ok: true, type: 'tool', id: toolId, tool: scaffold.json, context };
          return { ok: true, content: JSON.stringify(structured, null, 2), structured };
        }

        if (inferredType === 'workflow') {
          const body = {
            id,
            type: 'workflow',
            name: baseName || id,
            description: safeArgs.description ? String(safeArgs.description).trim() : intent || undefined,
            tags: Array.isArray(safeArgs.tags) ? safeArgs.tags.map(String).filter(Boolean) : undefined,
            semver: safeArgs.semver ? String(safeArgs.semver).trim() : undefined,
            manifest: { intent },
            createdBy: 'copilot',
          };
          const draft = await deps.companionApiRequest(
            'POST',
            '/v1/capability-packages/drafts',
            body,
            httpOpts(ctx, { timeoutMs: 30000 }),
          );
          aborted = abortIfNeeded(ctx);
          if (aborted) return aborted;
          if (draft.error === 'aborted') return abortedToolResult();
          if (!draft.ok) {
            return {
              ok: false,
              content: draft.text || '',
              error: { code: 'AGENT_CAPABILITY_CREATE_WORKFLOW_FAILED', message: draft.text || 'capability workflow create failed' },
            };
          }
          let context = null;
          try {
            const contextResult = await deps.companionApiRequest(
              'GET',
              `/v1/capability-packages/${encodeURIComponent(id)}/context`,
              null,
              httpOpts(ctx, { timeoutMs: 30000 }),
            );
            if (contextResult.ok) context = contextResult.json;
          } catch {
            /* The created workflow is still valid; context can be fetched later. */
          }
          const structured = { ok: true, type: 'workflow', id, draft: draft.json, context };
          return { ok: true, content: JSON.stringify(structured, null, 2), structured };
        }

        const body = {
          id,
          type: 'software_connection',
          name: baseName || String(safeArgs.appName || id).trim() || id,
          appName: safeArgs.appName ? String(safeArgs.appName).trim() : baseName || undefined,
          description: safeArgs.description ? String(safeArgs.description).trim() : intent || undefined,
          tags: Array.isArray(safeArgs.tags) ? safeArgs.tags.map(String).filter(Boolean) : undefined,
          templateHint: safeArgs.templateHint ? String(safeArgs.templateHint).trim() : undefined,
          createdBy: 'copilot',
        };
        const draft = await deps.companionApiRequest(
          'POST',
          '/v1/capability-packages/drafts',
          body,
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (draft.error === 'aborted') return abortedToolResult();
        if (!draft.ok) {
          return {
            ok: false,
            content: draft.text || '',
            error: { code: 'AGENT_CAPABILITY_CREATE_CONNECTION_FAILED', message: draft.text || 'capability connection create failed' },
          };
        }
        let context = null;
        try {
          const contextResult = await deps.companionApiRequest(
            'GET',
            `/v1/capability-packages/${encodeURIComponent(id)}/context`,
            null,
            httpOpts(ctx, { timeoutMs: 30000 }),
          );
          if (contextResult.ok) context = contextResult.json;
        } catch {
          /* The created connection is still valid; context can be fetched later. */
        }
        const structured = { ok: true, type: 'software_connection', id, draft: draft.json, context };
        return { ok: true, content: JSON.stringify(structured, null, 2), structured };
      }

      if (name === 'ac.capability.draft_list') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const r = await deps.companionApiRequest(
          'GET',
          '/v1/capability-packages/drafts',
          null,
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_DRAFT_LIST_FAILED', message: r.text || 'capability draft list failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.validate_draft') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/capability-packages/${encodeURIComponent(id)}/lifecycle`,
          { action: 'validate' },
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_VALIDATE_FAILED', message: r.text || 'capability validation failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.context_get') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'GET',
          `/v1/capability-packages/${encodeURIComponent(id)}/context`,
          null,
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_CONTEXT_FAILED', message: r.text || 'capability context failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.event_append') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/capability-packages/${encodeURIComponent(id)}/events`,
          {
            kind: String(safeArgs.kind || '').trim(),
            ok: safeArgs.ok === true,
            message: safeArgs.message ? String(safeArgs.message) : '',
            detail: safeArgs.detail && typeof safeArgs.detail === 'object' ? safeArgs.detail : undefined,
          },
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_EVENT_APPEND_FAILED', message: r.text || 'capability event append failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.template_draft_create') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const templateDraft = buildConnectionTemplateDraft(safeArgs);
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/capability-packages/${encodeURIComponent(id)}/events`,
          {
            kind: 'connection_template_draft_created',
            ok: false,
            message: `已为 ${templateDraft.appName} 生成连接模板草稿，等待真实软件验收。`,
            detail: {
              templateDraft,
              notProductionDefinition: true,
              publishBlockedUntilRealProbe: true,
            },
          },
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_TEMPLATE_DRAFT_CREATE_FAILED', message: r.text || 'template draft create failed' },
          };
        }
        const structured = { ok: true, id, templateDraft, event: r.json };
        return { ok: true, content: JSON.stringify(structured, null, 2), structured };
      }

      if (name === 'ac.capability.lifecycle_run') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const body = {
          action: String(safeArgs.action || '').trim(),
          targetDir: safeArgs.targetDir ? String(safeArgs.targetDir).trim() : undefined,
          executablePath: safeArgs.executablePath ? String(safeArgs.executablePath).trim() : undefined,
          targetId: safeArgs.targetId ? String(safeArgs.targetId).trim() : undefined,
          currentStrategyId: safeArgs.currentStrategyId ? String(safeArgs.currentStrategyId).trim() : undefined,
          actionId: safeArgs.actionId ? String(safeArgs.actionId).trim() : undefined,
          params: safeArgs.params && typeof safeArgs.params === 'object' ? safeArgs.params : undefined,
          actorRole: safeArgs.actorRole ? String(safeArgs.actorRole).trim() : undefined,
          isAdmin: safeArgs.isAdmin === true,
          semver: safeArgs.semver ? String(safeArgs.semver).trim() : undefined,
          versionId: safeArgs.versionId ? String(safeArgs.versionId).trim() : undefined,
          versionNote: safeArgs.versionNote ? String(safeArgs.versionNote).trim() : undefined,
          publishedBy: safeArgs.publishedBy ? String(safeArgs.publishedBy).trim() : undefined,
        };
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/capability-packages/${encodeURIComponent(id)}/lifecycle`,
          body,
          httpOpts(ctx, { timeoutMs: body.action === 'run' || body.action === 'install' || body.action === 'launch' ? 60000 : 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_LIFECYCLE_FAILED', message: r.text || 'capability lifecycle failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.connection_loop_run') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const goal = String(safeArgs.goal || '').trim();
        const permissions = Array.isArray(safeArgs.permissions) ? safeArgs.permissions.map(String) : [];
        const permissionSet = new Set(permissions);
        const maxStepsRaw = Number(safeArgs.maxSteps || 6);
        const maxSteps = Math.max(1, Math.min(Number.isFinite(maxStepsRaw) ? Math.floor(maxStepsRaw) : 6, 8));
        const steps = [];
        const runStep = async (label, request) => {
          if (steps.length >= maxSteps) return null;
          let response;
          try {
            response = await request();
          } catch (error) {
            response = { ok: false, text: error instanceof Error ? error.message : String(error) };
          }
          const body = response && response.json ? response.json : null;
          const message =
            (body && (body.message || body.error || (body.result && body.result.message))) ||
            (response && response.text) ||
            '';
          const step = {
            label,
            ok: Boolean(response && response.ok && (!body || body.ok !== false)),
            status: response && response.status,
            message,
            body,
          };
          steps.push(step);
          return step;
        };
        const lifecycle = (action, payload = {}, timeoutMs = 30000) =>
          deps.companionApiRequest(
            'POST',
            `/v1/capability-packages/${encodeURIComponent(id)}/lifecycle`,
            { action, ...payload },
            httpOpts(ctx, { timeoutMs }),
          );
        const readContext = () =>
          deps.companionApiRequest(
            'GET',
            `/v1/capability-packages/${encodeURIComponent(id)}/context`,
            null,
            httpOpts(ctx, { timeoutMs: 30000 }),
          );
        const lifecycleActionForStep = {
          'process.discover': 'discover_running',
          'process.launch': 'launch',
          'bridge.install': 'install',
          'connection.probe': 'probe',
          'conversation.open': 'open_conversation',
        };
        const plannedStepsForMaturity = (maturity) => {
          if (maturity === 'connected') return ['event.write.loop_summary'];
          if (maturity === 'template_missing') return ['event.write.loop_summary', 'conversation.open'];
          if (maturity === 'strategy_draft') return ['event.write.strategy_failed', 'event.write.strategy_next_selected', 'conversation.open'];
          if (maturity === 'probe_failed') return ['event.write.loop_summary', 'conversation.open'];
          if (maturity === 'bridge_installed') return ['connection.probe', 'event.write.loop_summary'];
          if (maturity === 'bridge_supported') return ['bridge.install', 'event.write.loop_summary'];
          if (maturity === 'path_ready' || maturity === 'process_ready') return ['process.discover', 'process.launch', 'event.write.loop_summary'];
          return ['event.write.loop_summary', 'conversation.open'];
        };
        const stepPermission = (label) => {
          if (label === 'event.write.loop_summary') return 'event.write';
          if (label === 'event.write.strategy_failed') return 'event.write';
          if (label === 'event.write.strategy_next_selected') return 'event.write';
          return label;
        };

        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        await runStep('validate', () => lifecycle('validate'));
        const initialContextStep = permissionSet.has('context.read') ? await runStep('context.read.initial', readContext) : null;
        const initialContext = initialContextStep && initialContextStep.body;
        const connectionState = initialContext && initialContext.connectionState && typeof initialContext.connectionState === 'object'
          ? initialContext.connectionState
          : null;
        const maturity = String((connectionState && connectionState.maturity) || 'unknown');
        const strategyDraft = initialContext && initialContext.strategyDraft && typeof initialContext.strategyDraft === 'object'
          ? initialContext.strategyDraft
          : null;
        const candidateStrategies = strategyDraft && Array.isArray(strategyDraft.candidateStrategies)
          ? strategyDraft.candidateStrategies
          : [];
        const failedStrategyIds = new Set(
          [
            ...(Array.isArray(safeArgs.failedStrategyIds) ? safeArgs.failedStrategyIds.map(String) : []),
            safeArgs.failedStrategyId ? String(safeArgs.failedStrategyId) : '',
          ].filter(Boolean),
        );
        const currentStrategy =
          (safeArgs.currentStrategyId
            ? candidateStrategies.find((strategy) => strategy && strategy.id === String(safeArgs.currentStrategyId))
            : null) ||
          (safeArgs.failedStrategyId
            ? candidateStrategies.find((strategy) => strategy && strategy.id === String(safeArgs.failedStrategyId))
            : null) ||
          (strategyDraft && strategyDraft.recommendedNextStrategy) ||
          null;
        const nextCandidateStrategy =
          candidateStrategies.find((strategy) => strategy && strategy.id && !failedStrategyIds.has(String(strategy.id))) || null;
        const plannedSteps = plannedStepsForMaturity(maturity).filter((label) => permissionSet.has(stepPermission(label)));
        for (const label of plannedSteps) {
          if (label === 'event.write.loop_summary') {
            const actionSteps = steps.filter((step) => step && !/^context\.read/.test(step.label) && step.label !== 'validate');
            const loopOk =
              maturity === 'connected' ||
              (actionSteps.length > 0 && actionSteps.every((step) => step.ok) && maturity !== 'template_missing' && maturity !== 'probe_failed');
            const eventKind =
              maturity === 'template_missing'
                ? 'connection_loop_template_missing'
                : loopOk
                  ? 'connection_loop_passed'
                  : 'connection_loop_failed';
            await runStep('event.write.loop_summary', () =>
              deps.companionApiRequest(
                'POST',
                `/v1/capability-packages/${encodeURIComponent(id)}/events`,
                {
                  kind: eventKind,
                  ok: loopOk,
                  message: goal || (connectionState && connectionState.nextAction) || 'Connection loop run completed.',
                  detail: {
                    maturity,
                    permissions,
                    plannedSteps,
                    architecture:
                      maturity === 'template_missing'
                        ? 'softwareBridgeRegistry bridge driver required; do not edit capabilityLifecycle.ts.'
                        : 'softwareBridgeRegistry lifecycle dispatch',
                    steps: steps.map((step) => ({ label: step.label, ok: step.ok, message: step.message })),
                  },
                },
                httpOpts(ctx, { timeoutMs: 30000 }),
              ),
            );
          } else if (label === 'event.write.strategy_failed') {
            if (safeArgs.failedStrategyId) {
              await runStep('event.write.strategy_failed', () =>
                deps.companionApiRequest(
                  'POST',
                  `/v1/capability-packages/${encodeURIComponent(id)}/events`,
                  {
                    kind: 'connection_strategy_failed',
                    ok: false,
                    message: String(safeArgs.failureMessage || goal || 'Connection strategy failed.'),
                    detail: {
                      strategyId: String(safeArgs.failedStrategyId),
                      failureClass: String(safeArgs.failureClass || 'unknown'),
                      nextCandidateStrategy,
                    },
                  },
                  httpOpts(ctx, { timeoutMs: 30000 }),
                ),
              );
            }
          } else if (label === 'event.write.strategy_next_selected') {
            await runStep('event.write.strategy_next_selected', () =>
              deps.companionApiRequest(
                'POST',
                `/v1/capability-packages/${encodeURIComponent(id)}/events`,
                {
                  kind: 'connection_strategy_next_selected',
                  ok: Boolean(nextCandidateStrategy),
                  message: nextCandidateStrategy
                    ? `Next connection strategy selected: ${nextCandidateStrategy.label || nextCandidateStrategy.id}`
                    : 'All candidate connection strategies failed. User action is required.',
                  detail: {
                    currentStrategy,
                    failedStrategyIds: Array.from(failedStrategyIds),
                    failureClass: safeArgs.failureClass ? String(safeArgs.failureClass) : undefined,
                    nextCandidateStrategy,
                    candidateStrategies,
                  },
                },
                httpOpts(ctx, { timeoutMs: 30000 }),
              ),
            );
          } else if (label === 'process.launch') {
            await runStep('process.launch', () =>
              lifecycle('launch', { executablePath: safeArgs.executablePath ? String(safeArgs.executablePath).trim() : undefined }, 60000),
            );
          } else if (label === 'bridge.install') {
            await runStep('bridge.install', () =>
              lifecycle(
                'install',
                {
                  targetDir: safeArgs.targetDir ? String(safeArgs.targetDir).trim() : undefined,
                  currentStrategyId: currentStrategy && currentStrategy.id ? String(currentStrategy.id) : undefined,
                },
                60000,
              ),
            );
          } else {
            await runStep(label, () =>
              lifecycle(lifecycleActionForStep[label] || label, {
                currentStrategyId: currentStrategy && currentStrategy.id ? String(currentStrategy.id) : undefined,
              }),
            );
          }
        }
        let finalContext = null;
        if (permissionSet.has('context.read')) {
          const finalStep = await runStep('context.read.final', readContext);
          finalContext = finalStep && finalStep.body;
        }
        const probeStep = steps.find((step) => step && step.label === 'connection.probe');
        const missingPermissions = plannedStepsForMaturity(maturity)
          .map((label) => stepPermission(label))
          .filter((permission) => !permissionSet.has(permission));
        const structured = {
          ok: steps.length > 0 && steps.every((step) => step.ok || step.label !== 'validate'),
          id,
          goal,
          permissions,
          maturity,
          plannedSteps,
          missingPermissions: Array.from(new Set(missingPermissions)),
          steps,
          finalContext,
          nextAction:
            probeStep && probeStep.ok
              ? 'connected'
              : maturity === 'strategy_draft' && !nextCandidateStrategy
                ? 'needs_user_action'
                : maturity === 'strategy_draft' && nextCandidateStrategy
                  ? 'run_next_connection_strategy'
              : maturity === 'template_missing'
                ? 'create_software_bridge_driver_plan'
                : permissionSet.has('conversation.open')
                ? 'open_object_conversation_for_repair'
                : 'grant_conversation_or_probe_permission_for_next_loop',
        };
        return { ok: true, content: JSON.stringify(structured, null, 2), structured };
      }

      if (name === 'ac.capability.publish_gate_check') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/capability-packages/${encodeURIComponent(id)}/publish-gate`,
          {
            actorRole: safeArgs.actorRole ? String(safeArgs.actorRole).trim() : undefined,
            isAdmin: safeArgs.isAdmin === true,
            versionNote: safeArgs.versionNote ? String(safeArgs.versionNote).trim() : '',
          },
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        const structured = r.json || {};
        return {
          ok: Boolean(structured.publishable),
          content: JSON.stringify(structured, null, 2),
          structured,
          ...(structured.publishable
            ? {}
            : {
                error: {
                  code: structured.code ? String(structured.code) : 'AGENT_CAPABILITY_PUBLISH_GATE_BLOCKED',
                  message: structured.message ? String(structured.message) : r.text || 'capability publish gate blocked',
                },
              }),
        };
      }

      if (name === 'ac.capability.publish_cloud') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const body = {
          action: 'publish',
          actorRole: safeArgs.actorRole ? String(safeArgs.actorRole).trim() : undefined,
          isAdmin: safeArgs.isAdmin === true,
          semver: safeArgs.semver ? String(safeArgs.semver).trim() : undefined,
          versionNote: safeArgs.versionNote ? String(safeArgs.versionNote).trim() : '',
          publishedBy: safeArgs.publishedBy ? String(safeArgs.publishedBy).trim() : undefined,
        };
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/capability-packages/${encodeURIComponent(id)}/lifecycle`,
          body,
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_CAPABILITY_PUBLISH_FAILED', message: r.text || 'capability publish failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.capability.install' || name === 'ac.capability.probe' || name === 'ac.capability.uninstall') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const action =
          name === 'ac.capability.install' ? 'install' : name === 'ac.capability.probe' ? 'probe' : 'uninstall';
        const id = String(safeArgs.id || '').trim();
        const body = {
          targetDir: safeArgs.targetDir ? String(safeArgs.targetDir).trim() : undefined,
          port: safeArgs.port,
        };
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/capability-packages/${encodeURIComponent(id)}/${action}`,
          body,
          httpOpts(ctx, { timeoutMs: action === 'probe' ? 30000 : 60000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: {
              code:
                action === 'install'
                  ? 'AGENT_CAPABILITY_INSTALL_FAILED'
                  : action === 'probe'
                    ? 'AGENT_CAPABILITY_PROBE_FAILED'
                    : 'AGENT_CAPABILITY_UNINSTALL_FAILED',
              message: r.text || `${action} failed`,
            },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.create_draft') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const body = {
          id: safeArgs.id != null ? String(safeArgs.id).trim() : undefined,
          name: String(safeArgs.name || '').trim(),
          category: safeArgs.category != null ? String(safeArgs.category) : undefined,
          defaultPort: typeof safeArgs.defaultPort === 'number' ? safeArgs.defaultPort : undefined,
          connectorLabel: safeArgs.connectorLabel != null ? String(safeArgs.connectorLabel) : undefined,
          entryFile: safeArgs.entryFile != null ? String(safeArgs.entryFile) : undefined,
          tags: Array.isArray(safeArgs.tags) ? safeArgs.tags.map(String) : undefined,
          description: safeArgs.description != null ? String(safeArgs.description) : undefined,
          createdBy: 'copilot',
        };
        const r = await deps.companionApiRequest(
          'POST',
          '/v1/bridges/drafts',
          body,
          httpOpts(ctx, { timeoutMs: 60000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_BRIDGE_DRAFT_FAILED', message: r.text || 'host bridge draft failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.validate_draft') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/bridges/drafts/${encodeURIComponent(id)}/validate`,
          {},
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_BRIDGE_VALIDATE_FAILED', message: r.text || 'host bridge validate failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.acceptance_status') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.companionApiRequest('GET', '/v1/bridges', null, httpOpts(ctx, { timeoutMs: 30000 }));
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_BRIDGE_ACCEPTANCE_STATUS_FAILED', message: r.text || 'host bridge acceptance status failed' },
          };
        }
        const bridges = Array.isArray(r.json && r.json.bridges) ? r.json.bridges : [];
        const summary = r.json && r.json.acceptanceSummary && typeof r.json.acceptanceSummary === 'object' ? r.json.acceptanceSummary : {};
        const groups = Array.isArray(summary.groups) ? summary.groups : [];
        const missingGroups = groups
          .filter((group) => !group.ok)
          .map((group) => {
            const recommendedHosts = (Array.isArray(group.missingHosts) ? group.missingHosts : []).slice(0, 3);
            const guide = hostBridgeAcceptanceInstruction(group.id, recommendedHosts[0] || '');
            return {
              id: group.id,
              label: group.label || group.id,
              missingHosts: Array.isArray(group.missingHosts) ? group.missingHosts : [],
              recommendedHosts,
              instruction: guide.instruction,
              steps: guide.steps,
              evidence: guide.evidence,
              rule: guide.rule,
            };
          });
        const structured = {
          ok: Boolean(summary.ok),
          hostCount: bridges.length,
          readyCount: bridges.filter((item) => item && item.status === 'ready').length,
          oneClickCount: bridges.filter((item) => item && item.installMode === 'one_click').length,
          plannedCount: bridges.filter((item) => item && (item.status === 'planned' || item.installMode !== 'one_click')).length,
          acceptedGroups: Number(summary.acceptedGroups) || 0,
          requiredGroups: Number(summary.requiredGroups) || groups.length || 0,
          groups,
          missingGroups,
          nextActions: missingGroups.map((group) => ({
            groupId: group.id,
            label: group.label,
            hostId: group.recommendedHosts[0] || '',
            instruction:
              group.recommendedHosts[0]
                ? group.instruction
                : '该门禁组暂时没有推荐宿主，请先检查验收记录和宿主 catalog。',
            steps: group.steps || [],
            evidence: group.evidence || '',
            rule: group.rule || '',
          })),
          rule: 'Only real software signals such as HTTP health, heartbeat, command port, or plugin callback may pass acceptance.',
        };
        return { ok: true, content: JSON.stringify(structured, null, 2), structured };
      }

      if (name === 'ac.companion.host_bridge.install') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const id = String(safeArgs.id || '').trim();
        const body = buildHostBridgeInstallBody(id, safeArgs);
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/bridges/${encodeURIComponent(id)}/install`,
          body,
          httpOpts(ctx, { timeoutMs: 60000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_BRIDGE_INSTALL_FAILED', message: r.text || 'host bridge install failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.probe') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/bridges/${encodeURIComponent(id)}/probe`,
          {},
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_BRIDGE_PROBE_FAILED', message: r.text || 'host bridge probe failed' },
          };
        }
        if (r.json && r.json.acceptance) {
          return {
            ok: true,
            content: JSON.stringify(r.json, null, 2),
            structured: {
              ...r.json,
              acceptanceRecorded: true,
            },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.launch_host') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const id = String(safeArgs.id || '').trim();
        const body = {};
        if (safeArgs.executablePath) body.executablePath = String(safeArgs.executablePath).trim();
        if (safeArgs.versionId) body.versionId = String(safeArgs.versionId).trim();
        if (safeArgs.targetId) body.targetId = String(safeArgs.targetId).trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/bridges/${encodeURIComponent(id)}/launch`,
          body,
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_LAUNCH_FAILED', message: r.text || 'host launch failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.close_host') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/bridges/${encodeURIComponent(id)}/close`,
          {},
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_CLOSE_FAILED', message: r.text || 'host close failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.discover_running_host') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/bridges/${encodeURIComponent(id)}/discover-running`,
          {},
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_DISCOVER_RUNNING_FAILED', message: r.text || 'host running discovery failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.uninstall') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/bridges/${encodeURIComponent(id)}/uninstall`,
          {},
          httpOpts(ctx, { timeoutMs: 60000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_BRIDGE_UNINSTALL_FAILED', message: r.text || 'host bridge uninstall failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.companion.host_bridge.delete_draft') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        const id = String(safeArgs.id || '').trim();
        const r = await deps.companionApiRequest(
          'DELETE',
          `/v1/bridges/drafts/${encodeURIComponent(id)}`,
          null,
          httpOpts(ctx, { timeoutMs: 30000 }),
        );
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_HOST_BRIDGE_DELETE_FAILED', message: r.text || 'host bridge delete failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.shell_tool.export') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const toolId = String(safeArgs.toolId || '').trim();
        const body =
          safeArgs.destZipPath != null && String(safeArgs.destZipPath).trim()
            ? { destZipPath: String(safeArgs.destZipPath).trim() }
            : {};
        const r = await deps.companionApiRequest(
          'POST',
          `/v1/shell-tools/authored/${encodeURIComponent(toolId)}/pack`,
          body,
          httpOpts(ctx, { timeoutMs: 120000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_SHELL_TOOL_EXPORT_FAILED', message: r.text || 'export failed' },
          };
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
      }

      if (name === 'ac.shell_tool.import') {
        if (typeof deps.companionApiRequest !== 'function') {
          return toolUnavailable('companion');
        }
        let aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        const r = await deps.companionApiRequest(
          'POST',
          '/v1/shell-tools/authored/import',
          { zipPath: String(safeArgs.zipPath || '').trim() },
          httpOpts(ctx, { timeoutMs: 120000 }),
        );
        aborted = abortIfNeeded(ctx);
        if (aborted) return aborted;
        if (r.error === 'aborted') return abortedToolResult();
        if (!r.ok) {
          return {
            ok: false,
            content: r.text || '',
            error: { code: 'AGENT_SHELL_TOOL_IMPORT_FAILED', message: r.text || 'import failed' },
          };
        }
        const toolId = r.json?.toolId;
        if (safeArgs.open !== false && toolId && typeof deps.runShellTool === 'function') {
          await deps.runShellTool(String(toolId));
        }
        return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
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
