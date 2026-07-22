#!/usr/bin/env node
/**
 * AssetCutter MCP protocol smoke test.
 *
 * Usage:
 *   node scripts/agent-mcp-smoke.mjs
 *   AGENT_MCP_URL=http://127.0.0.1:19120/mcp AGENT_MCP_TOKEN=... node scripts/agent-mcp-smoke.mjs
 *   node scripts/agent-mcp-smoke.mjs --config path/to/hermes-mcp-import.json
 *   node scripts/agent-mcp-smoke.mjs --config path/to/hermes-mcp-import.json --workbench-e2e
 *   node scripts/agent-mcp-smoke.mjs --config path/to/hermes-mcp-import.json --workbench-e2e --workbench-recovery-wait-ms 60000
 *   node scripts/agent-mcp-smoke.mjs --status
 *   node scripts/agent-mcp-smoke.mjs --status-json
 *   node scripts/agent-mcp-smoke.mjs --open-login
 *
 * When env/config are omitted, this script reads the local Companion
 * agent-store settings and uses its MCP port/token.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { WORKBENCH_E2E_REQUIRED_TOOLS } = require('../companion-desktop/agent-workbench-flow.cjs');
const results = [];
let shellAccountReadiness = null;
const WORKBENCH_STATUS_COMMAND = 'npm run smoke:agent-mcp:status';
const WORKBENCH_E2E_COMMAND = 'npm run smoke:agent-mcp:e2e';
const WORKBENCH_WAIT_LOGIN_COMMAND = 'npm run smoke:agent-mcp:e2e:wait-login';
const WORKBENCH_OPEN_LOGIN_COMMAND = 'npm run smoke:agent-mcp:open-login';
const WORKBENCH_OPEN_LOGIN_WAIT_COMMAND = 'npm run smoke:agent-mcp:e2e:open-login-wait';
const AGENT_WORKBENCH_SMOKE_PRESET_ID = 'agent_workbench_smoke_text_note';
const BLOCKER_ACTION_RISKS = new Set(['safe', 'confirm-risk']);
const BLOCKER_ACTION_OWNERS = new Set(['user', 'admin', 'anyone', 'local_shell']);
const BLOCKER_ACTION_COMMANDS = new Set([
  WORKBENCH_STATUS_COMMAND,
  WORKBENCH_E2E_COMMAND,
  WORKBENCH_WAIT_LOGIN_COMMAND,
  WORKBENCH_OPEN_LOGIN_COMMAND,
  WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
  'npm run smoke:agent-mcp',
]);

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

export function defaultLocalAgentSettingsPath(env = process.env) {
  const sandboxRoot = String(env.AC_COMPANION_SANDBOX_ROOT || '').trim();
  if (sandboxRoot) return path.join(path.resolve(sandboxRoot), 'agent-store', 'settings.json');
  const localAppData = String(env.LOCALAPPDATA || '').trim();
  if (!localAppData) return '';
  return path.join(localAppData, 'AssetCutterCompanion', 'sandbox', 'agent-store', 'settings.json');
}

export function loadLocalAgentSettings(env = process.env) {
  const settingsPath = String(env.AGENT_MCP_SETTINGS || defaultLocalAgentSettingsPath(env) || '').trim();
  if (!settingsPath || !fs.existsSync(settingsPath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const port = Number(json.mcpPort || 19120);
    const token = String(json.mcpToken || '');
    return {
      url: `http://127.0.0.1:${Number.isFinite(port) ? port : 19120}/mcp`,
      token,
      enabled: Boolean(json.mcpEnabled),
      settingsPath,
    };
  } catch {
    return null;
  }
}

export function resolveTarget(env = process.env, argv = process.argv) {
  const idx = argv.indexOf('--config');
  const configPath = idx >= 0 && argv[idx + 1] ? argv[idx + 1] : '';
  const cfg = loadConfig(configPath || env.AGENT_MCP_CONFIG || '');
  const localSettings = loadLocalAgentSettings(env);
  return {
    url: env.AGENT_MCP_URL || cfg?.url || localSettings?.url || 'http://127.0.0.1:19120/mcp',
    token: env.AGENT_MCP_TOKEN || cfg?.token || localSettings?.token || '',
    source: env.AGENT_MCP_TOKEN
      ? 'env'
      : cfg?.token
        ? 'config'
        : localSettings?.token
          ? 'local-settings'
          : 'none',
    settingsPath: localSettings?.settingsPath || '',
    statusOnly: env.AGENT_MCP_STATUS === '1' || env.AGENT_MCP_STATUS_JSON === '1' || hasArg('--status', argv) || hasArg('--status-json', argv),
    statusJson: env.AGENT_MCP_STATUS_JSON === '1' || hasArg('--status-json', argv),
    openLogin: env.AGENT_MCP_OPEN_LOGIN === '1' || hasArg('--open-login', argv),
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

function postJson(url, body, token = '', timeoutMs = 10000) {
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
          timeout: Math.max(1000, Number(timeoutMs) || 10000),
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
    30000,
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

function workbenchAuthDiagnostics(call) {
  const structured = toolStructured(call);
  const details = structured && typeof structured.details === 'object' ? structured.details : {};
  const auth = structured && typeof structured.authDiagnostics === 'object'
    ? structured.authDiagnostics
    : details && typeof details.authDiagnostics === 'object'
      ? details.authDiagnostics
      : null;
  const server = details && typeof details.server === 'object' ? details.server : {};
  const session = auth && typeof auth.session === 'object' ? auth.session : null;
  const parts = [];
  if (auth?.apiOrigin || server.requestOrigin) parts.push(`origin=${auth?.apiOrigin || server.requestOrigin}`);
  if (session && Number.isFinite(Number(session.cookieCount))) parts.push(`cookies=${Number(session.cookieCount)}`);
  if (session && session.hasLikelyAuthCookie === false) parts.push('authCookie=missing');
  if (auth?.partition) parts.push(`partition=${auth.partition}`);
  return parts.join(' ');
}

function workbenchLoginNextStep(call) {
  const diag = workbenchAuthDiagnostics(call);
  const recoveryTool = toolRecoveryTool(call);
  const recovery = isWorkbenchLoginRecoveryTool(recoveryTool)
    ? `recovery=${recoveryTool.name}(${JSON.stringify(recoveryTool.arguments)})`
    : '';
  const retry = 'retry=npm run smoke:agent-mcp:e2e waitLogin=npm run smoke:agent-mcp:e2e:wait-login';
  return [diag, recovery, retry].filter(Boolean).join(' ');
}

function isWorkbenchLoginRecoveryTool(recoveryTool) {
  return (
    recoveryTool &&
    recoveryTool.name === 'ac.shell.navigate' &&
    recoveryTool.arguments &&
    recoveryTool.arguments.view === 'workbench'
  );
}

export function validateBlockerAction(action, toolNames = new Set()) {
  if (!action || typeof action !== 'object') return { ok: false, reason: 'action_not_object' };
  const id = typeof action.id === 'string' ? action.id.trim() : '';
  const label = typeof action.label === 'string' ? action.label.trim() : '';
  const owner = typeof action.owner === 'string' ? action.owner.trim() : '';
  const risk = typeof action.risk === 'string' ? action.risk.trim() : '';
  const command = typeof action.command === 'string' ? action.command.trim() : '';
  const tool = typeof action.tool === 'string' ? action.tool.trim() : '';
  const args = action.args;
  const requiredInputs = Array.isArray(action.requiredInputs) ? action.requiredInputs : [];
  if (!id) return { ok: false, reason: 'missing_id' };
  if (!label) return { ok: false, reason: `${id}:missing_label` };
  if (!owner) return { ok: false, reason: `${id}:missing_owner` };
  if (!BLOCKER_ACTION_OWNERS.has(owner)) return { ok: false, reason: `${id}:unknown_owner=${owner}` };
  if (!risk) return { ok: false, reason: `${id}:missing_risk` };
  if (!BLOCKER_ACTION_RISKS.has(risk)) return { ok: false, reason: `${id}:unknown_risk=${risk}` };
  if (!command && !tool) return { ok: false, reason: `${id}:missing_command_or_tool` };
  if (command && !BLOCKER_ACTION_COMMANDS.has(command)) return { ok: false, reason: `${id}:unknown_command=${command}` };
  if (tool && !toolNames.has(tool)) return { ok: false, reason: `${id}:unknown_tool=${tool}` };
  if (tool && args != null && (typeof args !== 'object' || Array.isArray(args))) {
    return { ok: false, reason: `${id}:invalid_args` };
  }
  for (const input of requiredInputs) {
    if (!input || typeof input !== 'object') return { ok: false, reason: `${id}:invalid_required_input` };
    if (typeof input.name !== 'string' || !input.name.trim()) return { ok: false, reason: `${id}:required_input_missing_name` };
    if (typeof input.label !== 'string' || !input.label.trim()) return { ok: false, reason: `${id}:required_input_missing_label` };
    if (typeof input.source !== 'string' || !input.source.trim()) return { ok: false, reason: `${id}:required_input_missing_source` };
  }
  return { ok: true, reason: '' };
}

function isBlockerAction(action, toolNames = new Set()) {
  return validateBlockerAction(action, toolNames).ok;
}

function summarizeActionRequiredInputs(actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((action) => {
      const inputs = Array.isArray(action && action.requiredInputs) ? action.requiredInputs : [];
      const names = inputs
        .map((input) => String((input && (input.name || input.label)) || '').trim())
        .filter(Boolean);
      if (!names.length) return '';
      const key = String((action && (action.tool || action.command || action.id)) || 'action').trim();
      return `${key}:${names.join(',')}`;
    })
    .filter(Boolean);
}

function formatAccountDiagnostics(account = {}) {
  const a = account && typeof account === 'object' ? account : {};
  const parts = [
    `loggedIn=${Boolean(a.loggedIn)}`,
    `cookies=${Number(a.cookieCount) || 0}`,
    `authCookie=${a.hasAuthCookie ? 'present' : 'missing'}`,
    `partition=${a.partition || 'unknown'}`,
  ];
  if (a.authOrigin) parts.push(`authOrigin=${a.authOrigin}`);
  if (a.siteOrigin) parts.push(`siteOrigin=${a.siteOrigin}`);
  if (a.statusCode) parts.push(`status=${Number(a.statusCode) || 0}`);
  if (a.error) parts.push(`error=${a.error}`);
  return parts.join(' ');
}

function persistLocalWorkbenchE2e(target, summary) {
  const settingsPath = String(target?.settingsPath || '').trim();
  if (!settingsPath) return false;
  try {
    const raw = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '{}';
    const settings = raw ? JSON.parse(raw) : {};
    settings.mcpWorkbenchLastE2e = summary;
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    return true;
  } catch (e) {
    console.log(`  WARN workbench.e2e.cache - ${e && e.message ? e.message : e}`);
    return false;
  }
}

function isToolSuccess(call) {
  return call?.status === 200 && call?.json?.result && call.json.result.isError === false;
}

function policyDecisionForTool(policy, toolName) {
  const decisions = Array.isArray(policy?.toolDecisions) ? policy.toolDecisions : [];
  return decisions.find((entry) => entry && entry.name === toolName) || null;
}

async function readMcpJsonResource(target, uri, id = 'resource-read') {
  const res = await postJson(
    target.url,
    { jsonrpc: '2.0', id, method: 'resources/read', params: { uri } },
    target.token,
  );
  const text = res.json?.result?.contents?.[0]?.text || '';
  return { response: res, text, json: parseJsonText(text) };
}

async function waitForWorkbenchLoginReadiness(target, timeoutMs) {
  const maxMs = Math.max(0, Number(timeoutMs) || 0);
  if (!maxMs) return { ok: false, waitedMs: 0, account: null };
  const startedAt = Date.now();
  const deadline = startedAt + maxMs;
  let lastAccount = null;
  while (Date.now() <= deadline) {
    const status = await readMcpJsonResource(target, 'assetcutter://mcp/server-status', 'workbench-e2e-login-status');
    lastAccount =
      status.json?.readiness && typeof status.json.readiness.account === 'object'
        ? status.json.readiness.account
        : null;
    if (lastAccount && lastAccount.loggedIn === true) {
      return { ok: true, waitedMs: Date.now() - startedAt, account: lastAccount };
    }
    if (Date.now() >= deadline) break;
    await delay(Math.min(2000, Math.max(250, deadline - Date.now())));
  }
  return { ok: false, waitedMs: Date.now() - startedAt, account: lastAccount };
}

async function runWorkflowDraftLifecycleSmoke(target, tools, policyJson) {
  const toolNames = new Set(Array.isArray(tools) ? tools.map((tool) => tool.name) : []);
  const requiredTools = ['ac.skills.save', 'ac.skills.get', 'ac.skills.revisions', 'ac.skills.delete'];
  const missingTools = requiredTools.filter((name) => !toolNames.has(name));
  if (missingTools.length) {
    skip('workflow-draft.lifecycle', `missing tools: ${missingTools.join(', ')}`);
    return;
  }
  const saveDecision = policyDecisionForTool(policyJson, 'ac.skills.save');
  const deleteDecision = policyDecisionForTool(policyJson, 'ac.skills.delete');
  if (!saveDecision || !deleteDecision) {
    skip('workflow-draft.lifecycle', 'policy decisions unavailable');
    return;
  }
  if (saveDecision.decision !== 'allow' || deleteDecision.decision !== 'allow') {
    skip('workflow-draft.lifecycle', `policy requires confirmation save=${saveDecision.decision} delete=${deleteDecision.decision}`);
    return;
  }
  const canAutoRunPromotion = (toolName) => {
    if (!toolNames.has(toolName)) return false;
    const decision = policyDecisionForTool(policyJson, toolName);
    return decision && decision.decision === 'allow';
  };
  const assertPromotionPreflight = async (toolName, args, label, expectedTarget, expectedGate) => {
    if (!toolNames.has(toolName)) {
      skip(label, `${toolName} not advertised`);
      return;
    }
    if (!canAutoRunPromotion(toolName)) {
      const decision = policyDecisionForTool(policyJson, toolName);
      skip(label, `policy requires confirmation decision=${decision ? decision.decision : 'missing'}`);
      return;
    }
    const promotion = await callTool(target, toolName, args, label);
    const structured = toolStructured(promotion);
    const details = structured && structured.details && typeof structured.details === 'object' ? structured.details : {};
    if (
      promotion.status === 200 &&
      promotion.json?.result?.isError === true &&
      structured.error?.code === 'AGENT_WORKFLOW_PROMOTION_NOT_READY' &&
      details.publishable === false &&
      details.currentPhase === 'draft_only' &&
      details.target === expectedTarget &&
      Array.isArray(details.missingGates) &&
      details.missingGates.includes(expectedGate) &&
      !promotion.text.includes(target.token)
    ) {
      pass(label, `${expectedTarget} gated=${expectedGate}`);
    } else {
      fail(label, promotion.text || `status ${promotion.status}`);
    }
  };

  const skillId = `mcp-smoke-workflow-draft-${Date.now().toString(36)}`;
  let saved = false;
  try {
    const save = await callTool(
      target,
      'ac.skills.save',
      {
        skillId,
        name: 'MCP Smoke Workflow Draft',
        description: 'Temporary workflow draft created and removed by the MCP smoke test.',
        prompt:
          'Use ac.shell.get_state, inspect assetcutter://mcp/server-status, and report whether the team workbench entrance is ready.',
        toolHints: ['ac.shell.get_state'],
        workbenchPreset: {
          capability: 'workflow_text_to_image',
          modality: 'image',
          canonicalModelId: 'doubao-seedream-5-0',
          providerId: 'volcengine-ark',
          assetContext: { mode: 'current_project' },
        },
        scriptManifest: {
          schemaVersion: 1,
          id: skillId.replace(/^mcp-smoke-workflow-draft-/, 'mcp-smoke-').slice(0, 64),
          name: 'MCP Smoke Workflow Draft',
          description: 'Temporary Script Hub manifest used by the MCP smoke test.',
          semver: '0.1.0',
          launch: { kind: 'shell_module', module: 'module/panel.json' },
          run: { command: ['node', 'scripts/run.mjs'], paramsMode: 'env' },
          permissions: ['tool.run'],
        },
      },
      'workflow-draft-save',
    );
    if (!isToolSuccess(save) || toolStructured(save).skill?.id !== skillId) {
      fail('workflow-draft.save', save.text || `status ${save.status}`);
      return;
    }
    saved = true;
    pass('workflow-draft.save', skillId);

    const prompt = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'workflow-draft-prompt', method: 'prompts/get', params: { name: `skill:${skillId}` } },
      target.token,
    );
    if (prompt.status === 200 && Array.isArray(prompt.json?.result?.messages)) {
      pass('workflow-draft.prompt', `skill:${skillId}`);
    } else {
      fail('workflow-draft.prompt', prompt.text || `status ${prompt.status}`);
    }

    const skillResource = await readMcpJsonResource(target, `skill://${skillId}`, 'workflow-draft-resource');
    if (skillResource.response.status === 200 && skillResource.json?.id === skillId && !skillResource.text.includes(target.token)) {
      pass('workflow-draft.resource', `skill://${skillId}`);
    } else {
      fail('workflow-draft.resource', skillResource.response.text || `status ${skillResource.response.status}`);
    }

    const get = await callTool(target, 'ac.skills.get', { skillId }, 'workflow-draft-get');
    const getStructured = toolStructured(get);
    const gotSkillId = getStructured.skill && typeof getStructured.skill === 'object' ? getStructured.skill.id : getStructured.id;
    if (isToolSuccess(get) && gotSkillId === skillId) {
      pass('workflow-draft.get', skillId);
    } else {
      fail('workflow-draft.get', get.text || `status ${get.status}`);
    }

    const revisions = await callTool(target, 'ac.skills.revisions', { skillId }, 'workflow-draft-revisions');
    if (isToolSuccess(revisions) && toolStructured(revisions).skillId === skillId) {
      pass('workflow-draft.revisions', skillId);
    } else {
      fail('workflow-draft.revisions', revisions.text || `status ${revisions.status}`);
    }

    await assertPromotionPreflight(
      'ac.workflow.promote_workbench_preset',
      { skillId, presetName: 'MCP Smoke Workflow Draft' },
      'workflow-draft.promote_workbench_preflight',
      'workbench_preset',
      'workbench_login_e2e_ready',
    );
    await assertPromotionPreflight(
      'ac.workflow.promote_script_hub_tool',
      { skillId, toolName: 'MCP Smoke Workflow Draft' },
      'workflow-draft.promote_script_hub_preflight',
      'script_hub_tool',
      'admin_confirmation',
    );
  } finally {
    if (saved) {
      const deleted = await callTool(target, 'ac.skills.delete', { skillId }, 'workflow-draft-delete');
      if (isToolSuccess(deleted) && toolStructured(deleted).deleted === true) {
        pass('workflow-draft.delete', skillId);
      } else {
        fail('workflow-draft.delete', deleted.text || `status ${deleted.status}`);
      }
    }
  }
}

async function printStatusSummary(target) {
  const emitJson = Boolean(target.statusJson);
  const writeJson = (payload) => {
    console.log(JSON.stringify(payload, null, 2));
  };
  if (!emitJson) console.log('[agent-mcp-status] target:', target.url);
  if (!target.token) {
    if (emitJson) writeJson({ ok: false, target: target.url, error: 'token_missing' });
    else console.log('mcp: token missing');
    process.exitCode = 1;
    return;
  }
  const status = await readMcpJsonResource(target, 'assetcutter://mcp/server-status', 'server-status-summary');
  if (status.response.status !== 200 || !status.json || !status.json.readiness) {
    const payload = {
      ok: false,
      target: target.url,
      error: 'server_status_unavailable',
      status: status.response.status,
      detail: status.text ? status.text.slice(0, 500) : '',
    };
    if (emitJson) writeJson(payload);
    else {
      console.log(`mcp: unavailable status=${status.response.status}`);
      if (status.text) console.log(status.text.slice(0, 500));
    }
    process.exitCode = 1;
    return;
  }
  const readiness = status.json.readiness || {};
  const codex = readiness.codexRuntime && typeof readiness.codexRuntime === 'object' ? readiness.codexRuntime : {};
  const account = readiness.account && typeof readiness.account === 'object' ? readiness.account : {};
  const entrance =
    readiness.workbenchEntrance && typeof readiness.workbenchEntrance === 'object' ? readiness.workbenchEntrance : {};
  const freshness =
    readiness.lastWorkbenchE2eFreshness && typeof readiness.lastWorkbenchE2eFreshness === 'object'
      ? readiness.lastWorkbenchE2eFreshness
      : {};
  const acceptance =
    readiness.workbenchE2eAcceptance && typeof readiness.workbenchE2eAcceptance === 'object'
      ? readiness.workbenchE2eAcceptance
      : {};
  const usage = readiness.usageAudit && typeof readiness.usageAudit === 'object' ? readiness.usageAudit : {};
  const usageGovernanceEvidence =
    usage.governanceEvidence && typeof usage.governanceEvidence === 'object' ? usage.governanceEvidence : {};
  const usageTotals = usage.totals && typeof usage.totals === 'object' ? usage.totals : {};
  const compactUsageRows = (rows) =>
    Array.isArray(rows)
      ? rows
          .slice(0, 3)
          .map((row) => ({
            key: row && row.key ? String(row.key) : '',
            turns: Number(row && row.turns) || 0,
            totalTokens: Number(row && row.totalTokens) || 0,
            lastAt: row && row.lastAt ? String(row.lastAt) : '',
          }))
      : [];
  const workflow =
    readiness.workflowPublication && typeof readiness.workflowPublication === 'object' ? readiness.workflowPublication : {};
  const workflowPromotion =
    workflow.promotionReadiness && typeof workflow.promotionReadiness === 'object' ? workflow.promotionReadiness : {};
  const workflowPromotionPreflightEvidence =
    workflow.promotionPreflightEvidence && typeof workflow.promotionPreflightEvidence === 'object'
      ? workflow.promotionPreflightEvidence
      : {};
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const freshInputTokens = Number(usageTotals.freshInputTokens) || 0;
  const cachedInputTokens = Number(usageTotals.cachedInputTokens) || 0;
  const outputTokens = Number(usageTotals.outputTokens) || 0;
  const recovery = {
    statusCommand: WORKBENCH_STATUS_COMMAND,
    openLoginCommand: entrance.openLoginCommand || WORKBENCH_OPEN_LOGIN_COMMAND,
    waitLoginCommand: entrance.waitLoginCommand || WORKBENCH_WAIT_LOGIN_COMMAND,
    openLoginWaitCommand: entrance.openLoginWaitCommand || WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
    e2eCommand: entrance.e2eCommand || WORKBENCH_E2E_COMMAND,
  };
  const payload = {
    ok: entrance.status === 'ready',
    target: target.url,
    generatedAt: status.json.generatedAt || '',
    readiness: {
      workbenchUsable: Boolean(readiness.workbenchUsable ?? entrance.ready),
      teamEntranceReady: Boolean(readiness.teamEntranceReady),
      teamEntrancePhase: readiness.teamEntrancePhase || '',
      teamEntranceBlockers: Array.isArray(readiness.teamEntranceBlockers)
        ? readiness.teamEntranceBlockers.map(String)
        : blockers.map((blocker) => String(blocker && blocker.id ? blocker.id : 'unknown')),
    },
    codex: {
      readyHint: Boolean(codex.readyHint),
      command: codex.command || '',
      cwd: codex.cwd || '',
      cwdExists: Boolean(codex.cwdExists),
      model: codex.model || '',
      sandbox: codex.sandbox || '',
      defaultBrain: codex.defaultBrain || '',
      isDefaultBrain: Boolean(codex.isDefaultBrain),
      authPresent: Boolean(codex.auth?.exists),
    },
    workbench: {
      status: entrance.status || 'unknown',
      ready: Boolean(entrance.ready),
      severity: entrance.severity || 'unknown',
      e2eFreshness: freshness.status || 'unknown',
      nextStep: entrance.nextStep || '',
      checkedAt: entrance.checkedAt || freshness.checkedAt || '',
      requiredChain: Array.isArray(entrance.requiredChain) ? entrance.requiredChain : [],
      acceptance: {
        passed: Boolean(acceptance.passed),
        status: acceptance.status || '',
        proofSource: acceptance.proofSource || '',
        blockingReason: acceptance.blockingReason || '',
        completionCriteria: Array.isArray(acceptance.completionCriteria)
          ? acceptance.completionCriteria.map(String)
          : [],
      },
      recovery,
    },
    account: {
      loggedIn: Boolean(account.loggedIn),
      cookieCount: Number(account.cookieCount) || 0,
      hasAuthCookie: Boolean(account.hasAuthCookie),
      partition: account.partition || '',
      authOrigin: account.authOrigin || '',
      siteOrigin: account.siteOrigin || '',
      statusCode: Number(account.statusCode) || 0,
      error: account.error || '',
    },
    usage: {
      resource: 'assetcutter://mcp/usage-audit',
      source: 'local_companion_audit_log',
      currentPhase: usage.currentPhase || 'local_usage_signal',
      cloudEnforced: Boolean(usage.cloudEnforced),
      cloudDraft:
        usage.cloudDraft && typeof usage.cloudDraft === 'object'
          ? {
              currentPhase: usage.cloudDraft.currentPhase || '',
              targetApi: usage.cloudDraft.targetApi || '',
              eventCount: Number(usage.cloudDraft.eventCount) || 0,
              uploadReady: Boolean(usage.cloudDraft.uploadReady),
              blockedBy: Array.isArray(usage.cloudDraft.blockedBy) ? usage.cloudDraft.blockedBy.map(String) : [],
              uploadPlan:
                usage.cloudDraft.uploadPlan && typeof usage.cloudDraft.uploadPlan === 'object'
                  ? {
                      endpoint: usage.cloudDraft.uploadPlan.endpoint || '',
                      method: usage.cloudDraft.uploadPlan.method || '',
                      credentials: usage.cloudDraft.uploadPlan.credentials || '',
                      tool: usage.cloudDraft.uploadPlan.tool || '',
                      idempotencyScope: usage.cloudDraft.uploadPlan.idempotencyScope || '',
                      safeToRetry: Boolean(
                        usage.cloudDraft.uploadPlan.retry && usage.cloudDraft.uploadPlan.retry.safeToRetry,
                      ),
                    }
                  : undefined,
              quotaPolicy:
                usage.cloudDraft.quotaPolicy && typeof usage.cloudDraft.quotaPolicy === 'object'
                  ? {
                      currentPhase: usage.cloudDraft.quotaPolicy.currentPhase || '',
                      billingSku: usage.cloudDraft.quotaPolicy.billingSku || '',
                      billingSkuRegisteredInDefaultCatalog: Boolean(
                        usage.cloudDraft.quotaPolicy.billingSkuRegisteredInDefaultCatalog,
                      ),
                      usageBillingApiConfigured: Boolean(usage.cloudDraft.quotaPolicy.usageBillingApiConfigured),
                      cloudQuotaEnforced: Boolean(usage.cloudDraft.quotaPolicy.cloudQuotaEnforced),
                      usageBillingEnabled: Boolean(usage.cloudDraft.quotaPolicy.usageBillingEnabled),
                      enforcementSource: usage.cloudDraft.quotaPolicy.enforcementSource || '',
                      policyId: usage.cloudDraft.quotaPolicy.policyId || '',
                      probeTool: usage.cloudDraft.quotaPolicy.probeTool || '',
                      policyEndpoint: usage.cloudDraft.quotaPolicy.policyEndpoint || '',
                    }
                  : undefined,
            }
          : null,
      windowDays: Number(usage.windowDays) || 0,
      turns: Number(usageTotals.turns) || 0,
      totalTokens: Number(usageTotals.totalTokens) || 0,
      inputTokens: freshInputTokens + cachedInputTokens,
      freshInputTokens,
      cachedInputTokens,
      outputTokens,
      byBrain: compactUsageRows(usage.byBrain),
      bySession: compactUsageRows(usage.bySession),
      governanceEvidence: {
        resource: usageGovernanceEvidence.resource || 'assetcutter://mcp/tool-executions',
        windowDays: Number(usageGovernanceEvidence.windowDays) || 1,
        count: Number(usageGovernanceEvidence.count) || 0,
        latest:
          usageGovernanceEvidence.latest && typeof usageGovernanceEvidence.latest === 'object'
            ? {
                ts: usageGovernanceEvidence.latest.ts || '',
                tool: usageGovernanceEvidence.latest.tool || '',
                toolCallId: usageGovernanceEvidence.latest.toolCallId || '',
                traceId: usageGovernanceEvidence.latest.traceId || '',
                action: usageGovernanceEvidence.latest.action || '',
                endpoint: usageGovernanceEvidence.latest.endpoint || '',
                partition: usageGovernanceEvidence.latest.partition || '',
                ok: Boolean(usageGovernanceEvidence.latest.ok),
                code: usageGovernanceEvidence.latest.code || '',
                authRequired: Boolean(usageGovernanceEvidence.latest.authRequired),
                dryRun: Boolean(usageGovernanceEvidence.latest.dryRun),
                uploaded: Boolean(usageGovernanceEvidence.latest.uploaded),
                validated: Boolean(usageGovernanceEvidence.latest.validated),
                noEvents: Boolean(usageGovernanceEvidence.latest.noEvents),
                eventCount: Number(usageGovernanceEvidence.latest.eventCount) || 0,
                exitReady: Boolean(usageGovernanceEvidence.latest.exitReady),
                clearedGates: Array.isArray(usageGovernanceEvidence.latest.clearedGates)
                  ? usageGovernanceEvidence.latest.clearedGates.map(String)
                  : [],
                remainingGates: Array.isArray(usageGovernanceEvidence.latest.remainingGates)
                  ? usageGovernanceEvidence.latest.remainingGates.map(String)
                  : [],
                quotaPolicy:
                  usageGovernanceEvidence.latest.quotaPolicy &&
                  typeof usageGovernanceEvidence.latest.quotaPolicy === 'object'
                    ? {
                        currentPhase: usageGovernanceEvidence.latest.quotaPolicy.currentPhase || '',
                        billingSku: usageGovernanceEvidence.latest.quotaPolicy.billingSku || '',
                        cloudQuotaEnforced: Boolean(usageGovernanceEvidence.latest.quotaPolicy.cloudQuotaEnforced),
                        usageBillingEnabled: Boolean(usageGovernanceEvidence.latest.quotaPolicy.usageBillingEnabled),
                        enforcementSource: usageGovernanceEvidence.latest.quotaPolicy.enforcementSource || '',
                        policyId: usageGovernanceEvidence.latest.quotaPolicy.policyId || '',
                      }
                    : undefined,
              }
            : null,
      },
      privacyExcludes: ['raw_prompts', 'secrets', 'mcp_tokens', 'cookie_values', 'tool_arguments'],
      nextGovernanceStep: 'Connect local usage summaries to the cloud team quota/audit API before enforcing budgets.',
    },
    workflow: {
      status: workflow.status || 'unknown',
      ready: Boolean(workflow.ready),
      phase: workflow.phase || '',
      draftTool: workflow.draftTool || '',
      nextStep: workflow.nextStep || '',
      promotion: {
        currentPhase: workflowPromotion.currentPhase || '',
        publishableNow: Boolean(workflowPromotion.publishableNow),
        preflightEvidence: {
          resource: workflowPromotionPreflightEvidence.resource || 'assetcutter://mcp/tool-executions',
          windowDays: Number(workflowPromotionPreflightEvidence.windowDays) || 1,
          count: Number(workflowPromotionPreflightEvidence.count) || 0,
          latest:
            workflowPromotionPreflightEvidence.latest &&
            typeof workflowPromotionPreflightEvidence.latest === 'object'
              ? {
                  ts: workflowPromotionPreflightEvidence.latest.ts || '',
                  tool: workflowPromotionPreflightEvidence.latest.tool || '',
                  toolCallId: workflowPromotionPreflightEvidence.latest.toolCallId || '',
                  traceId: workflowPromotionPreflightEvidence.latest.traceId || '',
                  target: workflowPromotionPreflightEvidence.latest.target || '',
                  skillId: workflowPromotionPreflightEvidence.latest.skillId || '',
                  skillExists: Boolean(workflowPromotionPreflightEvidence.latest.skillExists),
                  evidenceCurrent: Boolean(workflowPromotionPreflightEvidence.latest.evidenceCurrent),
                  staleReason: workflowPromotionPreflightEvidence.latest.staleReason || '',
                  currentPhase: workflowPromotionPreflightEvidence.latest.currentPhase || '',
                  publishable: Boolean(workflowPromotionPreflightEvidence.latest.publishable),
                  passedGates: Array.isArray(workflowPromotionPreflightEvidence.latest.passedGates)
                    ? workflowPromotionPreflightEvidence.latest.passedGates.map(String)
                    : [],
                  missingGates: Array.isArray(workflowPromotionPreflightEvidence.latest.missingGates)
                    ? workflowPromotionPreflightEvidence.latest.missingGates.map(String)
                    : [],
                  adminConfirmation:
                    workflowPromotionPreflightEvidence.latest.adminConfirmation &&
                    typeof workflowPromotionPreflightEvidence.latest.adminConfirmation === 'object'
                      ? {
                          required: Boolean(workflowPromotionPreflightEvidence.latest.adminConfirmation.required),
                          passed: Boolean(workflowPromotionPreflightEvidence.latest.adminConfirmation.passed),
                          sourceRequired:
                            workflowPromotionPreflightEvidence.latest.adminConfirmation.sourceRequired || 'copilot_ui',
                          source: workflowPromotionPreflightEvidence.latest.adminConfirmation.source || '',
                          autoConfirmCountsAsAdminApproval: Boolean(
                            workflowPromotionPreflightEvidence.latest.adminConfirmation.autoConfirmCountsAsAdminApproval,
                          ),
                        }
                      : undefined,
                }
              : null,
        },
        targets: Array.isArray(workflowPromotion.targets)
          ? workflowPromotion.targets.map((target) => ({
              id: target.id || '',
              status: target.status || '',
              plannedTool: target.plannedTool || '',
              toolPresent: Boolean(target.toolPresent),
              ready: Boolean(target.ready),
              requiredGates: Array.isArray(target.requiredGates) ? target.requiredGates.map(String) : [],
              passedGates: Array.isArray(target.passedGates) ? target.passedGates.map(String) : [],
              missingGates: Array.isArray(target.missing) ? target.missing.map(String) : [],
              unevaluatedGates: Array.isArray(target.unevaluatedGates) ? target.unevaluatedGates.map(String) : [],
              adminConfirmation:
                target.adminConfirmation && typeof target.adminConfirmation === 'object'
                  ? {
                      required: Boolean(target.adminConfirmation.required),
                      passed: Boolean(target.adminConfirmation.passed),
                      sourceRequired: target.adminConfirmation.sourceRequired || 'copilot_ui',
                      autoConfirmCountsAsAdminApproval: Boolean(target.adminConfirmation.autoConfirmCountsAsAdminApproval),
                    }
                  : undefined,
              nextStep: target.nextStep || '',
            }))
          : [],
      },
    },
    blockers: blockers.map((blocker) => ({
      id: blocker.id || '',
      severity: blocker.severity || '',
      owner: blocker.owner || '',
      nextStep: blocker.nextStep || '',
      command: blocker.command || '',
      actions: Array.isArray(blocker.actions)
        ? blocker.actions.map((action) => ({
            id: action && action.id ? String(action.id) : '',
            label: action && action.label ? String(action.label) : '',
            command: action && action.command ? String(action.command) : '',
            tool: action && action.tool ? String(action.tool) : '',
            args:
              action && action.args && typeof action.args === 'object'
                ? JSON.parse(JSON.stringify(action.args))
                : action && Object.prototype.hasOwnProperty.call(action, 'args')
                  ? action.args
                  : undefined,
            owner: action && action.owner ? String(action.owner) : '',
            risk: action && action.risk ? String(action.risk) : '',
            requiredInputs: Array.isArray(action && action.requiredInputs)
              ? action.requiredInputs.map((input) => ({
                  name: input && input.name ? String(input.name) : '',
                  label: input && input.label ? String(input.label) : '',
                  source: input && input.source ? String(input.source) : '',
                  placeholder: input && input.placeholder ? String(input.placeholder) : '',
                }))
              : undefined,
          }))
        : [],
      phase: blocker.phase || '',
      resource: blocker.resource || '',
      currentPhase: blocker.currentPhase || blocker.phase || '',
      cloudEnforced: Object.prototype.hasOwnProperty.call(blocker, 'cloudEnforced')
        ? Boolean(blocker.cloudEnforced)
        : undefined,
      cloudDraft:
        blocker.cloudDraft && typeof blocker.cloudDraft === 'object'
          ? {
              currentPhase: blocker.cloudDraft.currentPhase || '',
              targetApi: blocker.cloudDraft.targetApi || '',
              eventCount: Number(blocker.cloudDraft.eventCount) || 0,
              uploadReady: Boolean(blocker.cloudDraft.uploadReady),
              blockedBy: Array.isArray(blocker.cloudDraft.blockedBy) ? blocker.cloudDraft.blockedBy.map(String) : [],
              uploadPlan:
                blocker.cloudDraft.uploadPlan && typeof blocker.cloudDraft.uploadPlan === 'object'
                  ? {
                      endpoint: blocker.cloudDraft.uploadPlan.endpoint || '',
                      method: blocker.cloudDraft.uploadPlan.method || '',
                      credentials: blocker.cloudDraft.uploadPlan.credentials || '',
                      tool: blocker.cloudDraft.uploadPlan.tool || '',
                      idempotencyScope: blocker.cloudDraft.uploadPlan.idempotencyScope || '',
                      safeToRetry: Boolean(blocker.cloudDraft.uploadPlan.safeToRetry),
                    }
                  : undefined,
              quotaPolicy:
                blocker.cloudDraft.quotaPolicy && typeof blocker.cloudDraft.quotaPolicy === 'object'
                  ? {
                      currentPhase: blocker.cloudDraft.quotaPolicy.currentPhase || '',
                      billingSku: blocker.cloudDraft.quotaPolicy.billingSku || '',
                      billingSkuRegisteredInDefaultCatalog: Boolean(
                        blocker.cloudDraft.quotaPolicy.billingSkuRegisteredInDefaultCatalog,
                      ),
                      usageBillingApiConfigured: Boolean(blocker.cloudDraft.quotaPolicy.usageBillingApiConfigured),
                      cloudQuotaEnforced: Boolean(blocker.cloudDraft.quotaPolicy.cloudQuotaEnforced),
                      usageBillingEnabled: Boolean(blocker.cloudDraft.quotaPolicy.usageBillingEnabled),
                      enforcementSource: blocker.cloudDraft.quotaPolicy.enforcementSource || '',
                      policyId: blocker.cloudDraft.quotaPolicy.policyId || '',
                      probeTool: blocker.cloudDraft.quotaPolicy.probeTool || '',
                      policyEndpoint: blocker.cloudDraft.quotaPolicy.policyEndpoint || '',
                    }
                  : undefined,
            }
          : undefined,
      publishableNow: Object.prototype.hasOwnProperty.call(blocker, 'publishableNow')
        ? Boolean(blocker.publishableNow)
        : undefined,
      missingGates: Array.isArray(blocker.missingGates) ? blocker.missingGates.map(String) : [],
      promotionTargets: Array.isArray(blocker.promotionTargets)
        ? blocker.promotionTargets.map((target) => ({
            id: target && target.id ? String(target.id) : '',
            status: target && target.status ? String(target.status) : '',
            plannedTool: target && target.plannedTool ? String(target.plannedTool) : '',
            passedGates: Array.isArray(target && target.passedGates) ? target.passedGates.map(String) : [],
            missingGates: Array.isArray(target && target.missingGates) ? target.missingGates.map(String) : [],
            unevaluatedGates: Array.isArray(target && target.unevaluatedGates)
              ? target.unevaluatedGates.map(String)
              : [],
            adminConfirmation:
              target && target.adminConfirmation && typeof target.adminConfirmation === 'object'
                ? {
                    required: Boolean(target.adminConfirmation.required),
                    passed: Boolean(target.adminConfirmation.passed),
                    sourceRequired: target.adminConfirmation.sourceRequired || 'copilot_ui',
                    autoConfirmCountsAsAdminApproval: Boolean(target.adminConfirmation.autoConfirmCountsAsAdminApproval),
                  }
                : undefined,
          }))
        : [],
    })),
  };
  if (emitJson) {
    writeJson(payload);
    if (!payload.ok) process.exitCode = 1;
    return;
  }
  console.log(
    `codex: readyHint=${Boolean(codex.readyHint)} command=${codex.command || 'unset'} cwdExists=${Boolean(
      codex.cwdExists,
    )} sandbox=${codex.sandbox || 'unset'} default=${codex.defaultBrain || 'unset'} auth=${codex.auth?.exists ? 'present' : 'missing'}`,
  );
  console.log(
    `workbench: status=${entrance.status || 'unknown'} ready=${Boolean(entrance.ready)} severity=${
      entrance.severity || 'unknown'
    } e2e=${freshness.status || 'unknown'}`,
  );
  console.log(
    `workbenchAcceptance: passed=${Boolean(acceptance.passed)} status=${
      acceptance.status || 'unknown'
    } reason=${acceptance.blockingReason || 'none'}`,
  );
  console.log(
    `teamEntrance: ready=${Boolean(readiness.teamEntranceReady)} phase=${
      readiness.teamEntrancePhase || 'unknown'
    } workbenchUsable=${Boolean(readiness.workbenchUsable ?? entrance.ready)}`,
  );
  console.log(
    `account: ${formatAccountDiagnostics(account)}`,
  );
  if (account.authOrigin || account.siteOrigin || account.statusCode || account.error) {
    console.log(
      `accountDiag: authOrigin=${account.authOrigin || '-'} siteOrigin=${account.siteOrigin || '-'} status=${Number(
        account.statusCode,
      ) || 0}${account.error ? ` error=${account.error}` : ''}`,
    );
  }
  console.log(
    `usage: phase=${usage.currentPhase || 'local_usage_signal'} cloudEnforced=${Boolean(usage.cloudEnforced)} windowDays=${Number(usage.windowDays) || 0} turns=${
      Number(usageTotals.turns) || 0
    } totalTokens=${Number(usageTotals.totalTokens) || 0}`,
  );
  const usageUploadPlan = usage.cloudDraft && usage.cloudDraft.uploadPlan && typeof usage.cloudDraft.uploadPlan === 'object'
    ? usage.cloudDraft.uploadPlan
    : null;
  if (usageUploadPlan) {
    console.log(
      `usageUpload: endpoint=${usageUploadPlan.endpoint || 'unknown'} ready=${Boolean(
        usage.cloudDraft.uploadReady,
      )} credentials=${usageUploadPlan.credentials || 'unknown'} tool=${usageUploadPlan.tool || 'unknown'}`,
    );
  }
  const usageQuotaPolicy = usage.cloudDraft && usage.cloudDraft.quotaPolicy && typeof usage.cloudDraft.quotaPolicy === 'object'
    ? usage.cloudDraft.quotaPolicy
    : null;
  if (usageQuotaPolicy) {
    console.log(
      `usageQuota: sku=${usageQuotaPolicy.billingSku || 'unknown'} catalog=${Boolean(
        usageQuotaPolicy.billingSkuRegisteredInDefaultCatalog,
      )} enforced=${Boolean(usageQuotaPolicy.cloudQuotaEnforced)} probe=${usageQuotaPolicy.probeTool || 'none'}`,
    );
  }
  const latestUsageEvidence =
    usageGovernanceEvidence.latest && typeof usageGovernanceEvidence.latest === 'object'
      ? usageGovernanceEvidence.latest
      : null;
  if (latestUsageEvidence) {
    const remaining = Array.isArray(latestUsageEvidence.remainingGates)
      ? latestUsageEvidence.remainingGates.map(String).filter(Boolean).slice(0, 4)
      : [];
    console.log(
      `usageEvidence: action=${latestUsageEvidence.action || 'unknown'} ok=${Boolean(
        latestUsageEvidence.ok,
      )} code=${latestUsageEvidence.code || 'none'} endpoint=${latestUsageEvidence.endpoint || 'unknown'} partition=${
        latestUsageEvidence.partition || 'unknown'
      } events=${Number(latestUsageEvidence.eventCount) || 0} exitReady=${Boolean(latestUsageEvidence.exitReady)}${
        remaining.length ? ` remaining=${remaining.join('|')}` : ''
      }`,
    );
  }
  console.log(
    `workflow: status=${workflow.status || 'unknown'} ready=${Boolean(workflow.ready)} phase=${
      workflow.phase || 'unknown'
    } draftTool=${workflow.draftTool || 'unset'}`,
  );
  if (workflowPromotion.currentPhase) {
    console.log(
      `promotion: phase=${workflowPromotion.currentPhase} publishableNow=${Boolean(workflowPromotion.publishableNow)}`,
    );
    if (Array.isArray(workflowPromotion.targets) && workflowPromotion.targets.length) {
      const targetSummary = workflowPromotion.targets
        .slice(0, 3)
        .map((target) => {
          const missing = Array.isArray(target.missing) ? target.missing.map(String).filter(Boolean).slice(0, 2) : [];
          return `${target.id || 'unknown'}=${target.status || 'unknown'}${missing.length ? ` missing=${missing.join('|')}` : ''}`;
        })
        .join(', ');
      if (targetSummary) console.log(`promotionTargets: ${targetSummary}`);
      const passedSummary = workflowPromotion.targets
        .slice(0, 3)
        .map((target) => {
          const passed = Array.isArray(target.passedGates) ? target.passedGates.map(String).filter(Boolean).slice(0, 3) : [];
          return passed.length ? `${target.id || 'unknown'}=${passed.join('|')}` : '';
        })
        .filter(Boolean)
        .join(', ');
      if (passedSummary) console.log(`promotionPassed: ${passedSummary}`);
      const unevaluatedSummary = workflowPromotion.targets
        .slice(0, 3)
        .map((target) => {
          const unevaluated = Array.isArray(target.unevaluatedGates)
            ? target.unevaluatedGates.map(String).filter(Boolean).slice(0, 3)
            : [];
          return unevaluated.length ? `${target.id || 'unknown'}=${unevaluated.join('|')}` : '';
        })
        .filter(Boolean)
        .join(', ');
      if (unevaluatedSummary) console.log(`promotionUnevaluated: ${unevaluatedSummary}`);
      const adminSummary = workflowPromotion.targets
        .slice(0, 3)
        .map((target) => {
          const gate = target && target.adminConfirmation && typeof target.adminConfirmation === 'object'
            ? target.adminConfirmation
            : null;
          return gate && gate.required
            ? `${target.id || 'unknown'}=${gate.passed ? 'passed' : 'missing'}:${gate.sourceRequired || 'copilot_ui'}`
            : '';
        })
        .filter(Boolean)
        .join(', ');
      if (adminSummary) console.log(`promotionAdmin: ${adminSummary}`);
    }
    const latestPreflight =
      workflowPromotionPreflightEvidence.latest && typeof workflowPromotionPreflightEvidence.latest === 'object'
        ? workflowPromotionPreflightEvidence.latest
        : null;
    if (latestPreflight) {
      const missing = Array.isArray(latestPreflight.missingGates)
        ? latestPreflight.missingGates.map(String).filter(Boolean).slice(0, 4)
        : [];
      const passed = Array.isArray(latestPreflight.passedGates)
        ? latestPreflight.passedGates.map(String).filter(Boolean).slice(0, 4)
        : [];
      const admin =
        latestPreflight.adminConfirmation && typeof latestPreflight.adminConfirmation === 'object'
          ? latestPreflight.adminConfirmation
          : {};
      console.log(
        `promotionPreflight: target=${latestPreflight.target || 'unknown'} skill=${latestPreflight.skillId || 'unknown'} skillExists=${Boolean(latestPreflight.skillExists)} current=${Boolean(latestPreflight.evidenceCurrent)}${
          latestPreflight.staleReason ? ` stale=${latestPreflight.staleReason}` : ''
        } admin=${
          admin.passed ? 'passed' : 'missing'
        } passed=${passed.join('|') || '-'} missing=${missing.join('|') || '-'}`,
      );
    }
  }
  if (blockers.length) {
    console.log(`blockers: ${blockers.map((blocker) => blocker.id || 'unknown').join(', ')}`);
    const loginBlocker = blockers.find((blocker) => blocker && blocker.id === 'workbench_login_required');
    const loginActions = Array.isArray(loginBlocker && loginBlocker.actions)
      ? loginBlocker.actions
          .map((action) => action && (action.tool || action.command || action.id))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    if (loginActions.length) console.log(`blocker.workbench_login.actions=${loginActions.join('|')}`);
    const workflowBlocker = blockers.find((blocker) => blocker && blocker.id === 'workflow_promotion_draft_only');
    const workflowMissing = Array.isArray(workflowBlocker && workflowBlocker.missingGates)
      ? workflowBlocker.missingGates.map(String).filter(Boolean).slice(0, 4)
      : [];
    if (workflowMissing.length) console.log(`blocker.workflow_promotion.missing=${workflowMissing.join('|')}`);
    const workflowActions = Array.isArray(workflowBlocker && workflowBlocker.actions)
      ? workflowBlocker.actions
          .map((action) => action && (action.tool || action.command || action.id))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    if (workflowActions.length) console.log(`blocker.workflow_promotion.actions=${workflowActions.join('|')}`);
    const workflowInputs = summarizeActionRequiredInputs(workflowBlocker && workflowBlocker.actions).slice(0, 4);
    if (workflowInputs.length) console.log(`blocker.workflow_promotion.inputs=${workflowInputs.join('|')}`);
    const workflowPassed = Array.isArray(workflowBlocker && workflowBlocker.promotionTargets)
      ? workflowBlocker.promotionTargets
          .map((target) => {
            const passed = Array.isArray(target && target.passedGates) ? target.passedGates.map(String).filter(Boolean).slice(0, 3) : [];
            return passed.length ? `${target.id || 'target'}=${passed.join('|')}` : '';
          })
          .filter(Boolean)
      : [];
    if (workflowPassed.length) console.log(`blocker.workflow_promotion.passed=${workflowPassed.join(',')}`);
    const usageBlocker = blockers.find((blocker) => blocker && blocker.id === 'usage_governance_local_only');
    if (usageBlocker) {
      console.log(
        `blocker.usage_governance.phase=${usageBlocker.phase || 'unknown'} cloudEnforced=${Boolean(
          usageBlocker.cloudEnforced,
        )}`,
      );
      const usageMissing = Array.isArray(usageBlocker.missingGates)
        ? usageBlocker.missingGates.map(String).filter(Boolean).slice(0, 4)
        : [];
      if (usageMissing.length) console.log(`blocker.usage_governance.missing=${usageMissing.join('|')}`);
      const usageActions = Array.isArray(usageBlocker.actions)
        ? usageBlocker.actions
            .map((action) => action && (action.tool || action.command || action.id))
            .filter(Boolean)
            .slice(0, 4)
        : [];
      if (usageActions.length) console.log(`blocker.usage_governance.actions=${usageActions.join('|')}`);
    }
  }
  console.log(`recovery: openLoginWait="${recovery.openLoginWaitCommand}" waitLogin="${recovery.waitLoginCommand}"`);
  if (entrance.nextStep) console.log(`next: ${entrance.nextStep}`);
  if (!payload.ok) process.exitCode = 1;
}

async function openWorkbenchLogin(target) {
  console.log('[agent-mcp-login] target:', target.url);
  if (!target.token) {
    console.log('mcp: token missing');
    process.exitCode = 1;
    return false;
  }
  const nav = await callTool(target, 'ac.shell.navigate', { view: 'workbench' }, 'open-workbench-login');
  if (nav.status === 200 && nav.json?.result && nav.json.result.isError !== true) {
    console.log('login: opened embedded Workbench');
    return true;
  } else {
    console.log(`login: failed to open embedded Workbench status=${nav.status}`);
    if (nav.text) console.log(nav.text.slice(0, 500));
    process.exitCode = 1;
    return false;
  }
}

async function openWorkbenchLoginAndPrintStatus(target) {
  const ok = await openWorkbenchLogin(target);
  if (!ok) return;
  await printStatusSummary(target);
}

function chooseWorkbenchPreset(context, requestedPresetId) {
  const presets = Array.isArray(context?.capabilityPresets) ? context.capabilityPresets : [];
  if (requestedPresetId) return presets.find((p) => p.id === requestedPresetId) || null;
  const direct = presets.filter((p) => p && p.directRunSupported === true && p.requiresImage !== true);
  const isLightTextPreset = (preset) => {
    const text = JSON.stringify({
      id: preset?.id,
      label: preset?.label,
      name: preset?.name,
      kind: preset?.kind,
      category: preset?.category,
      outputKind: preset?.outputKind,
      acceptsText: preset?.acceptsText,
    }).toLowerCase();
    if (/video|3d|image|photo|render|generate_video|generate_image|t2i|i2v|text[_-]?to[_-]?image/.test(text)) return false;
    return preset?.acceptsText === true || /text|note|summary|summar|caption|verify|smoke/.test(text);
  };
  return (
    direct.find((p) => p && p.id === AGENT_WORKBENCH_SMOKE_PRESET_ID) ||
    direct.find(isLightTextPreset) ||
    direct.find((p) => p.acceptsText === true) ||
    direct[0] ||
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
          const loginWait = await waitForWorkbenchLoginReadiness(target, target.workbenchRecoveryWaitMs);
          const account = loginWait.account || {};
          pass(
            'workbench.e2e.recovery_wait',
            loginWait.ok
              ? `waited=${loginWait.waitedMs}ms ${formatAccountDiagnostics(account)}`
              : `timeout=${target.workbenchRecoveryWaitMs}ms ${formatAccountDiagnostics(account)}`,
          );
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
      const next = [toolNextStep(readyCall), workbenchLoginNextStep(readyCall)].filter(Boolean).join(' ');
      fail('workbench.e2e.ensure_ready', `${toolErrorCode(readyCall) || readyCall.status}: ${next}`);
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
  const account = shellAccountReadiness && typeof shellAccountReadiness === 'object' ? shellAccountReadiness : {};
  const cached = {
    checkedAt: new Date().toISOString(),
    ok: true,
    failedStep: '',
    errorCode: '',
    authRequired: false,
    action: 'run_workbench_e2e',
    projectId,
    assetId,
    nextStep: 'done',
    account: {
      loggedIn: Boolean(account.loggedIn),
      partition: account.partition || '',
      authOrigin: account.authOrigin || '',
      siteOrigin: account.siteOrigin || '',
      cookieCount: Number(account.cookieCount) || 0,
      hasAuthCookie: Boolean(account.hasAuthCookie),
      statusCode: Number(account.statusCode) || 0,
      error: account.error || '',
    },
  };
  if (persistLocalWorkbenchE2e(target, cached)) pass('workbench.e2e.cache', 'settings.mcpWorkbenchLastE2e');
}

async function main() {
  results.length = 0;
  const target = resolveTarget();
  if (target.openLogin) {
    if (!target.workbenchE2e) {
      await openWorkbenchLoginAndPrintStatus(target);
      return;
    }
    const opened = await openWorkbenchLogin(target);
    if (!opened) return;
  }
  if (target.statusOnly) {
    await printStatusSummary(target);
    return;
  }
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
  const toolNames = new Set(tools.map((tool) => tool.name));
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

  const workbenchPromotionTool = tools.find((t) => t.name === 'ac.workflow.promote_workbench_preset');
  if (!workbenchPromotionTool) {
    fail('tool.ac.workflow.promote_workbench_preset.schema', 'tool not advertised');
  } else if (
    workbenchPromotionTool.inputSchema?.properties?.skillId &&
    Array.isArray(workbenchPromotionTool.inputSchema?.required) &&
    workbenchPromotionTool.inputSchema.required.includes('skillId') &&
    workbenchPromotionTool._meta?.assetcutter?.risk === 'confirm'
  ) {
    pass('tool.ac.workflow.promote_workbench_preset.schema', 'confirm-risk promotion preflight');
  } else {
    fail('tool.ac.workflow.promote_workbench_preset.schema', 'missing skillId schema or confirm risk metadata');
  }

  const scriptPromotionTool = tools.find((t) => t.name === 'ac.workflow.promote_script_hub_tool');
  if (!scriptPromotionTool) {
    fail('tool.ac.workflow.promote_script_hub_tool.schema', 'tool not advertised');
  } else if (
    scriptPromotionTool.inputSchema?.properties?.skillId &&
    Array.isArray(scriptPromotionTool.inputSchema?.required) &&
    scriptPromotionTool.inputSchema.required.includes('skillId') &&
    scriptPromotionTool._meta?.assetcutter?.risk === 'confirm'
  ) {
    pass('tool.ac.workflow.promote_script_hub_tool.schema', 'confirm-risk promotion preflight');
  } else {
    fail('tool.ac.workflow.promote_script_hub_tool.schema', 'missing skillId schema or confirm risk metadata');
  }

  const usageUploadTool = tools.find((t) => t.name === 'ac.usage.upload_cloud_draft');
  if (!usageUploadTool) {
    fail('tool.ac.usage.upload_cloud_draft.schema', 'tool not advertised');
  } else if (
    usageUploadTool.inputSchema?.properties?.dryRun &&
    usageUploadTool._meta?.assetcutter?.risk === 'confirm'
  ) {
    pass('tool.ac.usage.upload_cloud_draft.schema', 'confirm-risk shell-session upload');
  } else {
    fail('tool.ac.usage.upload_cloud_draft.schema', 'missing dryRun schema or confirm risk metadata');
  }

  const usagePolicyProbeTool = tools.find((t) => t.name === 'ac.usage.probe_quota_policy');
  if (!usagePolicyProbeTool) {
    fail('tool.ac.usage.probe_quota_policy.schema', 'tool not advertised');
  } else if (
    usagePolicyProbeTool.inputSchema?.type === 'object' &&
    usagePolicyProbeTool._meta?.assetcutter?.risk === 'safe'
  ) {
    pass('tool.ac.usage.probe_quota_policy.schema', 'safe shell-session policy probe');
  } else {
    fail('tool.ac.usage.probe_quota_policy.schema', 'missing safe risk metadata');
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
      30000,
    );
    const meta = call.json?.result?._meta?.assetcutter || {};
    if (call.status === 200 && call.json?.result && call.json.result.isError === false) {
      pass('tool.ac.shell.get_state', 'call succeeded');
      const state = call.json.result.structuredContent || {};
      const account = state && typeof state.account === 'object' ? state.account : null;
      shellAccountReadiness = account;
      if (account && account.partition === 'persist:assetcutter-team' && typeof account.loggedIn === 'boolean') {
        pass(
          'tool.ac.shell.get_state.account',
          `loggedIn=${account.loggedIn} cookies=${Number(account.cookieCount) || 0} partition=${account.partition}`,
        );
      } else {
        fail('tool.ac.shell.get_state.account', 'missing shared team account state');
      }
      if (meta.toolCallId && meta.policyDecision && typeof meta.durationMs === 'number') {
        pass('tool.call.trace', meta.toolCallId);
      } else {
        fail('tool.call.trace', 'missing toolCallId/policyDecision/durationMs');
      }
    } else {
      fail('tool.ac.shell.get_state', call.text || `status ${call.status}`);
    }
  }

  if (!usagePolicyProbeTool) {
    skip('tool.ac.usage.probe_quota_policy.call', 'tool not advertised');
  } else {
    const call = await callTool(target, 'ac.usage.probe_quota_policy', {}, 'usage-quota-policy-probe');
    const structured = toolStructured(call);
    const details = structured && structured.details && typeof structured.details === 'object' ? structured.details : structured;
    const errorCode = toolErrorCode(call);
    const recoveryTool = toolRecoveryTool(call);
    if (
      call.status === 200 &&
      call.json?.result?.isError === false &&
      details.endpoint === '/api/usage/policy' &&
      details.partition === 'persist:assetcutter-team' &&
      details.quotaPolicy &&
      typeof details.quotaPolicy === 'object'
    ) {
      pass(
        'tool.ac.usage.probe_quota_policy.call',
        `policy=${Boolean(details.quotaPolicy.cloudQuotaEnforced)} endpoint=${details.endpoint}`,
      );
    } else if (
      call.status === 200 &&
      call.json?.result?.isError === true &&
      errorCode === 'AGENT_AUTH_REQUIRED' &&
      details.authRequired === true &&
      details.endpoint === '/api/usage/policy' &&
      details.partition === 'persist:assetcutter-team' &&
      isWorkbenchLoginRecoveryTool(recoveryTool)
    ) {
      pass(
        'tool.ac.usage.probe_quota_policy.call',
        `recoverable: AGENT_AUTH_REQUIRED endpoint=${details.endpoint} partition=${details.partition}`,
      );
    } else {
      fail('tool.ac.usage.probe_quota_policy.call', call.text || `status ${call.status}`);
    }
  }

  const workbenchContextTool = tools.find((t) => t.name === 'ac.workbench.get_context');
  if (!workbenchContextTool) {
    skip('tool.ac.workbench.get_context', 'tool not advertised');
  } else if (shellAccountReadiness && shellAccountReadiness.loggedIn === false) {
    pass(
      'tool.ac.workbench.get_context',
      `recoverable: AGENT_AUTH_REQUIRED via ac.shell.navigate origin=${shellAccountReadiness.authOrigin || ''} cookies=${Number(shellAccountReadiness.cookieCount) || 0} authCookie=${shellAccountReadiness.hasAuthCookie ? 'present' : 'missing'} partition=${shellAccountReadiness.partition || 'unknown'}`.trim(),
    );
  } else {
    let call = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'workbench-context', method: 'tools/call', params: { name: 'ac.workbench.get_context', arguments: {} } },
      target.token,
      30000,
    );
    if (call.status === 0 && String(call.text || '').includes('timeout')) {
      const recoveryCall = await callTool(
        target,
        'ac.shell.navigate',
        { view: 'workbench' },
        'workbench-context-timeout-recovery',
      );
      if (isToolSuccess(recoveryCall)) {
        pass('tool.ac.workbench.get_context.timeout_recovery', 'ac.shell.navigate -> workbench');
        await delay(2500);
        call = await postJson(
          target.url,
          {
            jsonrpc: '2.0',
            id: 'workbench-context-retry',
            method: 'tools/call',
            params: { name: 'ac.workbench.get_context', arguments: {} },
          },
          target.token,
          30000,
        );
      }
    }
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
        `recoverable: ${meta.error?.code || structured.error?.code || 'needs-attention'} via ${recoveryTool.name} ${workbenchAuthDiagnostics(call)}`.trim(),
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

  let policyJson = null;
  const hasPolicy = resourceList.some((r) => r.uri === 'assetcutter://mcp/policy');
  if (!hasPolicy) {
    fail('resource.policy.listed', 'assetcutter://mcp/policy missing');
  } else {
    pass('resource.policy.listed');
    const policy = await readMcpJsonResource(target, 'assetcutter://mcp/policy', 'policy');
    policyJson = policy.json;
    if (
      policy.response.status === 200 &&
      policyJson &&
      Array.isArray(policyJson.toolDecisions) &&
      !policy.text.includes(target.token)
    ) {
      pass('resource.policy.read', `${policyJson.toolDecisions.length} decisions`);
    } else {
      fail('resource.policy.read', policy.response.text || `status ${policy.response.status}`);
    }
  }

  if (!usageUploadTool) {
    skip('tool.ac.usage.upload_cloud_draft.dry_run', 'tool not advertised');
  } else if (!policyJson) {
    skip('tool.ac.usage.upload_cloud_draft.dry_run', 'policy unavailable');
  } else {
    const decision = policyDecisionForTool(policyJson, 'ac.usage.upload_cloud_draft');
    const call = await callTool(
      target,
      'ac.usage.upload_cloud_draft',
      { days: 1, limit: 5000, dryRun: true },
      'usage-upload-dry-run',
    );
    const structured = toolStructured(call);
    const details = structured && structured.details && typeof structured.details === 'object' ? structured.details : structured;
    const errorCode = toolErrorCode(call);
    if (
      decision &&
      decision.decision === 'allow' &&
      call.status === 200 &&
      call.json?.result?.isError === false &&
      details.dryRun === true &&
      details.endpoint === '/api/usage/events' &&
      details.partition === 'persist:assetcutter-team' &&
      (details.validated === true || details.noEvents === true)
    ) {
      pass(
        'tool.ac.usage.upload_cloud_draft.dry_run',
        `${details.validated ? 'validated' : 'no-events'} endpoint=${details.endpoint}`,
      );
    } else if (
      decision &&
      decision.decision === 'confirm' &&
      call.status === 200 &&
      call.json?.result?.isError === true &&
      errorCode === 'AGENT_CONFIRM_REQUIRED' &&
      (structured.requiresFrontendAuthorization === true || details.requiresFrontendAuthorization === true)
    ) {
      pass('tool.ac.usage.upload_cloud_draft.dry_run', 'confirm gate active for external MCP');
    } else {
      fail('tool.ac.usage.upload_cloud_draft.dry_run', call.text || `status ${call.status}`);
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
      text.includes('directRunSupported') &&
      text.includes('assetcutter://mcp/usage-audit') &&
      text.includes('ac.usage.probe_quota_policy') &&
      text.includes('ac.usage.upload_cloud_draft') &&
      text.includes('dryRun=true') &&
      text.includes('readiness.blockers[].actions') &&
      text.includes('assetcutter://mcp/workflow-publication')
    ) {
      pass('resource.quickstart.read', 'guide available');
    } else {
      fail('resource.quickstart.read', quickstart.text || `status ${quickstart.status}`);
    }
  }

  const hasWorkflowPublication = resourceList.some((r) => r.uri === 'assetcutter://mcp/workflow-publication');
  if (!hasWorkflowPublication) {
    fail('resource.workflow-publication.listed', 'assetcutter://mcp/workflow-publication missing');
  } else {
    pass('resource.workflow-publication.listed');
    const publication = await postJson(
      target.url,
      {
        jsonrpc: '2.0',
        id: 'workflow-publication',
        method: 'resources/read',
        params: { uri: 'assetcutter://mcp/workflow-publication' },
      },
      target.token,
    );
    const text = publication.json?.result?.contents?.[0]?.text || '';
    const json = parseJsonText(text);
    if (
      publication.status === 200 &&
      json &&
      json.currentPhase === 'skill_draft_registry' &&
      json.entrypoints?.draftWorkflow?.tool === 'ac.skills.save' &&
      Array.isArray(json.promotionTargets) &&
      json.promotionTargets.some((target) => target.id === 'script_hub_tool') &&
      json.promotionReadiness?.currentPhase === 'draft_only' &&
      json.promotionReadiness?.publishableNow === false &&
      Array.isArray(json.promotionReadiness?.targets) &&
      json.promotionReadiness.targets.some((target) => target.plannedTool === 'ac.workflow.promote_workbench_preset') &&
      json.governance?.usageSignal === 'assetcutter://mcp/usage-audit' &&
      !text.includes(target.token)
    ) {
      pass('resource.workflow-publication.read', `${json.currentPhase} -> ${json.entrypoints.draftWorkflow.tool}`);
    } else {
      fail('resource.workflow-publication.read', publication.text || `status ${publication.status}`);
    }
  }

  const hasUsageAudit = resourceList.some((r) => r.uri === 'assetcutter://mcp/usage-audit');
  if (!hasUsageAudit) {
    fail('resource.usage-audit.listed', 'assetcutter://mcp/usage-audit missing');
  } else {
    pass('resource.usage-audit.listed');
    const usageAudit = await postJson(
      target.url,
      { jsonrpc: '2.0', id: 'usage-audit', method: 'resources/read', params: { uri: 'assetcutter://mcp/usage-audit' } },
      target.token,
    );
    const text = usageAudit.json?.result?.contents?.[0]?.text || '';
    const json = parseJsonText(text);
    if (
      usageAudit.status === 200 &&
      json &&
      json.scope?.source === 'local_companion_audit_log' &&
      json.readiness?.currentPhase === 'local_usage_signal' &&
      typeof json.readiness?.cloudEnforced === 'boolean' &&
      json.readiness?.cloudDraft?.currentPhase === 'cloud_event_draft' &&
      json.readiness?.cloudDraft?.targetApi === '/api/usage/events' &&
      json.readiness?.cloudDraft?.uploadPlan?.endpoint === '/api/usage/events' &&
      json.readiness?.cloudDraft?.uploadPlan?.credentials === 'include' &&
      json.readiness?.cloudDraft?.uploadPlan?.tool === 'ac.usage.upload_cloud_draft' &&
      json.readiness?.cloudDraft?.quotaPolicy?.billingSkuRegisteredInDefaultCatalog === true &&
      json.readiness?.cloudDraft?.quotaPolicy?.billingSku === 'copilot.codex.tokens' &&
      typeof json.readiness?.cloudDraft?.quotaPolicy?.cloudQuotaEnforced === 'boolean' &&
      json.readiness?.governanceTools?.probeQuotaPolicy === 'ac.usage.probe_quota_policy' &&
      json.readiness?.governanceTools?.uploadCloudDraft === 'ac.usage.upload_cloud_draft' &&
      json.readiness?.governanceTools?.dryRunArgs?.dryRun === true &&
      json.current &&
      json.cloudDraft?.currentPhase === 'cloud_event_draft' &&
      json.cloudDraft?.uploadPlan?.serverContract?.store === 'usage-billing-store.insertUsageEvents' &&
      json.cloudDraft?.quotaPolicy?.billingSku === 'copilot.codex.tokens' &&
      json.windows?.day7 &&
      json.windows?.day30 &&
      !text.includes(target.token)
    ) {
      pass(
        'resource.usage-audit.read',
        `phase=${json.readiness.currentPhase} cloudDraft=${json.cloudDraft.eventCount || 0} totalTokens=${Number(json.current.totals?.totalTokens) || 0}`,
      );
    } else {
      fail('resource.usage-audit.read', usageAudit.text || `status ${usageAudit.status}`);
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
      json.e2eGates?.accountPrerequisite?.field === 'readiness.account.loggedIn' &&
      json.accountReadiness?.partition === 'persist:assetcutter-team' &&
      !text.includes(target.token)
    ) {
      pass('resource.workbench-flow.read', `${steps.length} steps`);
      pass('resource.workbench-flow.account_gate', json.e2eGates.accountPrerequisite.partition);
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
      const account = json.readiness && typeof json.readiness.account === 'object' ? json.readiness.account : null;
      if (account && account.partition === 'persist:assetcutter-team' && typeof account.loggedIn === 'boolean') {
        pass(
          'resource.server-status.account',
          `loggedIn=${account.loggedIn} cookies=${Number(account.cookieCount) || 0} partition=${account.partition}`,
        );
      } else {
        fail('resource.server-status.account', 'missing shared team account readiness');
      }
      const codexRuntime =
        json.readiness && typeof json.readiness.codexRuntime === 'object' ? json.readiness.codexRuntime : null;
      if (
        codexRuntime &&
        typeof codexRuntime.command === 'string' &&
        typeof codexRuntime.cwd === 'string' &&
        typeof codexRuntime.cwdExists === 'boolean' &&
        typeof codexRuntime.sandbox === 'string' &&
        typeof codexRuntime.readyHint === 'boolean' &&
        !text.includes(target.token)
      ) {
        pass(
          'resource.server-status.codex_runtime',
          `${codexRuntime.command || 'unset'} cwdExists=${codexRuntime.cwdExists} sandbox=${codexRuntime.sandbox || 'unset'}`,
        );
      } else {
        fail('resource.server-status.codex_runtime', 'missing sanitized Codex runtime readiness');
      }
      const lastWorkbenchE2e =
        json.readiness && typeof json.readiness.lastWorkbenchE2e === 'object' ? json.readiness.lastWorkbenchE2e : null;
      if (lastWorkbenchE2e) {
        const lastAccount =
          lastWorkbenchE2e.account && typeof lastWorkbenchE2e.account === 'object' ? lastWorkbenchE2e.account : null;
        if (
          typeof lastWorkbenchE2e.checkedAt === 'string' &&
          typeof lastWorkbenchE2e.ok === 'boolean' &&
          (!lastAccount || lastAccount.partition === 'persist:assetcutter-team') &&
          !text.includes(target.token)
        ) {
          pass(
            'resource.server-status.last_workbench_e2e',
            `${lastWorkbenchE2e.ok ? 'ok' : lastWorkbenchE2e.errorCode || lastWorkbenchE2e.failedStep || 'not-ok'}`,
          );
        } else {
          fail('resource.server-status.last_workbench_e2e', 'invalid cached e2e entrance summary');
        }
      } else {
        skip('resource.server-status.last_workbench_e2e', 'no cached workbench e2e entrance summary yet');
      }
      const freshness =
        json.readiness && typeof json.readiness.lastWorkbenchE2eFreshness === 'object'
          ? json.readiness.lastWorkbenchE2eFreshness
          : null;
      if (
        freshness &&
        typeof freshness.status === 'string' &&
        typeof freshness.stale === 'boolean' &&
        Number.isFinite(Number(freshness.maxAgeMs))
      ) {
        pass(
          'resource.server-status.last_workbench_e2e_freshness',
          `${freshness.status}${freshness.checkedAt ? ` checkedAt=${freshness.checkedAt}` : ''}`,
        );
      } else {
        fail('resource.server-status.last_workbench_e2e_freshness', 'missing cached e2e freshness summary');
      }
      const entrance =
        json.readiness && typeof json.readiness.workbenchEntrance === 'object'
          ? json.readiness.workbenchEntrance
          : null;
      const acceptance =
        json.readiness && typeof json.readiness.workbenchE2eAcceptance === 'object'
          ? json.readiness.workbenchE2eAcceptance
          : null;
      if (
        entrance &&
        typeof entrance.ready === 'boolean' &&
        typeof entrance.status === 'string' &&
        typeof entrance.severity === 'string' &&
        Array.isArray(entrance.requiredChain) &&
        entrance.requiredChain.includes('run_capability')
      ) {
        pass('resource.server-status.workbench_entrance', `${entrance.status} ready=${entrance.ready}`);
      } else {
        fail('resource.server-status.workbench_entrance', 'missing productized workbench entrance status');
      }
      if (
        acceptance &&
        typeof acceptance.passed === 'boolean' &&
        typeof acceptance.status === 'string' &&
        ['settings.mcpWorkbenchLastE2e', 'audit.tool-executions'].includes(String(acceptance.proofSource || '')) &&
        Array.isArray(acceptance.requiredChain) &&
        acceptance.requiredChain.includes('run_capability') &&
        Array.isArray(acceptance.completionCriteria) &&
        acceptance.completionCriteria.some((item) => String(item).includes('lastWorkbenchE2e.ok')) &&
        !text.includes(target.token)
      ) {
        pass('resource.server-status.workbench_e2e_acceptance', `${acceptance.status} reason=${acceptance.blockingReason || 'none'}`);
      } else {
        fail('resource.server-status.workbench_e2e_acceptance', 'missing Workbench E2E acceptance evidence');
      }
      const usage =
        json.readiness && typeof json.readiness.usageAudit === 'object' ? json.readiness.usageAudit : null;
      if (
        usage &&
        Number.isFinite(Number(usage.windowDays)) &&
        usage.totals &&
        typeof usage.totals === 'object' &&
        Number.isFinite(Number(usage.totals.totalTokens)) &&
        !text.includes(target.token)
      ) {
        pass(
          'resource.server-status.usage_audit',
          `windowDays=${Number(usage.windowDays) || 0} totalTokens=${Number(usage.totals.totalTokens) || 0}`,
        );
      } else {
        fail('resource.server-status.usage_audit', 'missing local usage audit summary or token leaked');
      }
      const usageEvidence =
        usage && usage.governanceEvidence && typeof usage.governanceEvidence === 'object'
          ? usage.governanceEvidence
          : null;
      if (
        usageEvidence &&
        usageEvidence.resource === 'assetcutter://mcp/tool-executions' &&
        Number.isFinite(Number(usageEvidence.count)) &&
        (usageEvidence.latest == null || typeof usageEvidence.latest === 'object') &&
        !text.includes(target.token)
      ) {
        pass('resource.server-status.usage_governance_evidence', `${Number(usageEvidence.count) || 0} records`);
      } else {
        fail('resource.server-status.usage_governance_evidence', 'missing usage governance evidence summary');
      }
      const workflow =
        json.readiness && typeof json.readiness.workflowPublication === 'object'
          ? json.readiness.workflowPublication
          : null;
      if (
        workflow &&
        typeof workflow.ready === 'boolean' &&
        typeof workflow.status === 'string' &&
        workflow.phase === 'skill_draft_registry' &&
        workflow.draftTool === 'ac.skills.save' &&
        workflow.decisions &&
        typeof workflow.decisions === 'object' &&
        !text.includes(target.token)
      ) {
        pass('resource.server-status.workflow_publication', `${workflow.status} ready=${workflow.ready}`);
      } else {
        fail('resource.server-status.workflow_publication', 'missing workflow publication readiness or token leaked');
      }
      const preflightEvidence =
        workflow && workflow.promotionPreflightEvidence && typeof workflow.promotionPreflightEvidence === 'object'
          ? workflow.promotionPreflightEvidence
          : null;
      if (
        preflightEvidence &&
        preflightEvidence.resource === 'assetcutter://mcp/tool-executions' &&
        Number.isFinite(Number(preflightEvidence.count)) &&
        (preflightEvidence.latest == null || typeof preflightEvidence.latest === 'object') &&
        !text.includes(target.token)
      ) {
        pass('resource.server-status.workflow_promotion_preflight_evidence', `${Number(preflightEvidence.count) || 0} records`);
      } else {
        fail('resource.server-status.workflow_promotion_preflight_evidence', 'missing workflow promotion preflight evidence summary');
      }
      const blockers = json.readiness && Array.isArray(json.readiness.blockers) ? json.readiness.blockers : null;
      const blockerActionFailures = [];
      const workflowReady = Boolean(workflow && workflow.ready === true);
      const teamEntranceReady = Boolean(json.readiness.teamEntranceReady === true);
      const blockerActionContractOk =
        blockers &&
        blockers.every(
          (blocker) => {
            if (!blocker || !Array.isArray(blocker.actions)) {
              blockerActionFailures.push(`${blocker?.id || 'unknown'}:missing_actions`);
              return false;
            }
            const invalid = blocker.actions
              .map((action) => validateBlockerAction(action, toolNames))
              .filter((result) => !result.ok);
            if (invalid.length) {
              blockerActionFailures.push(`${blocker.id || 'unknown'}:${invalid.map((result) => result.reason).join(',')}`);
              return false;
            }
            return true;
          },
        ) &&
        (() => {
          if (workflowReady) return true;
          const blocker = blockers.find((item) => item && item.id === 'workflow_promotion_draft_only');
          const ok = blocker && Array.isArray(blocker.actions) && blocker.actions.length > 0;
          if (!ok) blockerActionFailures.push('workflow_promotion_draft_only:missing_required_actions');
          return ok;
        }) &&
        (() => {
          if (teamEntranceReady) return true;
          const workbenchBlocker = blockers.find((item) => item && /^workbench_/.test(String(item.id || '')));
          const ok = workbenchBlocker && Array.isArray(workbenchBlocker.actions) && workbenchBlocker.actions.length > 0;
          if (!ok) blockerActionFailures.push('workbench_*:missing_required_actions');
          return ok;
        });
      if (
        blockers &&
        blockers.every((blocker) => blocker && typeof blocker.id === 'string' && typeof blocker.nextStep === 'string') &&
        blockerActionContractOk &&
        typeof json.readiness.teamEntranceReady === 'boolean' &&
        typeof json.readiness.teamEntrancePhase === 'string' &&
        Array.isArray(json.readiness.teamEntranceBlockers) &&
        !text.includes(target.token)
      ) {
        pass(
          'resource.server-status.blockers',
          `${blockers.length} blockers teamEntrance=${json.readiness.teamEntrancePhase}`,
        );
      } else {
        fail(
          'resource.server-status.blockers',
          blockerActionFailures.length
            ? `invalid blocker actions: ${blockerActionFailures.join('; ')}`
            : 'missing readiness blockers/team entrance summary or token leaked',
        );
      }
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

  await runWorkflowDraftLifecycleSmoke(target, tools, policyJson);

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
