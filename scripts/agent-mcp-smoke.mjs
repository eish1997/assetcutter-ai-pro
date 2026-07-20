#!/usr/bin/env node
/**
 * AssetCutter MCP protocol smoke test.
 *
 * Usage:
 *   AGENT_MCP_URL=http://127.0.0.1:19120/mcp AGENT_MCP_TOKEN=... node scripts/agent-mcp-smoke.mjs
 *   node scripts/agent-mcp-smoke.mjs --config path/to/hermes-mcp-import.json
 *   node scripts/agent-mcp-smoke.mjs --config path/to/hermes-mcp-import.json --workbench-e2e
 *   node scripts/agent-mcp-smoke.mjs --config path/to/hermes-mcp-import.json --workbench-e2e --workbench-recovery-wait-ms 60000
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { WORKBENCH_E2E_REQUIRED_TOOLS } = require('../companion-desktop/agent-workbench-flow.cjs');
const results = [];

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return '';
}

function hasArg(name, argv = process.argv) {
  return argv.includes(name);
}

function pass(id, detail = '') {
  results.push({ id, status: 'PASS', detail });
  console.log(`  PASS ${id}${detail ? ` - ${detail}` : ''}`);
}

function fail(id, detail = '') {
  results.push({ id, status: 'FAIL', detail });
  console.log(`  FAIL ${id}${detail ? ` - ${detail}` : ''}`);
}

function skip(id, detail = '') {
  results.push({ id, status: 'SKIP', detail });
  console.log(`  SKIP ${id}${detail ? ` - ${detail}` : ''}`);
}

export function loadConfig(pathname) {
  if (!pathname) return null;
  const raw = fs.readFileSync(pathname, 'utf8');
  const json = JSON.parse(raw);
  const servers = json.mcpServers && typeof json.mcpServers === 'object' ? json.mcpServers : json;
  const entry = servers['assetcutter-body'] || Object.values(servers)[0];
  if (!entry || typeof entry !== 'object') return null;
  return {
    url: String(entry.url || ''),
    token: String(entry.headers?.Authorization || '').replace(/^Bearer\s+/i, ''),
  };
}

export function resolveTarget(env = process.env, argv = process.argv) {
  const idx = argv.indexOf('--config');
  const configPath = idx >= 0 && argv[idx + 1] ? argv[idx + 1] : '';
  const cfg = loadConfig(configPath || env.AGENT_MCP_CONFIG || '');
  return {
    url: env.AGENT_MCP_URL || cfg?.url || 'http://127.0.0.1:19120/mcp',
    token: env.AGENT_MCP_TOKEN || cfg?.token || '',
    workbenchE2e: env.AGENT_MCP_WORKBENCH_E2E === '1' || hasArg('--workbench-e2e', argv),
    workbenchPresetId: env.AGENT_MCP_WORKBENCH_PRESET_ID || argValueFrom(argv, '--workbench-preset-id'),
    workbenchRecoveryWaitMs: Math.max(
      0,
      Number(env.AGENT_MCP_WORKBENCH_RECOVERY_WAIT_MS || argValueFrom(argv, '--workbench-recovery-wait-ms') || 0) || 0,
    ),
    workbenchProjectName:
      env.AGENT_MCP_WORKBENCH_PROJECT_NAME ||
      argValueFrom(argv, '--workbench-project-name') ||
      `MCP Smoke ${new Date().toISOString().replace(/[:.]/g, '-')}`,
  };
}

function delay(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (!n) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

function argValueFrom(argv, name) {
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return '';
}

function postJson(url, body, token = '') {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        timeout: 10000,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* non-json */
          }
          resolve({ status: res.statusCode || 0, text, json });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, text: 'timeout', json: null });
    });
    req.on('error', (e) => resolve({ status: 0, text: e.message, json: null }));
    req.write(payload);
    req.end();
  });
}

function parseJsonText(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function callTool(target, name, args = {}, id = name) {
  return postJson(
    target.url,
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    target.token,
  );
}

function toolStructured(call) {
  return call?.json?.result?.structuredContent || {};
}

function toolErrorCode(call) {
  const result = call?.json?.result || {};
  const meta = result._meta?.assetcutter || {};
  const structured = result.structuredContent || {};
  return meta.error?.code || structured.error?.code || meta.errorCode || structured.errorCode || '';
}

function toolNextStep(call) {
  const result = call?.json?.result || {};
  const meta = result._meta?.assetcutter || {};
  const structured = result.structuredContent || {};
  return meta.nextStep || structured.nextStep || result.content?.[0]?.text || '';
}

function toolRecoveryTool(call) {
  const result = call?.json?.result || {};
  const meta = result._meta?.assetcutter || {};
  const structured = result.structuredContent || {};
  return meta.recoveryTool || structured.recoveryTool || null;
}

function isWorkbenchLoginRecoveryTool(recoveryTool) {
  return (
    recoveryTool &&
    recoveryTool.name === 'ac.shell.navigate' &&
    recoveryTool.arguments &&
    recoveryTool.arguments.view === 'workbench'
  );
}

function isToolSuccess(call) {
  return call?.status === 200 && call?.json?.result && call.json.result.isError === false;
}

function chooseWorkbenchPreset(context, requestedPresetId) {
  const presets = Array.isArray(context?.capabilityPresets) ? context.capabilityPresets : [];
  if (requestedPresetId) return presets.find((p) => p.id === requestedPresetId) || null;
  return (
    presets.find((p) => p.directRunSupported === true && p.acceptsText === true && p.requiresImage !== true) ||
    presets.find((p) => p.directRunSupported === true && p.requiresImage !== true) ||
    null
  );
}

async function runWorkbenchE2e(target, tools) {
  if (!target.workbenchE2e) {
    skip('workbench.e2e', 'set AGENT_MCP_WORKBENCH_E2E=1 or --workbench-e2e to run authenticated workbench chain');
    return;
  }
  const requiredTools = WORKBENCH_E2E_REQUIRED_TOOLS;
  const advertised = new Set(tools.map((t) => t.name));
  const missing = requiredTools.filter((name) => !advertised.has(name));
  if (missing.length) {
    fail('workbench.e2e.tools', `missing tools: ${missing.join(', ')}`);
    return;
  }
  pass('workbench.e2e.tools', 'all chain tools advertised');

  let readyCall = await callTool(
    target,
    'ac.workbench.ensure_ready',
    { requireProject: false },
    'workbench-e2e-ensure-ready',
  );
  if (!isToolSuccess(readyCall)) {
    const recoveryTool = toolRecoveryTool(readyCall);
    if (isWorkbenchLoginRecoveryTool(recoveryTool)) {
      const recoveryCall = await callTool(
        target,
        recoveryTool.name,
        recoveryTool.arguments,
        'workbench-e2e-recovery-login',
      );
      if (isToolSuccess(recoveryCall)) {
        pass('workbench.e2e.recovery_tool', `${recoveryTool.name} -> ${recoveryTool.arguments.view}`);
        if (target.workbenchRecoveryWaitMs > 0) {
          pass('workbench.e2e.recovery_wait', `${target.workbenchRecoveryWaitMs}ms for user login`);
          await delay(target.workbenchRecoveryWaitMs);
        }
        readyCall = await callTool(
          target,
          'ac.workbench.ensure_ready',
          { requireProject: false },
          'workbench-e2e-ensure-ready-retry',
        );
      } else {
        fail(
          'workbench.e2e.recovery_tool',
          `${toolErrorCode(recoveryCall) || recoveryCall.status}: ${toolNextStep(recoveryCall)}`,
        );
        return;
      }
    }
    if (!isToolSuccess(readyCall)) {
      fail('workbench.e2e.ensure_ready', `${toolErrorCode(readyCall) || readyCall.status}: ${toolNextStep(readyCall)}`);
      return;
    }
  }
  pass('workbench.e2e.ensure_ready', 'workbench');

  const contextCall = await callTool(target, 'ac.workbench.get_context', {}, 'workbench-e2e-context');
  if (!isToolSuccess(contextCall)) {
    fail('workbench.e2e.context', `${toolErrorCode(contextCall) || contextCall.status}: ${toolNextStep(contextCall)}`);
    return;
  }
  const context = toolStructured(contextCall);
  pass('workbench.e2e.context', `${context.projects?.length || 0} projects / ${context.capabilityPresets?.length || 0} presets`);

  let projectId = String(context.activeProjectId || '').trim();
  if (!projectId) {
    const createCall = await callTool(
      target,
      'ac.workbench.create_project',
      { name: target.workbenchProjectName },
      'workbench-e2e-create-project',
    );
    if (!isToolSuccess(createCall)) {
      fail('workbench.e2e.create_project', `${toolErrorCode(createCall) || createCall.status}: ${toolNextStep(createCall)}`);
      return;
    }
    const created = toolStructured(createCall);
    projectId = String(created.projectId || created.project?.id || '').trim();
    if (!projectId) {
      fail('workbench.e2e.create_project', 'missing projectId in response');
      return;
    }
    pass('workbench.e2e.create_project', projectId);
  } else {
    pass('workbench.e2e.project', projectId);
  }

  const preset = chooseWorkbenchPreset(context, target.workbenchPresetId);
  if (!preset) {
    fail(
      'workbench.e2e.preset',
      target.workbenchPresetId
        ? `requested preset not found or unavailable: ${target.workbenchPresetId}`
        : 'no direct text-capable preset available',
    );
    return;
  }
  pass('workbench.e2e.preset', preset.id);

  const runCall = await callTool(
    target,
    'ac.workbench.run_capability',
    {
      projectId,
      presetId: preset.id,
      inputText: 'MCP smoke: create a short verification note for AssetCutter workbench.',
    },
    'workbench-e2e-run-capability',
  );
  if (!isToolSuccess(runCall)) {
    fail('workbench.e2e.run_capability', `${toolErrorCode(runCall) || runCall.status}: ${toolNextStep(runCall)}`);
    return;
  }
  const run = toolStructured(runCall);
  const assetId = String(run.assetId || run.output?.assetId || '').trim();
  if (!assetId || !run.resultKey) {
    fail('workbench.e2e.run_capability', 'missing assetId/resultKey');
    return;
  }
  pass('workbench.e2e.run_capability', `${assetId} / ${run.resultKey}`);

  const listCall = await callTool(target, 'ac.workbench.list_assets', { projectId, limit: 20 }, 'workbench-e2e-list-assets');
  if (!isToolSuccess(listCall)) {
    fail('workbench.e2e.list_assets', `${toolErrorCode(listCall) || listCall.status}: ${toolNextStep(listCall)}`);
    return;
  }
  const list = toolStructured(listCall);
  const listed = Array.isArray(list.assets) && list.assets.some((a) => a.id === assetId);
  if (!listed) {
    fail('workbench.e2e.list_assets', `created asset not listed: ${assetId}`);
    return;
  }
  pass('workbench.e2e.list_assets', `${list.returned || list.assets.length} returned`);

  const getCall = await callTool(target, 'ac.workbench.get_asset', { projectId, assetId }, 'workbench-e2e-get-asset');
  if (!isToolSuccess(getCall)) {
    fail('workbench.e2e.get_asset', `${toolErrorCode(getCall) || getCall.status}: ${toolNextStep(getCall)}`);
    return;
  }
  const detail = toolStructured(getCall).asset || {};
  const hasText = Array.isArray(detail.textResults) && detail.textResults.some((r) => String(r.text || '').trim());
  const hasMedia = Array.isArray(detail.results) && detail.results.length > 0;
  if (!hasText && !hasMedia) {
    fail('workbench.e2e.get_asset', 'asset detail has no text or media result metadata');
    return;
  }
  pass('workbench.e2e.get_asset', detail.displayKey || assetId);
}

async function main() {
  results.length = 0;
  const target = resolveTarget();
  console.log('[agent-mcp-smoke] target:', target.url);

  if (!target.token) {
    fail('config.token', 'AGENT_MCP_TOKEN or --config with Authorization header is required');
    finish();
    return;
  }
  pass('config.token', 'token present');

  const unauthorized = await postJson(target.url, { jsonrpc: '2.0', id: 'unauth', method: 'ping', params: {} }, '');
  if (unauthorized.status === 401) pass('auth.required', 'missing token rejected');
  else fail('auth.required', `expected 401, got ${unauthorized.status}`);

  const init = await postJson(
    target.url,
    { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    target.token,
  );
  if (init.status === 200 && init.json?.result?.protocolVersion && init.json?.result?.serverInfo?.name) {
    pass('rpc.initialize', `${init.json.result.serverInfo.name} ${init.json.result.protocolVersion}`);
    if (init.json.result.capabilities?.logging && init.json.result.capabilities?.resources?.subscribe === true) {
      pass('rpc.initialize.capabilities', 'logging + resource subscribe');
    } else {
      fail('rpc.initialize.capabilities', 'missing logging or resources.subscribe capability');
    }
  } else {
    fail('rpc.initialize', init.text || `status ${init.status}`);
  }

  const logLevel = await postJson(
    target.url,
    { jsonrpc: '2.0', id: 'logging', method: 'logging/setLevel', params: { level: 'warning' } },
    target.token,
  );
  if (logLevel.status === 200 && logLevel.json?.result && !logLevel.json.error) {
    pass('rpc.logging.setLevel', 'warning');
  } else {
    fail('rpc.logging.setLevel', logLevel.text || `status ${logLevel.status}`);
  }

  const notify = await postJson(
    target.url,
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    target.token,
  );
  if (notify.status === 202) pass('rpc.notification', 'initialized accepted without response');
  else fail('rpc.notification', `expected 202, got ${notify.status}`);

  const batch = await postJson(
    target.url,
    [
      { jsonrpc: '2.0', id: 'ping', method: 'ping', params: {} },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 'tools', method: 'tools/list', params: {} },
    ],
    target.token,
  );
  const batchTools = Array.isArray(batch.json) ? batch.json.find((r) => r.id === 'tools') : null;
  const tools = Array.isArray(batchTools?.result?.tools) ? batchTools.result.tools : [];
  if (batch.status === 200 && Array.isArray(batch.json) && tools.length > 0) {
    pass('rpc.batch.tools', `${tools.length} tools`);
  } else {
    fail('rpc.batch.tools', batch.text || `status ${batch.status}`);
  }

  const runCapabilityTool = tools.find((t) => t.name === 'ac.workbench.run_capability');
  if (!runCapabilityTool) {
    skip('tool.ac.workbench.run_capability.schema', 'tool not advertised');
  } else {
    const props = runCapabilityTool.inputSchema?.properties || {};
    const meta = runCapabilityTool._meta?.assetcutter || {};
    if (
      props.presetId &&
      props.imageDataUrl &&
      props.inputAssetId &&
      meta.exampleArguments?.imageDataUrl &&
      meta.exampleArguments?.inputAssetId &&
      Array.isArray(meta.successSignals) &&
      meta.successSignals.some((s) => String(s).includes('input_image_required'))
    ) {
      pass('tool.ac.workbench.run_capability.schema', 'imageDataUrl/inputAssetId + recovery guidance');
    } else {
      fail('tool.ac.workbench.run_capability.schema', 'missing imageDataUrl/inputAssetId or recovery guidance');
    }
  }

  const createProjectTool = tools.find((t) => t.name === 'ac.workbench.create_project');
  if (!createProjectTool) {
    fail('tool.ac.workbench.create_project.schema', 'tool not advertised');
  } else if (createProjectTool.inputSchema?.properties?.name && createProjectTool._meta?.assetcutter?.risk === 'safe') {
    pass('tool.ac.workbench.create_project.schema', 'safe project creation tool');
  } else {
    fail('tool.ac.workbench.create_project.schema', 'missing name schema or safe risk metadata');
  }

  const listAssetsTool = tools.find((t) => t.name === 'ac.workbench.list_assets');
  if (!listAssetsTool) {
    fail('tool.ac.workbench.list_assets.schema', 'tool not advertised');
  } else if (listAssetsTool.inputSchema?.properties?.limit && listAssetsTool._meta?.assetcutter?.risk === 'safe') {
    pass('tool.ac.workbench.list_assets.schema', 'safe lightweight asset listing');
  } else {
    fail('tool.ac.workbench.list_assets.schema', 'missing limit schema or safe risk metadata');
  }

  const getAssetTool = tools.find((t) => t.name === 'ac.workbench.get_asset');
  if (!getAssetTool) {
    fail('tool.ac.workbench.get_asset.schema', 'tool not advertised');
  } else if (
    Array.isArray(getAssetTool.inputSchema?.required) &&
    getAssetTool.inputSchema.required.includes('assetId') &&
    getAssetTool._meta?.assetcutter?.risk === 'safe'
  ) {
    pass('tool.ac.workbench.get_asset.schema', 'safe asset detail tool');
  } else {
    fail('tool.ac.workbench.get_asset.schema', 'missing assetId requirement or safe risk metadata');
  }

  const ensureReadyTool = tools.find((t) => t.name === 'ac.workbench.ensure_ready');
  if (!ensureReadyTool) {
    fail('tool.ac.workbench.ensure_ready.schema', 'tool not advertised');
  } else if (
    ensureReadyTool.inputSchema?.properties?.requireProject &&
    ensureReadyTool.inputSchema?.properties?.createIfMissing &&
    ensureReadyTool._meta?.assetcutter?.risk === 'safe'
  ) {
    pass('tool.ac.workbench.ensure_ready.schema', 'safe readiness probe');
  } else {
    fail('tool.ac.workbench.ensure_ready.schema', 'missing readiness schema or safe risk metadata');
  }

  const stateTool = tools.find((t) => t.name === 'ac.shell.get_state');
  if (!stateTool) {
    skip('tool.ac.shell.get_state', 'tool not advertised');
  } else {
    if (stateTool._meta?.assetcutter?.risk && Array.isArray(stateTool._meta?.assetcutter?.surfaces)) {
      pass('tool.meta.assetcutter', `${stateTool._meta.assetcutter.risk}/${stateTool._meta.assetcutter.surfaces.join(',')}`);
    } else {
      fail('tool.meta.assetcutter', 'missing risk/surfaces metadata');
    }
    if (stateTool.title && stateTool._meta?.assetcutter?.whenToUse) {
      pass('tool.guidance.assetcutter', stateTool.title);
    } else {
      fail('tool.guidance.assetcutter', 'missing title/whenToUse guidance');
    }
    const call = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'state', method: 'tools/call', params: { name: 'ac.shell.get_state', arguments: {} } },
      target.token,
    );
    const meta = call.json?.result?._meta?.assetcutter || {};
    if (call.status === 200 && call.json?.result && call.json.result.isError === false) {
      pass('tool.ac.shell.get_state', 'call succeeded');
      if (meta.toolCallId && meta.policyDecision && typeof meta.durationMs === 'number') {
        pass('tool.call.trace', meta.toolCallId);
      } else {
        fail('tool.call.trace', 'missing toolCallId/policyDecision/durationMs');
      }
    } else {
      fail('tool.ac.shell.get_state', call.text || `status ${call.status}`);
    }
  }

  const workbenchContextTool = tools.find((t) => t.name === 'ac.workbench.get_context');
  if (!workbenchContextTool) {
    skip('tool.ac.workbench.get_context', 'tool not advertised');
  } else {
    const call = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'workbench-context', method: 'tools/call', params: { name: 'ac.workbench.get_context', arguments: {} } },
      target.token,
    );
    const result = call.json?.result || {};
    const meta = result._meta?.assetcutter || {};
    const structured = result.structuredContent || {};
    const recoveryTool = toolRecoveryTool(call);
    if (call.status === 200 && result.isError === false) {
      pass('tool.ac.workbench.get_context', 'call succeeded');
    } else if (
      call.status === 200 &&
      result.isError === true &&
      (meta.authRequired || structured.authRequired || meta.retryable || structured.retryable) &&
      (meta.nextStep || structured.nextStep) &&
      isWorkbenchLoginRecoveryTool(recoveryTool)
    ) {
      pass(
        'tool.ac.workbench.get_context',
        `recoverable: ${meta.error?.code || structured.error?.code || 'needs-attention'} via ${recoveryTool.name}`,
      );
    } else {
      fail('tool.ac.workbench.get_context', call.text || `status ${call.status}`);
    }
  }

  const resources = await postJson(target.url, { jsonrpc: '2.0', id: 'resources', method: 'resources/list', params: {} }, target.token);
  const resourceList = Array.isArray(resources.json?.result?.resources) ? resources.json.result.resources : [];
  if (resources.status === 200 && Array.isArray(resources.json?.result?.resources)) {
    pass('rpc.resources.list', `${resourceList.length} resources`);
  } else {
    fail('rpc.resources.list', resources.text || `status ${resources.status}`);
  }

  const templates = await postJson(
    target.url,
    { jsonrpc: '2.0', id: 'resource-templates', method: 'resources/templates/list', params: {} },
    target.token,
  );
  const templateList = Array.isArray(templates.json?.result?.resourceTemplates) ? templates.json.result.resourceTemplates : [];
  const templateUris = templateList.map((r) => r.uriTemplate);
  if (
    templates.status === 200 &&
    templateUris.includes('assetcutter://mcp/{document}') &&
    templateUris.includes('skill://{skillId}')
  ) {
    pass('rpc.resources.templates.list', `${templateList.length} templates`);
  } else {
    fail('rpc.resources.templates.list', templates.text || `status ${templates.status}`);
  }

  const hasManifest = resourceList.some((r) => r.uri === 'assetcutter://mcp/manifest');
  if (!hasManifest) {
    fail('resource.manifest.listed', 'assetcutter://mcp/manifest missing');
  } else {
    pass('resource.manifest.listed');
    const manifest = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'manifest', method: 'resources/read', params: { uri: 'assetcutter://mcp/manifest' } },
      target.token,
    );
    const text = manifest.json?.result?.contents?.[0]?.text || '';
    const json = parseJsonText(text);
    if (
      manifest.status === 200 &&
      json &&
      json.capabilities?.tools === true &&
      json.capabilities?.resources === true &&
      json.capabilities?.prompts === true &&
      json.capabilities?.logging === true &&
      json.capabilities?.resourceSubscriptions === true
    ) {
      pass('resource.manifest.read', `${json.serverInfo?.name || 'server'} ${json.serverInfo?.version || ''}`.trim());
      if (isWorkbenchLoginRecoveryTool(json.recovery?.loginRecoveryTool)) {
        pass('resource.manifest.recovery', 'authRequired via ac.shell.navigate');
      } else {
        fail('resource.manifest.recovery', 'missing loginRecoveryTool ac.shell.navigate({ view: workbench })');
      }
    } else {
      fail('resource.manifest.read', manifest.text || `status ${manifest.status}`);
    }
  }

  const hasToolCatalog = resourceList.some((r) => r.uri === 'assetcutter://mcp/tool-catalog');
  if (!hasToolCatalog) {
    fail('resource.tool-catalog.listed', 'assetcutter://mcp/tool-catalog missing');
  } else {
    pass('resource.tool-catalog.listed');
    const catalog = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'tool-catalog', method: 'resources/read', params: { uri: 'assetcutter://mcp/tool-catalog' } },
      target.token,
    );
    const text = catalog.json?.result?.contents?.[0]?.text || '';
    const json = parseJsonText(text);
    if (catalog.status === 200 && json && Number(json.total) > 0 && Array.isArray(json.surfaces)) {
      pass('resource.tool-catalog.read', `${json.total} tools`);
    } else {
      fail('resource.tool-catalog.read', catalog.text || `status ${catalog.status}`);
    }
  }

  const hasQuickstart = resourceList.some((r) => r.uri === 'assetcutter://mcp/quickstart');
  if (!hasQuickstart) {
    fail('resource.quickstart.listed', 'assetcutter://mcp/quickstart missing');
  } else {
    pass('resource.quickstart.listed');
    const quickstart = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'quickstart', method: 'resources/read', params: { uri: 'assetcutter://mcp/quickstart' } },
      target.token,
    );
    const text = quickstart.json?.result?.contents?.[0]?.text || '';
    if (
      quickstart.status === 200 &&
      text.includes('ac.shell.get_state') &&
      text.includes('ac.workbench.ensure_ready') &&
      text.includes('ac.workbench.get_context') &&
      text.includes('ac.workbench.create_project') &&
      text.includes('ac.workbench.list_assets') &&
      text.includes('ac.workbench.get_asset') &&
      text.includes('inputAssetId') &&
      text.includes('imageDataUrl') &&
      text.includes('directRunSupported')
    ) {
      pass('resource.quickstart.read', 'guide available');
    } else {
      fail('resource.quickstart.read', quickstart.text || `status ${quickstart.status}`);
    }
  }

  const hasWorkbenchFlow = resourceList.some((r) => r.uri === 'assetcutter://mcp/workbench-flow');
  if (!hasWorkbenchFlow) {
    fail('resource.workbench-flow.listed', 'assetcutter://mcp/workbench-flow missing');
  } else {
    pass('resource.workbench-flow.listed');
    const flow = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'workbench-flow', method: 'resources/read', params: { uri: 'assetcutter://mcp/workbench-flow' } },
      target.token,
    );
    const text = flow.json?.result?.contents?.[0]?.text || '';
    const json = parseJsonText(text);
    const steps = Array.isArray(json?.canonicalFlow) ? json.canonicalFlow : [];
    if (
      flow.status === 200 &&
      json &&
      json.requiredTools?.includes('ac.workbench.ensure_ready') &&
      steps.some((step) => step.tool === 'ac.workbench.run_capability') &&
      json.recoveryContract?.authRequired &&
      json.e2eGates?.cli &&
      !text.includes(target.token)
    ) {
      pass('resource.workbench-flow.read', `${steps.length} steps`);
    } else {
      fail('resource.workbench-flow.read', flow.text || `status ${flow.status}`);
    }
  }

  const hasServerStatus = resourceList.some((r) => r.uri === 'assetcutter://mcp/server-status');
  if (!hasServerStatus) {
    fail('resource.server-status.listed', 'assetcutter://mcp/server-status missing');
  } else {
    pass('resource.server-status.listed');
    const status = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'server-status', method: 'resources/read', params: { uri: 'assetcutter://mcp/server-status' } },
      target.token,
    );
    const text = status.json?.result?.contents?.[0]?.text || '';
    const json = parseJsonText(text);
    if (
      status.status === 200 &&
      json &&
      typeof json.running === 'boolean' &&
      typeof json.subscribedResourceCount === 'number' &&
      typeof json.toolCount === 'number' &&
      json.readiness &&
      typeof json.readiness.mcp === 'boolean' &&
      typeof json.shellView === 'string' &&
      json.loggingLevel === 'warning' &&
      !text.includes(target.token)
    ) {
      pass('resource.server-status.read', `${json.running ? 'running' : 'stopped'} / ${json.shellView}`);
    } else {
      fail('resource.server-status.read', status.text || `status ${status.status}`);
    }
  }

  const hasToolExecutions = resourceList.some((r) => r.uri === 'assetcutter://mcp/tool-executions');
  if (!hasToolExecutions) {
    fail('resource.tool-executions.listed', 'assetcutter://mcp/tool-executions missing');
  } else {
    pass('resource.tool-executions.listed');
    const executions = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'tool-executions', method: 'resources/read', params: { uri: 'assetcutter://mcp/tool-executions' } },
      target.token,
    );
    const text = executions.json?.result?.contents?.[0]?.text || '';
    const json = parseJsonText(text);
    if (executions.status === 200 && json && Array.isArray(json.executions) && !text.includes(target.token)) {
      pass('resource.tool-executions.read', `${json.executions.length} executions`);
    } else {
      fail('resource.tool-executions.read', executions.text || `status ${executions.status}`);
    }
  }

  if (!hasToolCatalog) {
    skip('rpc.resources.subscribe', 'tool-catalog resource missing');
  } else {
    const subscribe = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'subscribe', method: 'resources/subscribe', params: { uri: 'assetcutter://mcp/tool-catalog' } },
      target.token,
    );
    const unsubscribe = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'unsubscribe', method: 'resources/unsubscribe', params: { uri: 'assetcutter://mcp/tool-catalog' } },
      target.token,
    );
    if (subscribe.status === 200 && subscribe.json?.result && unsubscribe.status === 200 && unsubscribe.json?.result) {
      pass('rpc.resources.subscribe', 'subscribe/unsubscribe');
    } else {
      fail('rpc.resources.subscribe', subscribe.text || unsubscribe.text || `status ${subscribe.status}/${unsubscribe.status}`);
    }
  }

  const prompts = await postJson(target.url, { jsonrpc: '2.0', id: 'prompts', method: 'prompts/list', params: {} }, target.token);
  const promptList = Array.isArray(prompts.json?.result?.prompts) ? prompts.json.result.prompts : [];
  if (prompts.status === 200 && prompts.json?.result && Array.isArray(prompts.json.result.prompts)) {
    pass('rpc.prompts.list', `${promptList.length} prompts`);
  } else {
    fail('rpc.prompts.list', prompts.text || `status ${prompts.status}`);
  }

  const firstPrompt = promptList[0];
  if (!firstPrompt || !firstPrompt.name) {
    skip('rpc.prompts.get', 'no prompts advertised');
  } else {
    const prompt = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'prompt', method: 'prompts/get', params: { name: firstPrompt.name } },
      target.token,
    );
    if (prompt.status === 200 && Array.isArray(prompt.json?.result?.messages)) {
      pass('rpc.prompts.get', firstPrompt.name);
    } else {
      fail('rpc.prompts.get', prompt.text || `status ${prompt.status}`);
    }
  }

  await runWorkbenchE2e(target, tools);

  finish();
}

function finish() {
  const failed = results.filter((r) => r.status === 'FAIL');
  const passed = results.filter((r) => r.status === 'PASS');
  const skipped = results.filter((r) => r.status === 'SKIP');
  console.log(`[agent-mcp-smoke] passed=${passed.length} failed=${failed.length} skipped=${skipped.length}`);
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  });
}
