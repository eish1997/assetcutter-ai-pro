'use strict';

const http = require('http');
const { listSkillEntries, readSkillById, listSkillRevisions, readSkillRevision } = require('./agent-skills.cjs');
const { buildToolCatalog } = require('./agent-tool-schemas.cjs');
const {
  WORKBENCH_E2E_REQUIRED_TOOLS,
  WORKBENCH_FLOW_RESOURCE_URI,
  buildWorkbenchFlowDocument,
} = require('./agent-workbench-flow.cjs');
const { buildCopilotUsageCloudDraft } = require('./agent-usage-cloud-draft.cjs');
const {
  STATUS_COMMAND,
  WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
  workbenchLoginActions,
  workflowPromotionActions,
  usageGovernanceActions,
} = require('./agent-blocker-actions.cjs');
const { createHash, randomBytes, randomUUID } = require('node:crypto');

const DEFAULT_MCP_PORT = 19120;
const MCP_BIND = '127.0.0.1';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2024-11-05'];
const MCP_SERVER_NAME = 'assetcutter-agent-body';
const MCP_SERVER_TITLE = 'AssetCutter Agent Body';
const MCP_SERVER_VERSION = '0.4.0';
const MCP_LIST_PAGE_SIZE = 100;
const MCP_LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
const WORKBENCH_E2E_FRESH_MS = 24 * 60 * 60 * 1000;
const AGENT_WORKBENCH_SMOKE_PRESET_ID = 'agent_workbench_smoke_text_note';

/**
 * @param {{
 *   readSettings: () => object;
 *   writeSettings: (patch: object) => object;
 *   bodyHost: { listTools: () => Promise<object[]>; executeTool: (name: string, args: object, ctx: object) => Promise<object> };
 *   gateTool: (tool: { name: string; risk: string }) => 'allow' | 'confirm' | 'deny';
 *   readPolicy: () => object;
 *   waitForConfirm?: (confirmId: string, meta: object) => Promise<boolean | { approved: boolean; reason?: string }>;
 *   appendAudit: (entry: object) => void;
 *   listToolExecutions?: (options?: object) => object[];
 *   summarizeUsageAudit?: (options?: object) => object;
 *   getShellView: () => string;
 *   getStateSummary?: () => Promise<Record<string, unknown>>;
 *   getCodexRuntimeStatus?: () => object;
 *   getSkillsRoot?: () => string;
 *   log?: (...args: unknown[]) => void;
 * }} deps
 */
function createAgentBodyMcpServer(deps) {
  /** @type {http.Server | null} */
  let server = null;
  let runningPort = null;
  let loggingLevel = 'info';
  const activeRequests = new Map();
  const subscribedResources = new Map();

  function log(...args) {
    if (typeof deps.log === 'function') deps.log('[agent-mcp]', ...args);
  }

  function argsDigest(args) {
    try {
      return createHash('sha256').update(JSON.stringify(args || {})).digest('hex').slice(0, 16);
    } catch {
      return null;
    }
  }

  function workflowPromotionAuditSummary(toolName, result) {
    if (toolName !== 'ac.workflow.promote_workbench_preset' && toolName !== 'ac.workflow.promote_script_hub_tool') {
      return null;
    }
    const structured = result && result.structured && typeof result.structured === 'object' ? result.structured : null;
    if (!structured) return null;
    const admin =
      structured.adminConfirmation && typeof structured.adminConfirmation === 'object'
        ? structured.adminConfirmation
        : {};
    return {
      target: structured.target ? String(structured.target) : '',
      skillId: structured.skillId ? String(structured.skillId) : '',
      currentPhase: structured.currentPhase ? String(structured.currentPhase) : '',
      publishable: Boolean(structured.publishable),
      passedGates: Array.isArray(structured.passedGates) ? structured.passedGates.map(String) : [],
      missingGates: Array.isArray(structured.missingGates) ? structured.missingGates.map(String) : [],
      adminConfirmation: {
        required: Boolean(admin.required),
        passed: Boolean(admin.passed),
        sourceRequired: admin.sourceRequired ? String(admin.sourceRequired) : 'copilot_ui',
        source: admin.source ? String(admin.source) : '',
        autoConfirmCountsAsAdminApproval: Boolean(admin.autoConfirmCountsAsAdminApproval),
      },
    };
  }

  function usageGovernanceAuditSummary(toolName, result) {
    if (toolName !== 'ac.usage.probe_quota_policy' && toolName !== 'ac.usage.upload_cloud_draft') {
      return null;
    }
    const structured = result && result.structured && typeof result.structured === 'object' ? result.structured : null;
    if (!structured) return null;
    const quotaPolicy =
      structured.quotaPolicy && typeof structured.quotaPolicy === 'object' ? structured.quotaPolicy : null;
    const action = toolName === 'ac.usage.probe_quota_policy' ? 'probe_quota_policy' : 'upload_cloud_draft';
    const eventCount = Number.isFinite(Number(structured.eventCount)) ? Math.max(0, Math.round(Number(structured.eventCount))) : 0;
    const clearedGates = [];
    if (action === 'probe_quota_policy' && result && result.ok) clearedGates.push('authenticated_team_session_required');
    if (quotaPolicy && quotaPolicy.cloudQuotaEnforced) clearedGates.push('cloud_quota_policy_not_enabled');
    if (action === 'upload_cloud_draft' && eventCount > 0) clearedGates.push('local_usage_events_available');
    if (action === 'upload_cloud_draft' && structured.uploaded) {
      clearedGates.push('authenticated_team_session_required', 'cloud_upload_verified');
    }
    const remainingGates = [
      'authenticated_team_session_required',
      'cloud_quota_policy_not_enabled',
      'local_usage_events_available',
      'cloud_upload_verified',
    ].filter((gate) => !clearedGates.includes(gate));
    return {
      action,
      endpoint: structured.endpoint ? String(structured.endpoint) : '',
      partition: structured.partition ? String(structured.partition) : '',
      ok: Boolean(result && result.ok),
      code: structured.code ? String(structured.code) : result && result.error && result.error.code ? String(result.error.code) : '',
      authRequired: Boolean(structured.authRequired),
      dryRun: Boolean(structured.dryRun),
      uploaded: Boolean(structured.uploaded),
      validated: Boolean(structured.validated),
      noEvents: Boolean(structured.noEvents),
      eventCount,
      exitReady: remainingGates.length === 0,
      clearedGates: [...new Set(clearedGates)],
      remainingGates,
      quotaPolicy: quotaPolicy
        ? {
            currentPhase: quotaPolicy.currentPhase ? String(quotaPolicy.currentPhase) : '',
            billingSku: quotaPolicy.billingSku ? String(quotaPolicy.billingSku) : '',
            cloudQuotaEnforced: Boolean(quotaPolicy.cloudQuotaEnforced),
            usageBillingEnabled: Boolean(quotaPolicy.usageBillingEnabled),
            enforcementSource: quotaPolicy.enforcementSource ? String(quotaPolicy.enforcementSource) : '',
            policyId: quotaPolicy.policyId ? String(quotaPolicy.policyId) : '',
          }
        : null,
    };
  }

  function summarizeWorkflowPromotionPreflightEvidence(executions) {
    const skillsRoot = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
    const skillExists = (skillId) => {
      const id = String(skillId || '').trim();
      if (!id || !skillsRoot) return false;
      try {
        return Boolean(readSkillById(skillsRoot, id));
      } catch {
        return false;
      }
    };
    const items = Array.isArray(executions)
      ? executions
          .filter((entry) => entry && entry.workflowPromotionPreflight && typeof entry.workflowPromotionPreflight === 'object')
          .slice(0, 6)
          .map((entry) => {
            const preflight = entry.workflowPromotionPreflight;
            const exists = skillExists(preflight.skillId);
            const admin =
              preflight.adminConfirmation && typeof preflight.adminConfirmation === 'object'
                ? preflight.adminConfirmation
                : {};
            return {
              ts: entry.ts ? String(entry.ts) : '',
              tool: entry.tool ? String(entry.tool) : '',
              toolCallId: entry.toolCallId ? String(entry.toolCallId) : '',
              traceId: entry.traceId ? String(entry.traceId) : '',
              target: preflight.target ? String(preflight.target) : '',
              skillId: preflight.skillId ? String(preflight.skillId) : '',
              skillExists: exists,
              evidenceCurrent: exists,
              staleReason: exists ? '' : 'workflow_draft_deleted',
              currentPhase: preflight.currentPhase ? String(preflight.currentPhase) : '',
              publishable: Boolean(preflight.publishable),
              passedGates: Array.isArray(preflight.passedGates) ? preflight.passedGates.map(String) : [],
              missingGates: Array.isArray(preflight.missingGates) ? preflight.missingGates.map(String) : [],
              adminConfirmation: {
                required: Boolean(admin.required),
                passed: Boolean(admin.passed),
                sourceRequired: admin.sourceRequired ? String(admin.sourceRequired) : 'copilot_ui',
                source: admin.source ? String(admin.source) : '',
                autoConfirmCountsAsAdminApproval: Boolean(admin.autoConfirmCountsAsAdminApproval),
              },
            };
          })
      : [];
    return {
      resource: 'assetcutter://mcp/tool-executions',
      windowDays: 1,
      count: items.length,
      latest: items[0] || null,
      items,
    };
  }

  function summarizeUsageGovernanceEvidence(executions) {
    const items = Array.isArray(executions)
      ? executions
          .filter((entry) => entry && entry.usageGovernance && typeof entry.usageGovernance === 'object')
          .slice(0, 8)
          .map((entry) => {
            const usage = entry.usageGovernance;
            const quotaPolicy =
              usage.quotaPolicy && typeof usage.quotaPolicy === 'object' ? usage.quotaPolicy : null;
            return {
              ts: entry.ts ? String(entry.ts) : '',
              tool: entry.tool ? String(entry.tool) : '',
              toolCallId: entry.toolCallId ? String(entry.toolCallId) : '',
              traceId: entry.traceId ? String(entry.traceId) : '',
              action: usage.action ? String(usage.action) : '',
              endpoint: usage.endpoint ? String(usage.endpoint) : '',
              partition: usage.partition ? String(usage.partition) : '',
              ok: Boolean(usage.ok),
              code: usage.code ? String(usage.code) : '',
              authRequired: Boolean(usage.authRequired),
              dryRun: Boolean(usage.dryRun),
              uploaded: Boolean(usage.uploaded),
              validated: Boolean(usage.validated),
              noEvents: Boolean(usage.noEvents),
              eventCount: Number.isFinite(Number(usage.eventCount)) ? Math.max(0, Math.round(Number(usage.eventCount))) : 0,
              exitReady: Boolean(usage.exitReady),
              clearedGates: Array.isArray(usage.clearedGates) ? usage.clearedGates.map(String) : [],
              remainingGates: Array.isArray(usage.remainingGates) ? usage.remainingGates.map(String) : [],
              quotaPolicy: quotaPolicy
                ? {
                    currentPhase: quotaPolicy.currentPhase ? String(quotaPolicy.currentPhase) : '',
                    billingSku: quotaPolicy.billingSku ? String(quotaPolicy.billingSku) : '',
                    cloudQuotaEnforced: Boolean(quotaPolicy.cloudQuotaEnforced),
                    usageBillingEnabled: Boolean(quotaPolicy.usageBillingEnabled),
                    enforcementSource: quotaPolicy.enforcementSource ? String(quotaPolicy.enforcementSource) : '',
                    policyId: quotaPolicy.policyId ? String(quotaPolicy.policyId) : '',
                  }
                : null,
            };
          })
      : [];
    return {
      resource: 'assetcutter://mcp/tool-executions',
      windowDays: 1,
      count: items.length,
      latest: items[0] || null,
      items,
    };
  }

  function ensureMcpToken(settings) {
    const cur = settings && typeof settings === 'object' ? settings : deps.readSettings();
    if (cur.mcpToken && String(cur.mcpToken).length >= 16) return cur;
    const token = randomBytes(24).toString('hex');
    return deps.writeSettings({ mcpToken: token });
  }

  function authOk(req, settings) {
    if (!settings.mcpEnabled) return false;
    const auth = String(req.headers.authorization || '');
    const token = settings.mcpToken ? String(settings.mcpToken) : '';
    if (!token) return false;
    if (auth === `Bearer ${token}`) return true;
    const headerToken = String(req.headers['x-agent-mcp-token'] || '');
    return headerToken === token;
  }

  function negotiateProtocolVersion(requested) {
    const version = String(requested || '').trim();
    if (version && MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version)) return version;
    return MCP_PROTOCOL_VERSION;
  }

  function responseProtocolVersion(req, body) {
    if (isObject(body) && body.method === 'initialize') {
      return negotiateProtocolVersion(body.params && body.params.protocolVersion);
    }
    const headerVersion = String(req.headers['mcp-protocol-version'] || '').trim();
    if (MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(headerVersion)) return headerVersion;
    return MCP_PROTOCOL_VERSION;
  }

  function serverInstructions() {
    return [
      'AssetCutter MCP is the local body for the AssetCutter workbench.',
      'Start with ac.shell.get_state, then ac.workbench.ensure_ready before operating projects or capabilities; create a project with ac.workbench.create_project when no project is active, use ac.workbench.list_assets to inspect outputs, and ac.workbench.get_asset for details.',
      'Use tools/list for schemas and assetcutter://mcp/tool-catalog for grouped guidance, example arguments, and success signals.',
      'Confirm-risk tools may require Copilot frontend authorization; keep Copilot open when calling workbench or Script Hub actions.',
      'For long-running calls, send notifications/cancelled with the original JSON-RPC request id if the task should stop.',
    ].join('\n');
  }

  function makeToolCallId() {
    return `mcp_tool_${randomUUID()}`;
  }

  function makeConfirmId() {
    return `cfm_${randomUUID()}`;
  }

  function summarizeWorkbenchE2eFreshness(last, nowMs = Date.now()) {
    const e2e = last && typeof last === 'object' ? last : null;
    if (!e2e) {
      return {
        status: 'missing',
        stale: true,
        checkedAt: null,
        ageMs: null,
        maxAgeMs: WORKBENCH_E2E_FRESH_MS,
        ok: false,
        nextStep: 'Run npm run smoke:agent-mcp:e2e:wait-login after opening the embedded Workbench login.',
      };
    }
    const checkedAt = typeof e2e.checkedAt === 'string' ? e2e.checkedAt : '';
    const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
    if (!Number.isFinite(checkedMs)) {
      return {
        status: 'invalid',
        stale: true,
        checkedAt: checkedAt || null,
        ageMs: null,
        maxAgeMs: WORKBENCH_E2E_FRESH_MS,
        ok: Boolean(e2e.ok),
        errorCode: e2e.errorCode ? String(e2e.errorCode) : '',
        failedStep: e2e.failedStep ? String(e2e.failedStep) : '',
        nextStep: 'Discard the invalid cached result and rerun npm run smoke:agent-mcp:e2e:wait-login.',
      };
    }
    const ageMs = Math.max(0, Math.round(nowMs - checkedMs));
    const stale = ageMs > WORKBENCH_E2E_FRESH_MS;
    return {
      status: stale ? 'stale' : 'fresh',
      stale,
      checkedAt,
      ageMs,
      maxAgeMs: WORKBENCH_E2E_FRESH_MS,
      ok: Boolean(e2e.ok),
      errorCode: e2e.errorCode ? String(e2e.errorCode) : '',
      failedStep: e2e.failedStep ? String(e2e.failedStep) : '',
      nextStep: stale
        ? 'The cached Workbench E2E result is older than 24h; rerun npm run smoke:agent-mcp:e2e:wait-login.'
        : 'Use the cached result as the latest entrance signal, then rerun full E2E after login-sensitive changes.',
    };
  }

  function summarizeWorkbenchEntrance(readiness) {
    const r = readiness && typeof readiness === 'object' ? readiness : {};
    const account = r.account && typeof r.account === 'object' ? r.account : null;
    const freshness = r.freshness && typeof r.freshness === 'object' ? r.freshness : null;
    const last = r.lastWorkbenchE2e && typeof r.lastWorkbenchE2e === 'object' ? r.lastWorkbenchE2e : null;
    const base = {
      ready: false,
      status: 'unknown',
      severity: 'warn',
      command: 'npm run smoke:agent-mcp:e2e',
      waitLoginCommand: 'npm run smoke:agent-mcp:e2e:wait-login',
      requiredChain: ['ensure_ready', 'create_project', 'run_capability', 'list_assets', 'get_asset'],
    };
    if (!r.mcpReady) {
      return {
        ...base,
        status: 'mcp_unavailable',
        severity: 'error',
        nextStep: 'Enable and start MCP before validating the Workbench entrance.',
      };
    }
    if (!account || account.loggedIn !== true) {
      return {
        ...base,
        status: 'login_required',
        severity: 'action_required',
        partition: account && account.partition ? String(account.partition) : '',
        nextStep: 'Open the embedded Workbench, finish login, then run npm run smoke:agent-mcp:e2e:wait-login.',
      };
    }
    if (!freshness || freshness.status === 'missing') {
      return {
        ...base,
        status: 'e2e_missing',
        severity: 'action_required',
        nextStep: 'Run npm run smoke:agent-mcp:e2e:wait-login to prove the full Workbench chain.',
      };
    }
    if (freshness.status === 'invalid') {
      return {
        ...base,
        status: 'e2e_invalid',
        severity: 'warn',
        checkedAt: freshness.checkedAt || null,
        nextStep: 'The cached E2E result is invalid; rerun npm run smoke:agent-mcp:e2e:wait-login.',
      };
    }
    if (freshness.stale) {
      return {
        ...base,
        status: 'e2e_stale',
        severity: 'warn',
        checkedAt: freshness.checkedAt || null,
        ageMs: freshness.ageMs == null ? null : Number(freshness.ageMs),
        nextStep: 'The cached E2E result is stale; rerun npm run smoke:agent-mcp:e2e:wait-login.',
      };
    }
    if (!last || last.ok !== true) {
      return {
        ...base,
        status: 'e2e_failed',
        severity: 'action_required',
        checkedAt: freshness.checkedAt || null,
        failedStep: last && last.failedStep ? String(last.failedStep) : '',
        errorCode: last && last.errorCode ? String(last.errorCode) : '',
        nextStep: 'Fix the last Workbench E2E failure, then rerun npm run smoke:agent-mcp:e2e:wait-login.',
      };
    }
    return {
      ...base,
      ready: true,
      status: 'ready',
      severity: 'ok',
      checkedAt: freshness.checkedAt || null,
      projectId: last.projectId ? String(last.projectId) : '',
      assetId: last.assetId ? String(last.assetId) : '',
      nextStep: 'Workbench entrance is ready for external Agents through MCP.',
    };
  }

  function summarizeWorkbenchE2eAcceptance({ account, workbenchEntrance, lastWorkbenchE2e, freshness }) {
    const entrance = workbenchEntrance && typeof workbenchEntrance === 'object' ? workbenchEntrance : {};
    const last = lastWorkbenchE2e && typeof lastWorkbenchE2e === 'object' ? lastWorkbenchE2e : null;
    const fresh = freshness && typeof freshness === 'object' ? freshness : {};
    const requiredChain = Array.isArray(entrance.requiredChain) && entrance.requiredChain.length
      ? entrance.requiredChain.map(String)
      : ['ensure_ready', 'create_project', 'run_capability', 'list_assets', 'get_asset'];
    const passed = Boolean(entrance.ready && last && last.ok === true && fresh.status === 'fresh' && fresh.stale === false);
    const blockingReason =
      passed
        ? ''
        : !account || account.loggedIn !== true
          ? 'workbench_login_required'
          : fresh.status === 'missing'
            ? 'workbench_e2e_missing'
            : fresh.status === 'stale'
              ? 'workbench_e2e_stale'
              : fresh.status === 'invalid'
                ? 'workbench_e2e_invalid'
                : last && last.ok === false
                  ? last.errorCode || last.failedStep || 'workbench_e2e_failed'
                  : 'workbench_e2e_not_ready';
    return {
      passed,
      status: passed ? 'accepted' : 'not_accepted',
      proofSource: last && last.proofSource ? String(last.proofSource) : 'settings.mcpWorkbenchLastE2e',
      statusResource: 'assetcutter://mcp/server-status',
      statusField: 'readiness.lastWorkbenchE2e',
      freshnessField: 'readiness.lastWorkbenchE2eFreshness',
      maxAgeMs: WORKBENCH_E2E_FRESH_MS,
      requiredChain,
      commands: {
        status: 'npm run smoke:agent-mcp:status',
        waitLogin: entrance.waitLoginCommand || 'npm run smoke:agent-mcp:e2e:wait-login',
        openLoginWait: entrance.openLoginWaitCommand || 'npm run smoke:agent-mcp:e2e:open-login-wait',
        e2e: entrance.command || 'npm run smoke:agent-mcp:e2e',
      },
      completionCriteria: [
        'readiness.account.loggedIn === true',
        'readiness.lastWorkbenchE2e.ok === true',
        'readiness.lastWorkbenchE2eFreshness.status === "fresh"',
        'readiness.workbenchEntrance.ready === true',
        'last E2E proves ensure_ready -> create_project -> run_capability -> list_assets -> get_asset',
      ],
      blockingReason,
      checkedAt: last && last.checkedAt ? String(last.checkedAt) : '',
      projectId: last && last.projectId ? String(last.projectId) : '',
      assetId: last && last.assetId ? String(last.assetId) : '',
      nextStep: passed
        ? 'Workbench MCP E2E acceptance is fresh; continue with remaining team governance blockers.'
        : entrance.nextStep || 'Run npm run smoke:agent-mcp:e2e:wait-login after embedded Workbench login.',
    };
  }

  function synthesizeWorkbenchE2eFromExecutions(executions, account) {
    if (!Array.isArray(executions) || !executions.length) return null;
    const candidates = executions
      .filter((entry) => {
        const tool = entry && entry.tool ? String(entry.tool) : '';
        return tool.startsWith('ac.workbench.') && entry && entry.ok === false;
      })
      .map((entry) => {
        const ts = entry && entry.ts ? String(entry.ts) : '';
        const time = ts ? Date.parse(ts) : NaN;
        return { entry, ts, time: Number.isFinite(time) ? time : 0 };
      })
      .sort((a, b) => b.time - a.time);
    const accountLoggedIn = Boolean(account && typeof account === 'object' && account.loggedIn === true);
    const authRequired = accountLoggedIn
      ? null
      : candidates.find(({ entry }) => String(entry.errorCode || '') === 'AGENT_AUTH_REQUIRED');
    const latest = authRequired || candidates[0];
    if (!latest) return null;
    const entry = latest.entry || {};
    const errorCode = entry.errorCode ? String(entry.errorCode) : 'workbench_e2e_failed';
    const authBlocked = errorCode === 'AGENT_AUTH_REQUIRED';
    const safeAccount = account && typeof account === 'object' ? account : {};
    return {
      ok: false,
      checkedAt: latest.ts || new Date().toISOString(),
      failedStep: entry.tool ? String(entry.tool) : 'ac.workbench.unknown',
      errorCode,
      authRequired: authBlocked,
      action: authBlocked ? 'open_workbench_login' : '',
      nextStep: authBlocked
        ? 'Open the embedded Workbench and finish login, then rerun npm run smoke:agent-mcp:e2e:wait-login.'
        : 'Inspect the latest failed Workbench MCP tool, fix it, then rerun npm run smoke:agent-mcp:e2e:wait-login.',
      proofSource: 'audit.tool-executions',
      toolCallId: entry.toolCallId ? String(entry.toolCallId) : '',
      account: {
        loggedIn: safeAccount.loggedIn === true,
        partition: safeAccount.partition ? String(safeAccount.partition) : '',
        authOrigin: safeAccount.authOrigin ? String(safeAccount.authOrigin) : '',
        siteOrigin: safeAccount.siteOrigin ? String(safeAccount.siteOrigin) : '',
        cookieCount: Number.isFinite(Number(safeAccount.cookieCount)) ? Number(safeAccount.cookieCount) : 0,
        hasAuthCookie: safeAccount.hasAuthCookie === true,
        statusCode: Number.isFinite(Number(safeAccount.statusCode)) ? Number(safeAccount.statusCode) : null,
        error: safeAccount.error ? String(safeAccount.error) : '',
      },
    };
  }

  function summarizeWorkbenchEntranceState(account) {
    const settings = deps.readSettings();
    const s = status();
    const lastWorkbenchE2e =
      settings.mcpWorkbenchLastE2e && typeof settings.mcpWorkbenchLastE2e === 'object'
        ? settings.mcpWorkbenchLastE2e
        : null;
    const lastWorkbenchE2eFreshness = summarizeWorkbenchE2eFreshness(lastWorkbenchE2e);
    return {
      workbenchEntrance: summarizeWorkbenchEntrance({
        mcpReady: Boolean(s.enabled && s.running && s.hasToken),
        account,
        lastWorkbenchE2e,
        freshness: lastWorkbenchE2eFreshness,
      }),
      lastWorkbenchE2eFreshness,
    };
  }

  function policyDecisionForTool(policy, tools, toolName) {
    const schema = Array.isArray(tools) ? tools.find((tool) => tool && tool.name === toolName) : null;
    if (!schema) {
      return {
        name: toolName,
        present: false,
        risk: 'missing',
        decision: 'missing',
        requiresFrontendAuthorization: false,
      };
    }
    const risk = String(schema.risk || 'safe');
    const forbidden = Array.isArray(policy && policy.forbiddenTools) ? policy.forbiddenTools.map(String) : [];
    const auto = Array.isArray(policy && policy.autoConfirmTools) ? policy.autoConfirmTools.map(String) : [];
    const confirmTools = policy && Object.prototype.hasOwnProperty.call(policy, 'confirmTools') ? Boolean(policy.confirmTools) : true;
    let decision = 'allow';
    if (forbidden.includes(toolName)) decision = 'deny';
    else if (risk === 'confirm' && confirmTools && !auto.includes(toolName)) decision = 'confirm';
    return {
      name: toolName,
      present: true,
      risk,
      decision,
      requiresFrontendAuthorization: decision === 'confirm',
    };
  }

  function summarizeWorkflowPublicationReadiness(policy, tools) {
    const save = policyDecisionForTool(policy, tools, 'ac.skills.save');
    const read = policyDecisionForTool(policy, tools, 'ac.skills.get');
    const revisions = policyDecisionForTool(policy, tools, 'ac.skills.revisions');
    const remove = policyDecisionForTool(policy, tools, 'ac.skills.delete');
    const decisions = { save, read, revisions, delete: remove };
    const missing = Object.values(decisions).filter((entry) => !entry.present).map((entry) => entry.name);
    const denied = Object.values(decisions).filter((entry) => entry.decision === 'deny').map((entry) => entry.name);
    const confirm = Object.values(decisions).filter((entry) => entry.decision === 'confirm').map((entry) => entry.name);
    const ready = missing.length === 0 && denied.length === 0 && confirm.length === 0;
    const draftInventory = summarizeWorkflowDraftInventory();
    return {
      ready,
      status: missing.length ? 'tools_missing' : denied.length ? 'policy_denied' : confirm.length ? 'confirmation_required' : 'ready',
      phase: 'skill_draft_registry',
      resource: 'assetcutter://mcp/workflow-publication',
      draftTool: 'ac.skills.save',
      discoverableVia: ['prompts/list', 'resources/list', 'skill://{skillId}', 'ac.skills.list'],
      draftInventory,
      promotionTargets: ['workbench_preset', 'script_hub_tool'],
      promotionReadiness: buildWorkflowPromotionReadiness(tools, draftInventory),
      decisions,
      nextStep: ready
        ? 'External Agents can save workflow drafts through ac.skills.save, verify prompt/resource discovery, then retire drafts with ac.skills.delete.'
        : missing.length
          ? `Register missing workflow draft tools before accepting external Agent workflows: ${missing.join(', ')}.`
          : denied.length
            ? `Ask an admin to unblock workflow draft tools before saving external Agent workflows: ${denied.join(', ')}.`
            : `Copilot frontend authorization is required for workflow draft writes: ${confirm.join(', ')}. Keep Copilot open or ask an admin to auto-confirm trusted draft tools.`,
    };
  }

  function summarizeWorkflowDraftInventory() {
    const skillsRoot = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
    const drafts = skillsRoot
      ? listSkillEntries(skillsRoot)
          .map((skill) => ({
            id: skill.id ? String(skill.id) : '',
            name: skill.name ? String(skill.name) : '',
            revision: Number.isFinite(Number(skill.revision)) ? Number(skill.revision) : 1,
            updatedAt: skill.updatedAt ? String(skill.updatedAt) : '',
            createdAt: skill.createdAt ? String(skill.createdAt) : '',
            hasWorkbenchPreset: Boolean(skill.workbenchPreset),
            hasScriptManifest: Boolean(skill.scriptManifest),
            resourceUri: skill.id ? `skill://${skill.id}` : '',
          }))
          .filter((skill) => skill.id)
          .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      : [];
    return {
      count: drafts.length,
      latest: drafts[0] || null,
      nextStep: drafts.length
        ? 'Use the latest current draft id in the Settings promotion preflight or call a promotion preflight tool directly.'
        : 'Save a workflow draft with ac.skills.save before running promotion preflight.',
    };
  }

  function buildWorkflowPromotionReadiness(tools, draftInventory) {
    const toolNames = new Set((Array.isArray(tools) ? tools : []).map((tool) => String(tool && tool.name ? tool.name : '')));
    const platformPassedGates = typeof deps.appendAudit === 'function' ? ['audit_record_written'] : [];
    const target = (id, plannedTool, requiredGates, draftEvaluatedGates, globalBlockedGates) => {
      const toolPresent = toolNames.has(plannedTool);
      const passedGates = requiredGates.filter((gate) => platformPassedGates.includes(gate));
      const unevaluatedGates = requiredGates.filter(
        (gate) => draftEvaluatedGates.includes(gate) && !passedGates.includes(gate),
      );
      const blockedGates = requiredGates.filter(
        (gate) => globalBlockedGates.includes(gate) && !passedGates.includes(gate),
      );
      const missingGates = toolPresent ? blockedGates : [plannedTool, ...blockedGates];
      return {
        id,
        status: toolPresent ? 'preflight_registered_gated' : 'planned_tool_missing',
        ready: false,
        plannedTool,
        toolPresent,
        evaluationMode: 'global_status_without_concrete_draft',
        requiredGates,
        passedGates,
        missing: missingGates,
        blockedGates,
        unevaluatedGates,
        adminConfirmation: {
          required: requiredGates.includes('admin_confirmation'),
          passed: false,
          sourceRequired: 'copilot_ui',
          autoConfirmCountsAsAdminApproval: false,
        },
        nextStep: toolPresent
          ? `Run ${plannedTool} against a concrete workflow draft; global status only reports platform gates, while draft schema and sandbox gates are evaluated during preflight.`
          : `Implement governed promotion tool ${plannedTool} after draft workflow registry validation is stable.`,
      };
    };
    return {
      currentPhase: 'draft_only',
      publishableNow: false,
      draftInventory: draftInventory && typeof draftInventory === 'object' ? draftInventory : summarizeWorkflowDraftInventory(),
      reason:
        'Workflow drafts are discoverable team assets, but promotion to executable workbench presets or Script Hub tools is not open until governed promotion tools and E2E gates exist.',
      targets: [
        target('workbench_preset', 'ac.workflow.promote_workbench_preset', [
          'skill_draft_exists',
          'capability_route_schema_valid',
          'workbench_login_e2e_ready',
          'model_provider_readiness_checked',
          'admin_confirmation',
          'audit_record_written',
        ], ['skill_draft_exists', 'capability_route_schema_valid', 'model_provider_readiness_checked'], [
          'workbench_login_e2e_ready',
          'admin_confirmation',
        ]),
        target('script_hub_tool', 'ac.workflow.promote_script_hub_tool', [
          'skill_draft_exists',
          'script_manifest_valid',
          'script_hub_permission_checked',
          'sandbox_policy_checked',
          'admin_confirmation',
          'audit_record_written',
        ], ['skill_draft_exists', 'script_manifest_valid', 'script_hub_permission_checked', 'sandbox_policy_checked'], [
          'admin_confirmation',
        ]),
      ],
    };
  }

  async function summarizeWorkflowPublicationState() {
    const policy = deps.readPolicy();
    const tools = await deps.bodyHost.listTools();
    return summarizeWorkflowPublicationReadiness(policy, tools);
  }

  function summarizeReadinessBlockers({ mcpReady, codexRuntime, account, workbenchEntrance, workflowPublication, usageAudit }) {
    const blockers = [];
    const add = (id, severity, owner, nextStep, detail) => {
      blockers.push({
        id,
        severity,
        owner,
        nextStep,
        ...(detail && typeof detail === 'object' ? detail : {}),
      });
    };
    if (!mcpReady) {
      add('mcp_unavailable', 'critical', 'local_shell', 'Enable and restart the local MCP server before using Copilot as an external Agent body.');
    }
    if (!codexRuntime || !codexRuntime.readyHint) {
      add('codex_runtime_not_ready', 'action_required', 'admin', 'Configure the Codex command/cwd/auth state in Companion Settings.');
    }
    if (!account || !account.loggedIn) {
      add('workbench_login_required', 'action_required', 'user', 'Open the embedded Workbench and finish login.', {
        command: WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
        actions: workbenchLoginActions(),
      });
    }
    const entranceStatus = workbenchEntrance && workbenchEntrance.status ? String(workbenchEntrance.status) : '';
    if (entranceStatus && entranceStatus !== 'ready' && entranceStatus !== 'login_required') {
      add(`workbench_${entranceStatus}`, 'action_required', 'admin', workbenchEntrance.nextStep || 'Rerun the Workbench E2E validation.', {
        command: workbenchEntrance.waitLoginCommand || 'npm run smoke:agent-mcp:e2e:wait-login',
        actions: workbenchLoginActions(),
      });
    }
    const promotion = workflowPublication && workflowPublication.promotionReadiness;
    if (promotion && promotion.publishableNow === false) {
      const promotionTargets = Array.isArray(promotion.targets)
        ? promotion.targets.map((target) => ({
            id: target && target.id ? String(target.id) : '',
            status: target && target.status ? String(target.status) : '',
            plannedTool: target && target.plannedTool ? String(target.plannedTool) : '',
            passedGates: Array.isArray(target && target.passedGates) ? target.passedGates.map(String) : [],
            missingGates: Array.isArray(target && target.missing) ? target.missing.map(String) : [],
            unevaluatedGates: Array.isArray(target && target.unevaluatedGates) ? target.unevaluatedGates.map(String) : [],
            adminConfirmation:
              target && target.adminConfirmation && typeof target.adminConfirmation === 'object'
                ? {
                    required: Boolean(target.adminConfirmation.required),
                    passed: Boolean(target.adminConfirmation.passed),
                    sourceRequired: target.adminConfirmation.sourceRequired
                      ? String(target.adminConfirmation.sourceRequired)
                      : 'copilot_ui',
                    autoConfirmCountsAsAdminApproval: Boolean(target.adminConfirmation.autoConfirmCountsAsAdminApproval),
                  }
                : null,
          }))
        : [];
      const missingGates = [...new Set(promotionTargets.flatMap((target) => target.missingGates || []))];
      add('workflow_promotion_draft_only', 'info', 'admin', promotion.reason || 'Workflow drafts are not yet publishable as governed team tools.', {
        command: STATUS_COMMAND,
        phase: promotion.currentPhase || 'draft_only',
        publishableNow: false,
        draftInventory:
          promotion.draftInventory && typeof promotion.draftInventory === 'object'
            ? {
                count: Number(promotion.draftInventory.count) || 0,
                latest:
                  promotion.draftInventory.latest && typeof promotion.draftInventory.latest === 'object'
                    ? {
                        id: promotion.draftInventory.latest.id ? String(promotion.draftInventory.latest.id) : '',
                        name: promotion.draftInventory.latest.name ? String(promotion.draftInventory.latest.name) : '',
                        revision: Number.isFinite(Number(promotion.draftInventory.latest.revision))
                          ? Number(promotion.draftInventory.latest.revision)
                          : 1,
                        hasWorkbenchPreset: Boolean(promotion.draftInventory.latest.hasWorkbenchPreset),
                        hasScriptManifest: Boolean(promotion.draftInventory.latest.hasScriptManifest),
                        resourceUri: promotion.draftInventory.latest.resourceUri
                          ? String(promotion.draftInventory.latest.resourceUri)
                          : '',
                      }
                    : null,
              }
            : null,
        promotionTargets,
        missingGates,
        actions: workflowPromotionActions(),
      });
    }
    const usageCloudDraft =
      usageAudit && usageAudit.cloudDraft && typeof usageAudit.cloudDraft === 'object' ? usageAudit.cloudDraft : null;
    const usagePhase =
      usageAudit && usageAudit.currentPhase
        ? String(usageAudit.currentPhase)
        : usageAudit && usageAudit.totals && typeof usageAudit.totals === 'object'
          ? 'local_usage_signal'
          : '';
    const cloudEnforced = Boolean(usageAudit && usageAudit.cloudEnforced);
    if (usagePhase === 'local_usage_signal' && !cloudEnforced) {
      const usageMissingGates =
        usageCloudDraft && Array.isArray(usageCloudDraft.blockedBy)
          ? [...new Set(usageCloudDraft.blockedBy.map(String).filter(Boolean))]
          : [];
      add(
        'usage_governance_local_only',
        'info',
        'admin',
        'Local Copilot usage is visible, but team quota enforcement and cloud audit are not connected yet.',
        {
          command: STATUS_COMMAND,
          phase: usagePhase,
          cloudEnforced: false,
          resource: 'assetcutter://mcp/usage-audit',
          missingGates: usageMissingGates,
          actions: usageGovernanceActions(),
          cloudDraft: usageCloudDraft
            ? {
                currentPhase: usageCloudDraft.currentPhase || 'cloud_event_draft',
                targetApi: usageCloudDraft.targetApi || '/api/usage/events',
                eventCount: Number(usageCloudDraft.eventCount) || 0,
                uploadReady: Boolean(usageCloudDraft.uploadReady),
                blockedBy: Array.isArray(usageCloudDraft.blockedBy) ? usageCloudDraft.blockedBy.map(String) : [],
                uploadPlan:
                  usageCloudDraft.uploadPlan && typeof usageCloudDraft.uploadPlan === 'object'
                    ? {
                        endpoint: usageCloudDraft.uploadPlan.endpoint || '/api/usage/events',
                        method: usageCloudDraft.uploadPlan.method || 'POST',
                        credentials: usageCloudDraft.uploadPlan.credentials || 'include',
                        tool: usageCloudDraft.uploadPlan.tool || 'ac.usage.upload_cloud_draft',
                        idempotencyScope: usageCloudDraft.uploadPlan.idempotencyScope || '',
                        safeToRetry: Boolean(
                          usageCloudDraft.uploadPlan.retry && usageCloudDraft.uploadPlan.retry.safeToRetry,
                        ),
                      }
                    : null,
                quotaPolicy:
                  usageCloudDraft.quotaPolicy && typeof usageCloudDraft.quotaPolicy === 'object'
                    ? {
                        currentPhase: usageCloudDraft.quotaPolicy.currentPhase || 'usage_event_ingestion_ready',
                        billingSku: usageCloudDraft.quotaPolicy.billingSku || 'copilot.codex.tokens',
                        billingSkuRegisteredInDefaultCatalog: Boolean(
                          usageCloudDraft.quotaPolicy.billingSkuRegisteredInDefaultCatalog,
                        ),
                        usageBillingApiConfigured: Boolean(usageCloudDraft.quotaPolicy.usageBillingApiConfigured),
                        cloudQuotaEnforced: Boolean(usageCloudDraft.quotaPolicy.cloudQuotaEnforced),
                        usageBillingEnabled: Boolean(usageCloudDraft.quotaPolicy.usageBillingEnabled),
                        enforcementSource: usageCloudDraft.quotaPolicy.enforcementSource
                          ? String(usageCloudDraft.quotaPolicy.enforcementSource)
                          : '',
                        policyId: usageCloudDraft.quotaPolicy.policyId ? String(usageCloudDraft.quotaPolicy.policyId) : '',
                        probeTool: usageCloudDraft.quotaPolicy.probeTool || 'ac.usage.probe_quota_policy',
                        policyEndpoint: usageCloudDraft.quotaPolicy.policyEndpoint || '/api/usage/policy',
                      }
                    : null,
              }
            : null,
        },
      );
    }
    return blockers;
  }

  function readCodexRuntimeStatus() {
    if (typeof deps.getCodexRuntimeStatus !== 'function') return null;
    try {
      const raw = deps.getCodexRuntimeStatus();
      if (!raw || typeof raw !== 'object') return null;
      const auth = raw.auth && typeof raw.auth === 'object' ? raw.auth : {};
      return {
        command: raw.command ? String(raw.command) : '',
        cwd: raw.cwd ? String(raw.cwd) : '',
        cwdExists: Boolean(raw.cwdExists),
        model: raw.model ? String(raw.model) : '',
        sandbox: raw.sandbox ? String(raw.sandbox) : '',
        defaultBrain: raw.defaultBrain ? String(raw.defaultBrain) : '',
        isDefaultBrain: Boolean(raw.isDefaultBrain),
        auth: {
          exists: Boolean(auth.exists),
          path: auth.path ? String(auth.path) : '',
        },
        readyHint: Boolean(raw.readyHint),
      };
    } catch {
      return null;
    }
  }

  function normalizeConfirmResult(raw) {
    if (raw && typeof raw === 'object' && 'approved' in raw) {
      return {
        approved: Boolean(raw.approved),
        reason: String(raw.reason || (raw.approved ? 'approved' : 'rejected')),
      };
    }
    if (raw === true) return { approved: true, reason: 'approved' };
    return { approved: false, reason: 'rejected' };
  }

  function traceIdFromArgs(args) {
    if (!args || typeof args !== 'object') return null;
    const traceId = args.traceId || args.trace_id || args.conversationId || args.idempotencyKey;
    return traceId ? String(traceId).slice(0, 160) : null;
  }

  function requestIdKey(id) {
    if (id === undefined || id === null) return '';
    return `${typeof id}:${String(id)}`;
  }

  function isAbortSignalAborted(signal) {
    return Boolean(signal && signal.aborted);
  }

  function cancelledToolResult(message) {
    return {
      ok: false,
      content: '',
      error: { code: 'AGENT_CANCELLED', message: message || 'request cancelled' },
    };
  }

  function sanitizeToolArgsForConfirm(toolName, args) {
    const out = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
    if (typeof out.imageDataUrl === 'string' && out.imageDataUrl.length > 96) {
      out.imageDataUrl = `[data-url omitted, chars=${out.imageDataUrl.length}]`;
    }
    if (String(toolName || '').includes('create_image_asset') && !out.localPath && out.imageDataUrl) {
      out.hint = 'Prefer localPath for real imports; imageDataUrl is for tiny debug only.';
    }
    return out;
  }

  async function waitForConfirmWithSignal(confirmId, meta, signal) {
    if (isAbortSignalAborted(signal)) return { approved: false, reason: 'cancelled' };
    const confirmPromise = deps.waitForConfirm(confirmId, { ...(meta || {}), signal });
    if (!signal) return normalizeConfirmResult(await confirmPromise);
    const cancelPromise = new Promise((resolve) => {
      const onAbort = () => resolve({ approved: false, reason: 'cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
      confirmPromise.finally(() => signal.removeEventListener('abort', onAbort));
    });
    return normalizeConfirmResult(await Promise.race([confirmPromise, cancelPromise]));
  }

  function toolErrorGuidance(code) {
    if (code === 'AGENT_AUTH_REQUIRED') {
      return '工作台未登录或登录态不可用；请先在工作台完成登录，然后重新调用。';
    }
    if (code === 'AGENT_FORBIDDEN') {
      return '当前账号或策略没有权限执行此操作；请切换账号、项目或让管理员调整权限。';
    }
    if (code === 'AGENT_WORKBENCH_BRIDGE') {
      return '工作台 BrowserView 桥接不可用；请确认工作台已打开并完成加载。';
    }
    if (code === 'AGENT_INPUT_REQUIRED') {
      return '工具缺少必要输入；请查看 structuredContent.requiredInput 或 details，并补齐后重试。';
    }
    if (code === 'AGENT_PROJECT_REQUIRED') {
      return '当前没有可承载结果的工作区项目；请先调用 ac.workbench.create_project，或打开已有项目后重试。';
    }
    if (code === 'AGENT_PROJECT_NOT_FOUND') {
      return '指定工作区项目不存在；请调用 ac.workbench.get_context 获取可用项目 id，或创建新项目。';
    }
    if (code === 'AGENT_PRESET_NOT_FOUND') {
      return '指定能力预设不存在；请调用 ac.workbench.get_context 查看 capabilityPresets 后重试。';
    }
    if (code === 'AGENT_PRESET_NOT_DIRECT_RUNNABLE') {
      return '该能力需要工作台交互，不能直接由 Agent 执行；请换用 directRunSupported=true 的预设。';
    }
    if (code === 'AGENT_ASSET_NOT_FOUND') {
      return '指定资产不存在；请调用 ac.workbench.list_assets 查看可用 assetId 后重试。';
    }
    if (code === 'AGENT_WORKBENCH_HTTP' || code === 'AGENT_COMPANION_HTTP' || code === 'AGENT_SCRIPT_HUB_HTTP') {
      return '下游服务请求失败；请检查工作台/伴侣/Script Hub 状态后重试。';
    }
    if (code === 'AGENT_CONFIRM_REQUIRED') {
      return '需要在 Copilot 或管理员策略里允许这个高风险工具后再执行。';
    }
    if (code === 'AGENT_CONFIRM_REJECTED') {
      return '用户已拒绝本次授权；如果仍要执行，请重新发起并在 Copilot 中允许。';
    }
    if (code === 'AGENT_CONFIRM_TIMEOUT') {
      return '前端授权超时；请保持 Copilot 打开后重新发起调用。';
    }
    if (code === 'AGENT_CONFIRM_CANCELLED') {
      return '授权请求已取消；请重新发起调用。';
    }
    if (code === 'AGENT_CANCELLED') {
      return '请求已被外部 agent 取消；如仍需执行，请重新发起调用。';
    }
    if (code === 'AGENT_TOOL_DENIED') {
      return '当前策略禁止此工具，请切换工具或让管理员调整权限。';
    }
    if (code === 'AGENT_TOOL_UNKNOWN') {
      return '先调用 tools/list 或读取 assetcutter://mcp/tool-catalog，确认工具名是否存在。';
    }
    if (code === 'AGENT_TOOL_INVALID_ARGS') {
      return '根据 tools/list 返回的 inputSchema 修正参数后重试。';
    }
    return '查看 content/error，并结合 assetcutter://mcp/tool-catalog 的 successSignals 决定下一步。';
  }

  function toolErrorAttributes(code) {
    const c = String(code || '');
    const out = {
      authRequired: c === 'AGENT_AUTH_REQUIRED',
      forbidden: c === 'AGENT_FORBIDDEN' || c === 'AGENT_TOOL_DENIED',
      requiresFrontendAuthorization:
        c === 'AGENT_CONFIRM_REQUIRED' || c === 'AGENT_CONFIRM_TIMEOUT' || c === 'AGENT_CONFIRM_CANCELLED',
      requiresInput: c === 'AGENT_INPUT_REQUIRED',
      projectRequired: c === 'AGENT_PROJECT_REQUIRED',
      projectNotFound: c === 'AGENT_PROJECT_NOT_FOUND',
      presetNotFound: c === 'AGENT_PRESET_NOT_FOUND',
      presetNotRunnable: c === 'AGENT_PRESET_NOT_DIRECT_RUNNABLE',
      assetNotFound: c === 'AGENT_ASSET_NOT_FOUND',
      retryable:
        c === 'AGENT_CONFIRM_REQUIRED' ||
        c === 'AGENT_CONFIRM_TIMEOUT' ||
        c === 'AGENT_CONFIRM_CANCELLED' ||
        c === 'AGENT_INPUT_REQUIRED' ||
        c === 'AGENT_PROJECT_REQUIRED' ||
        c === 'AGENT_PROJECT_NOT_FOUND' ||
        c === 'AGENT_PRESET_NOT_FOUND' ||
        c === 'AGENT_ASSET_NOT_FOUND' ||
        c === 'AGENT_AUTH_REQUIRED' ||
        c === 'AGENT_WORKBENCH_BRIDGE' ||
        c === 'AGENT_WORKBENCH_HTTP' ||
        c === 'AGENT_COMPANION_HTTP' ||
        c === 'AGENT_SCRIPT_HUB_HTTP',
    };
    if (c === 'AGENT_AUTH_REQUIRED') {
      out.view = 'workbench';
      out.action = 'open_workbench_login';
      out.recoveryTool = {
        name: 'ac.shell.navigate',
        arguments: { view: 'workbench' },
        after: 'Wait for the user to finish login in the workbench view, then retry the failed workbench tool.',
      };
    } else if (out.requiresFrontendAuthorization) {
      out.action = 'approve_in_copilot';
    } else if (out.projectRequired) {
      out.action = 'create_or_open_project';
    } else if (out.retryable) {
      out.action = 'retry_after_recovery';
    }
    return out;
  }

  function structuredRecoveryAttributes(structured) {
    const root = structured && typeof structured === 'object' ? structured : {};
    const bridge = root.bridge && typeof root.bridge === 'object' ? root.bridge : {};
    const requiredInput = root.requiredInput || bridge.requiredInput || null;
    const requiresInput = Boolean(root.requiresInput || bridge.requiresInput || requiredInput);
    const bridgeError = String(bridge.error || root.error || '');
    const projectRequired = Boolean(root.projectRequired || bridge.projectRequired || bridgeError === 'project_required');
    const projectNotFound = Boolean(root.projectNotFound || bridge.projectNotFound || bridgeError === 'project_not_found');
    const presetNotFound = Boolean(root.presetNotFound || bridge.presetNotFound || bridgeError === 'preset_not_found');
    const presetNotRunnable = Boolean(
      root.presetNotRunnable || bridge.presetNotRunnable || bridgeError === 'preset_not_direct_runnable',
    );
    const assetNotFound = Boolean(root.assetNotFound || bridge.assetNotFound || bridgeError === 'asset_not_found');
    return {
      ...(requiresInput ? { requiresInput: true } : {}),
      ...(requiredInput ? { requiredInput: String(requiredInput) } : {}),
      ...(projectRequired ? { projectRequired: true } : {}),
      ...(projectNotFound ? { projectNotFound: true } : {}),
      ...(presetNotFound ? { presetNotFound: true } : {}),
      ...(presetNotRunnable ? { presetNotRunnable: true } : {}),
      ...(assetNotFound ? { assetNotFound: true } : {}),
    };
  }

  async function executeMcpTool(name, args, requestMeta) {
    const startedAt = Date.now();
    const toolCallId = makeToolCallId();
    const jsonRpcId =
      requestMeta && Object.prototype.hasOwnProperty.call(requestMeta, 'jsonRpcId') ? requestMeta.jsonRpcId : null;
    const signal = requestMeta && requestMeta.signal ? requestMeta.signal : null;
    const traceId = traceIdFromArgs(args);
    const append = (result, policyDecision) => {
      const durationMs = Date.now() - startedAt;
      const workflowPromotionPreflight = workflowPromotionAuditSummary(name, result);
      const usageGovernance = usageGovernanceAuditSummary(name, result);
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        toolCallId,
        jsonRpcId,
        traceId,
        tool: name,
        ok: result.ok,
        errorCode: result.error?.code || null,
        argsDigest: argsDigest(args),
        durationMs,
        policyDecision: policyDecision || null,
        ...(workflowPromotionPreflight ? { workflowPromotionPreflight } : {}),
        ...(usageGovernance ? { usageGovernance } : {}),
      });
      result.mcp = {
        toolCallId,
        jsonRpcId,
        traceId,
        durationMs,
        policyDecision: policyDecision || null,
        nextStep: result.ok ? '继续根据 structuredContent 或 content 判断是否需要下一步工具。' : toolErrorGuidance(result.error?.code),
      };
    };
    if (isAbortSignalAborted(signal)) {
      const result = cancelledToolResult();
      append(result, 'cancelled');
      return result;
    }
    const tools = await deps.bodyHost.listTools();
    const schema = tools.find((t) => t.name === name);
    if (!schema) {
      const result = {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_UNKNOWN', message: name },
      };
      append(result, 'unknown');
      return result;
    }
    const gate = deps.gateTool(schema);
    if (gate === 'deny') {
      const result = {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_DENIED', message: 'policy denied' },
      };
      append(result, 'deny');
      return result;
    }
    let frontendConfirmationApproved = false;
    if (gate === 'confirm') {
      const policy = deps.readPolicy();
      const auto = Array.isArray(policy.autoConfirmTools) ? policy.autoConfirmTools : [];
      if (!auto.includes(name)) {
        if (typeof deps.waitForConfirm !== 'function') {
          const result = {
            ok: false,
            content: '',
            error: {
              code: 'AGENT_CONFIRM_REQUIRED',
              message: 'confirm tool requires policy autoConfirmTools or Copilot UI',
            },
            structured: {
              clientId: 'mcp',
              requiresFrontendAuthorization: true,
              confirmId: null,
              confirmReason: 'copilot_ui_unavailable',
              nextStep: '请打开 Copilot 前端，或由管理员将该工具加入 autoConfirmTools 后重试。',
            },
          };
          append(result, 'confirm_required');
          return result;
        }
        const confirmId = makeConfirmId();
        const confirmResult = await waitForConfirmWithSignal(
          confirmId,
          {
            name,
            arguments: sanitizeToolArgsForConfirm(name, args && typeof args === 'object' ? args : {}),
            clientId: 'mcp',
            sessionId: 'mcp',
            toolCallId,
            traceId,
            timeoutMs: 120000,
          },
          signal,
        );
        if (!confirmResult.approved) {
          const code =
            confirmResult.reason === 'timeout'
              ? 'AGENT_CONFIRM_TIMEOUT'
              : confirmResult.reason === 'cancelled'
                ? 'AGENT_CONFIRM_CANCELLED'
                : 'AGENT_CONFIRM_REJECTED';
          const result = {
            ok: false,
            content: '',
            error: {
              code,
              message:
                code === 'AGENT_CONFIRM_TIMEOUT'
                  ? 'confirm timeout'
                  : code === 'AGENT_CONFIRM_CANCELLED'
                    ? 'confirm cancelled'
                    : 'user rejected',
            },
            structured: {
              clientId: 'mcp',
              requiresFrontendAuthorization: code !== 'AGENT_CONFIRM_REJECTED',
              confirmId,
              confirmReason: confirmResult.reason || 'rejected',
              nextStep:
                code === 'AGENT_CONFIRM_TIMEOUT'
                  ? 'Copilot 前端授权超时。请保持 Copilot 打开并重新发起调用。'
                  : code === 'AGENT_CONFIRM_CANCELLED'
                    ? '请求已取消。如仍需执行，请重新发起调用。'
                    : '用户已拒绝本次工具授权。如仍需执行，请解释目的后重新发起调用。',
            },
          };
          append(result, confirmResult.reason === 'timeout' ? 'confirm_timeout' : 'confirm_rejected');
          return result;
        }
        frontendConfirmationApproved = true;
      }
    }
    if (isAbortSignalAborted(signal)) {
      const result = cancelledToolResult();
      append(result, 'cancelled');
      return result;
    }
    const policyDecision = gate === 'confirm' ? 'auto_confirm' : 'allow';
    const ctx = {
      sessionId: 'mcp',
      brainId: 'external',
      shellView: deps.getShellView(),
      clientId: 'mcp',
      toolCallId,
      traceId,
      policyDecision,
      adminConfirmationPassed: frontendConfirmationApproved,
      adminConfirmationSource: frontendConfirmationApproved ? 'copilot_ui' : '',
      signal,
    };
    const result = await deps.bodyHost.executeTool(name, args && typeof args === 'object' ? args : {}, ctx);
    append(result, policyDecision);
    return result;
  }

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function isNotification(body) {
    return isObject(body) && !Object.prototype.hasOwnProperty.call(body, 'id');
  }

  function jsonRpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id: id ?? null, error };
  }

  function textFromToolResult(result) {
    if (result && typeof result.content === 'string' && result.content) return result.content;
    if (result && result.structured !== undefined) {
      try {
        return JSON.stringify(result.structured, null, 2);
      } catch {
        return String(result.structured);
      }
    }
    return '';
  }

  function mcpToolCallResult(result) {
    const ok = Boolean(result && result.ok);
    const error = ok ? null : (result && result.error) || { code: 'AGENT_TOOL_EXEC_FAILED', message: 'tool failed' };
    const text = ok ? textFromToolResult(result) : JSON.stringify(error);
    const mcp = result && result.mcp && typeof result.mcp === 'object' ? result.mcp : {};
    const attrs = toolErrorAttributes(error && error.code);
    const recoveryAttrs = !ok ? structuredRecoveryAttributes(result && result.structured) : {};
    const out = {
      content: [{ type: 'text', text }],
      isError: !ok,
      _meta: {
        assetcutter: {
          ok,
          error,
          toolCallId: mcp.toolCallId || null,
          jsonRpcId: mcp.jsonRpcId ?? null,
          traceId: mcp.traceId || null,
          durationMs: Number.isFinite(Number(mcp.durationMs)) ? Number(mcp.durationMs) : null,
          policyDecision: mcp.policyDecision || null,
          nextStep: mcp.nextStep || null,
          ...(!ok ? { ...attrs, ...recoveryAttrs } : {}),
        },
      },
    };
    if (ok && result && result.structured !== undefined) out.structuredContent = result.structured;
    if (!ok) {
      out.structuredContent = {
        ok: false,
        error,
        details: result && result.structured !== undefined ? result.structured : null,
        toolCallId: mcp.toolCallId || null,
        jsonRpcId: mcp.jsonRpcId ?? null,
        traceId: mcp.traceId || null,
        durationMs: Number.isFinite(Number(mcp.durationMs)) ? Number(mcp.durationMs) : null,
        policyDecision: mcp.policyDecision || null,
        nextStep: mcp.nextStep || null,
        ...attrs,
        ...recoveryAttrs,
      };
    }
    return out;
  }

  function encodeCursor(offset) {
    return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
  }

  function decodeCursor(cursor) {
    if (!cursor) return 0;
    try {
      const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
      const offset = Number(parsed && parsed.offset);
      return Number.isInteger(offset) && offset >= 0 ? offset : 0;
    } catch {
      return 0;
    }
  }

  function paginateList(items, params, pageSize = MCP_LIST_PAGE_SIZE) {
    const list = Array.isArray(items) ? items : [];
    const start = Math.min(list.length, decodeCursor(params && params.cursor));
    const size = Math.max(1, Number(pageSize) || MCP_LIST_PAGE_SIZE);
    const end = Math.min(list.length, start + size);
    const result = list.slice(start, end);
    const out = { items: result };
    if (end < list.length) out.nextCursor = encodeCursor(end);
    return out;
  }

  function completionResult(values, rawValue) {
    const needle = String(rawValue || '').toLowerCase();
    const unique = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
      const value = String(raw || '').trim();
      if (!value || seen.has(value)) continue;
      if (needle && !value.toLowerCase().includes(needle)) continue;
      seen.add(value);
      unique.push(value);
    }
    const page = unique.slice(0, 100);
    return {
      completion: {
        values: page,
        total: unique.length,
        hasMore: unique.length > page.length,
      },
    };
  }

  function completeArgument(params) {
    const ref = params && typeof params.ref === 'object' ? params.ref : {};
    const argument = params && typeof params.argument === 'object' ? params.argument : {};
    const contextArgs =
      params && params.context && typeof params.context.arguments === 'object' ? params.context.arguments : {};
    const argName = String(argument.name || '').trim();
    const value = argument.value || '';
    const refType = String(ref.type || '');
    const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
    const skills = listSkillEntries(root);

    if (argName === 'document' || String(ref.uri || ref.uriTemplate || '').startsWith('assetcutter://mcp/')) {
      return completionResult(
        [
          'manifest',
          'tool-catalog',
          'quickstart',
          'workbench-flow',
          'policy',
          'server-status',
          'tool-executions',
          'usage-audit',
          'workflow-publication',
        ],
        value,
      );
    }
    if (argName === 'skillId' || refType === 'ref/prompt' || refType === 'prompt') {
      return completionResult(skills.map((s) => s.id), value);
    }
    if (argName === 'revision') {
      const skillId = String(contextArgs.skillId || contextArgs.id || '').trim();
      const revisionValues = [];
      if (skillId) {
        const revisions = listSkillRevisions(root, skillId);
        if (revisions.ok) {
          for (const revision of revisions.revisions || []) revisionValues.push(String(revision.revision));
        }
      } else {
        for (const skill of skills) {
          const revisions = listSkillRevisions(root, skill.id);
          if (!revisions.ok) continue;
          for (const revision of revisions.revisions || []) revisionValues.push(String(revision.revision));
        }
      }
      return completionResult(revisionValues, value);
    }
    return completionResult([], value);
  }

  function builtInResources() {
    return [
      {
        uri: 'assetcutter://mcp/manifest',
        name: 'AssetCutter MCP Manifest',
        description: 'Versioned machine-readable contract for AssetCutter MCP capabilities and extension points.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/tool-catalog',
        name: 'AssetCutter MCP Tool Catalog',
        description: 'Grouped ac.* tool catalog with risk levels, surfaces, and input schemas.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/quickstart',
        name: 'AssetCutter MCP Quickstart',
        description: 'Concise integration guide for external agents calling AssetCutter tools.',
        mimeType: 'text/markdown',
      },
      {
        uri: WORKBENCH_FLOW_RESOURCE_URI,
        name: 'AssetCutter Workbench Flow',
        description: 'Machine-readable workbench task contract, required tool chain, recovery codes, and E2E gates.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/policy',
        name: 'AssetCutter MCP Policy',
        description: 'Sanitized permission policy and per-tool gate decisions for external agents.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/server-status',
        name: 'AssetCutter MCP Server Status',
        description: 'Local MCP server status without exposing the bearer token.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/tool-executions',
        name: 'AssetCutter MCP Tool Executions',
        description: 'Recent sanitized tool execution records for external agent traceability.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/usage-audit',
        name: 'AssetCutter MCP Usage Audit',
        description: 'Sanitized local Copilot usage audit summaries for team governance and quota preflight.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/workflow-publication',
        name: 'AssetCutter Workflow Publication Contract',
        description: 'Machine-readable path for external Agents to turn reusable workflows into governed team assets.',
        mimeType: 'application/json',
      },
    ];
  }

  function resourceTemplates() {
    return [
      {
        uriTemplate: 'assetcutter://mcp/{document}',
        name: 'AssetCutter MCP Documents',
        title: 'AssetCutter MCP Documents',
        description: 'Read built-in MCP documents such as manifest, tool-catalog, workbench-flow, server-status, usage-audit, and tool-executions.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'skill://{skillId}',
        name: 'AssetCutter Skill',
        title: 'AssetCutter Skill',
        description: 'Read a reusable skill/workflow by skill id.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'skill://{skillId}/revisions',
        name: 'AssetCutter Skill Revisions',
        title: 'AssetCutter Skill Revisions',
        description: 'Read revision summaries for a reusable skill/workflow.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'skill://{skillId}/revisions/{revision}',
        name: 'AssetCutter Skill Revision',
        title: 'AssetCutter Skill Revision',
        description: 'Read a specific revision of a reusable skill/workflow.',
        mimeType: 'application/json',
      },
    ];
  }

  function skillRevisionResources(skillsRoot, skills) {
    const out = [];
    for (const skill of Array.isArray(skills) ? skills : []) {
      const revisions = listSkillRevisions(skillsRoot, skill.id);
      if (!revisions.ok) continue;
      for (const revision of revisions.revisions || []) {
        out.push({
          uri: `skill://${skill.id}/revisions/${revision.revision}`,
          name: `${skill.name || skill.id} Revision ${revision.revision}`,
          description: `${revision.kind || 'revision'} version of ${skill.name || skill.id}`,
          mimeType: 'application/json',
        });
      }
    }
    return out;
  }

  function resourceUriExists(uri) {
    const wanted = String(uri || '').trim();
    if (!wanted) return false;
    if (builtInResources().some((r) => r.uri === wanted)) return true;
    const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
    const skills = listSkillEntries(root);
    if (skills.some((s) => `skill://${s.id}` === wanted || `skill://${s.id}/revisions` === wanted)) return true;
    return skillRevisionResources(root, skills).some((r) => r.uri === wanted);
  }

  async function readBuiltInResource(uri) {
    if (uri === 'assetcutter://mcp/manifest') {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            protocolVersion: MCP_PROTOCOL_VERSION,
            supportedProtocolVersions: MCP_SUPPORTED_PROTOCOL_VERSIONS,
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
            capabilities: {
              tools: true,
              resources: true,
              resourceSubscriptions: true,
              prompts: true,
              completions: true,
              logging: true,
              cancellation: true,
            },
            logging: {
              level: loggingLevel,
              levels: MCP_LOG_LEVELS,
              note: 'AssetCutter currently stores request/audit traceability through resources instead of streaming log notifications.',
            },
            instructions: serverInstructions(),
            namespaces: {
              tools: [
                'ac.shell.*',
                'ac.workbench.*',
                'ac.script_hub.*',
                'ac.companion.*',
                'ac.skills.*',
                'ac.usage.*',
                'ac.memory.*',
              ],
              resources: ['assetcutter://mcp/*', 'skill://*'],
              prompts: ['skill:*'],
            },
            recovery: {
              structuredFields: [
                'authRequired',
                'forbidden',
                'requiresFrontendAuthorization',
                'retryable',
                'requiresInput',
                'nextStep',
                'recoveryTool',
              ],
              loginRecoveryTool: {
                name: 'ac.shell.navigate',
                arguments: { view: 'workbench' },
                after: 'Wait for the user to finish login in the workbench view, then retry the failed workbench tool.',
              },
              workbenchFlowResource: WORKBENCH_FLOW_RESOURCE_URI,
              serverStatusResource: 'assetcutter://mcp/server-status',
              workflowPublicationResource: 'assetcutter://mcp/workflow-publication',
              blockerActions:
                'Read assetcutter://mcp/server-status readiness.blockers[].actions; each action may contain a shell command for humans, an MCP tool name plus args for Agents, owner, and risk.',
            },
            resources: builtInResources().map((r) => ({
              uri: r.uri,
              name: r.name,
              mimeType: r.mimeType,
            })),
            extensionGuidance: {
              addTool: 'Register the tool schema in agent-tool-schemas.cjs and dispatch it in agent-body-host.cjs.',
              addPrompt: 'Add a skill under agent-store/skills with skill.json or SKILL.md.',
              publishWorkflow: 'Read assetcutter://mcp/workflow-publication, then save reusable drafts through ac.skills.save before any governed Script Hub or workbench preset promotion.',
              policy: 'High-risk tools should use risk=confirm and can be managed through policy.json.',
            },
          },
          null,
          2,
        ),
      };
    }
    if (uri === 'assetcutter://mcp/tool-catalog') {
      const tools = await deps.bodyHost.listTools();
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(buildToolCatalog(tools), null, 2),
      };
    }
    if (uri === 'assetcutter://mcp/quickstart') {
      return {
        uri,
        mimeType: 'text/markdown',
        text: [
          '# AssetCutter MCP Quickstart',
          '',
          'Use this server as the local body for AssetCutter. It exposes workbench, script hub, companion runtime, skills, and memory tools under the `ac.*` namespace.',
          '',
          'Recommended flow:',
          '',
          '1. Call `initialize`, then `tools/list`.',
          '2. Call `ac.shell.get_state` to inspect the current shell, team account, pairing, brain, and workbench state.',
          '3. Call `ac.workbench.ensure_ready` before opening projects or running workbench capabilities; it navigates to the workbench, checks login/project/capability readiness, and can create a project when `requireProject=true` and `createIfMissing=true`.',
          '4. If you need an explicit project creation step, call `ac.workbench.create_project`; after generation, call `ac.workbench.list_assets` and `ac.workbench.get_asset` to verify outputs.',
          '5. Read `assetcutter://mcp/policy` before confirm-risk tools to know whether they will run, prompt, or be denied.',
          '6. Use safe tools freely for inspection. Use confirm-risk tools only when user intent is clear and policy allows it.',
          '7. Read `assetcutter://mcp/tool-catalog` for grouped tool guidance and example arguments.',
          '8. Read `resources/templates/list` and `prompts/list` to discover reusable team workflows.',
          '9. Use `completion/complete` for resource template arguments such as `document`, `skillId`, and `revision`.',
          '10. For `ac.workbench.run_capability`, first ensure there is an active project, then inspect `capabilityPresets` from `ac.workbench.ensure_ready`/`ac.workbench.get_context`: only call presets with `directRunSupported=true`; pass `inputText` for text/prompt input, `imageDataUrl` for direct image input, or `inputAssetId`/`inputAssetDisplayKey` to use an existing workbench asset as input.',
          '11. Treat `authRequired`, `forbidden`, `requiresFrontendAuthorization`, `retryable`, `requiresInput`, `nextStep`, and `recoveryTool` in `structuredContent` as the recovery contract; if `authRequired` is true, call `ac.shell.navigate` with `{ "view": "workbench" }`, wait for the user to log in, then retry the failed workbench tool.',
          '12. Read `assetcutter://mcp/server-status` before workbench E2E validation. Check `readiness.codexRuntime.readyHint`, `readiness.workbenchEntrance.status`, `readiness.account.loggedIn`, `readiness.account.partition`, and `readiness.lastWorkbenchE2eFreshness`; after the embedded workbench is logged in, run `npm run smoke:agent-mcp:e2e -- --config <hermes-mcp-import.json>` to verify create project -> run capability -> list assets -> get asset. If login may happen during validation, use `npm run smoke:agent-mcp:e2e:wait-login`.',
          '13. Treat `assetcutter://mcp/server-status` `readiness.blockers[].actions` as the canonical next-step list. Prefer safe actions first; for actions with `tool`, call the named MCP tool with the provided `args` when policy allows; for actions with `command`, report or run the command only in the local shell context. Login actions should open the embedded Workbench and then rerun the wait-login E2E command.',
          '14. For usage governance, read `assetcutter://mcp/usage-audit`, call safe `ac.usage.probe_quota_policy` to refresh the team quota policy through the shell session, and use `ac.usage.upload_cloud_draft` with `dryRun=true` before any real upload. Real upload is confirm-risk and still runs only through the shell first-party session.',
          '',
          'Important resources:',
          '',
          '- `assetcutter://mcp/manifest`: versioned machine-readable server contract.',
          '- `assetcutter://mcp/tool-catalog`: grouped tools with risk, surfaces, examples, and success signals.',
          '- `assetcutter://mcp/workbench-flow`: machine-readable workbench task flow, recovery contract, and E2E gates.',
          '- `assetcutter://mcp/policy`: sanitized permission policy and per-tool gate decisions.',
          '- `assetcutter://mcp/server-status`: local server status without exposing the bearer token.',
          '- `assetcutter://mcp/usage-audit`: sanitized local Copilot usage summaries for team governance and quota preflight.',
          '- `assetcutter://mcp/tool-executions`: recent sanitized tool execution records for traceability.',
          '- `assetcutter://mcp/workflow-publication`: governed workflow assetization path for external Agent drafts.',
          '- `skill://{skillId}`: reusable skill/workflow definition.',
        ].join('\n'),
      };
    }
    if (uri === 'assetcutter://mcp/workflow-publication') {
      const tools = await deps.bodyHost.listTools();
      const toolNames = new Set((Array.isArray(tools) ? tools : []).map((tool) => String(tool && tool.name ? tool.name : '')));
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            northStar:
              'Copilot is the unified Agent entrance into the team workbench, not another web chatbot.',
            objective:
              'Let external Agents research and draft reusable workflows, then bring them back into AssetCutter as governed team assets.',
            currentPhase: 'skill_draft_registry',
            entrypoints: {
              draftWorkflow: {
                tool: 'ac.skills.save',
                risk: 'confirm',
                stores: 'agent-store/skills',
                discoverableVia: ['prompts/list', 'resources/list', 'skill://{skillId}', 'ac.skills.list'],
                requiredFields: ['name', 'prompt'],
                recommendedFields: ['description', 'toolHints'],
              },
              inspectWorkflow: {
                tools: ['ac.skills.list', 'ac.skills.get', 'ac.skills.revisions', 'ac.skills.revision_get'],
                resources: ['skill://{skillId}', 'skill://{skillId}/revisions/{revision}'],
              },
              retireWorkflow: {
                tool: 'ac.skills.delete',
                risk: 'confirm',
                audit: 'Tool execution is recorded through the local MCP audit log.',
              },
            },
            promotionTargets: [
              {
                id: 'workbench_preset',
                status: toolNames.has('ac.workflow.promote_workbench_preset') ? 'preflight_registered_gated' : 'planned',
                plannedTool: 'ac.workflow.promote_workbench_preset',
                boundary:
                  'Promotion to a workbench preset must validate capability route, input/output schema, model/provider readiness, permissions, and E2E result.',
              },
              {
                id: 'script_hub_tool',
                status: toolNames.has('ac.workflow.promote_script_hub_tool') ? 'preflight_registered_gated' : 'planned',
                plannedTool: 'ac.workflow.promote_script_hub_tool',
                boundary:
                  'Promotion to Script Hub must go through the Script Hub tool asset, revision, permission, run, and audit chain; external Agents should not bypass this by executing arbitrary scripts.',
              },
            ],
            promotionReadiness: buildWorkflowPromotionReadiness(tools),
            governance: {
              policyResource: 'assetcutter://mcp/policy',
              statusResource: 'assetcutter://mcp/server-status',
              auditResources: ['assetcutter://mcp/tool-executions'],
              usageSignal: 'assetcutter://mcp/usage-audit',
              confirmations:
                'Workflow writes and retirements are confirm-risk actions unless an admin explicitly changes policy.',
            },
            recommendedExternalAgentFlow: [
              'Read assetcutter://mcp/server-status and assetcutter://mcp/policy.',
              'Draft the reusable workflow using only stable ac.* tools and documented recovery contracts.',
              'Call ac.skills.save with a concise prompt and toolHints for the ac.* tools it needs.',
              'Verify it appears in prompts/list, resources/list, and skill://{skillId}.',
              'Use ac.skills.revisions before replacing a published draft.',
              'Treat workbench preset or Script Hub promotion as a separate governed release step until the promotion tools are implemented.',
            ],
            notAllowed: [
              'Do not claim a skill draft is a published Script Hub tool.',
              'Do not bypass ac.* tools to operate the workbench or local shell directly.',
              'Do not embed secrets in skill prompts or descriptions.',
            ],
          },
          null,
          2,
        ),
      };
    }
    if (uri === WORKBENCH_FLOW_RESOURCE_URI) {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(buildWorkbenchFlowDocument(), null, 2),
      };
    }
    if (uri === 'assetcutter://mcp/policy') {
      const policy = deps.readPolicy();
      const tools = await deps.bodyHost.listTools();
      const decisions = tools
        .map((tool) => {
          const name = String(tool.name || '');
          const risk = String(tool.risk || 'safe');
          const decision = deps.gateTool(tool);
          return {
            name,
            risk,
            decision,
            requiresFrontendAuthorization: decision === 'confirm',
            autoConfirmed: decision === 'allow' && risk === 'confirm',
            forbidden: decision === 'deny',
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            confirmTools: Boolean(policy.confirmTools),
            autoConfirmTools: Array.isArray(policy.autoConfirmTools) ? policy.autoConfirmTools.map(String).sort() : [],
            forbiddenTools: Array.isArray(policy.forbiddenTools) ? policy.forbiddenTools.map(String).sort() : [],
            toolDecisions: decisions,
            guidance: {
              allow: 'Tool can run without a frontend prompt under the current policy.',
              confirm: 'Tool requires Copilot frontend authorization unless the admin adds it to autoConfirmTools.',
              deny: 'Tool is blocked by policy and should not be retried until an admin changes the policy.',
            },
          },
          null,
          2,
        ),
      };
    }
    if (uri === 'assetcutter://mcp/server-status') {
      const s = status();
      const settings = deps.readSettings();
      const policy = deps.readPolicy();
      const tools = await deps.bodyHost.listTools();
      const executions =
        typeof deps.listToolExecutions === 'function' ? deps.listToolExecutions({ days: 1, limit: 80 }) : [];
      const usageAudit =
        typeof deps.summarizeUsageAudit === 'function' ? deps.summarizeUsageAudit({ days: 1, limit: 5000 }) : null;
      if (usageAudit && typeof usageAudit === 'object') {
        usageAudit.currentPhase = usageAudit.currentPhase || 'local_usage_signal';
        usageAudit.cloudEnforced = Boolean(usageAudit.cloudEnforced);
        usageAudit.cloudDraft =
          usageAudit.cloudDraft && typeof usageAudit.cloudDraft === 'object'
            ? usageAudit.cloudDraft
            : buildCopilotUsageCloudDraft(usageAudit);
        usageAudit.governanceEvidence = summarizeUsageGovernanceEvidence(executions);
      }
      let shellState = null;
      try {
        shellState = typeof deps.getStateSummary === 'function' ? await deps.getStateSummary() : null;
      } catch {
        shellState = null;
      }
      const account =
        shellState && typeof shellState === 'object' && shellState.account && typeof shellState.account === 'object'
          ? shellState.account
          : null;
      const riskCounts = tools.reduce(
        (acc, tool) => {
          const risk = String(tool && tool.risk ? tool.risk : 'safe');
          acc[risk] = (acc[risk] || 0) + 1;
          return acc;
        },
        {},
      );
      let shellView = 'unknown';
      try {
        shellView = String(deps.getShellView() || 'unknown');
      } catch {
        shellView = 'unknown';
      }
      const workbenchVisible = shellView === 'workbench';
      const workbenchNextStep = workbenchVisible
        ? 'Call ac.workbench.get_context. If it returns authRequired, use recoveryTool ac.shell.navigate({ view: "workbench" }), complete login, then retry.'
        : 'Call ac.shell.navigate with view=workbench, wait for the page to load, then call ac.workbench.get_context.';
      const workbenchLoginRecoveryTool = {
        name: 'ac.shell.navigate',
        arguments: { view: 'workbench' },
        after: 'Wait for the user to finish login in the workbench view, then retry the failed workbench tool.',
      };
      const storedLastWorkbenchE2e =
        settings.mcpWorkbenchLastE2e && typeof settings.mcpWorkbenchLastE2e === 'object'
          ? settings.mcpWorkbenchLastE2e
          : null;
      const lastWorkbenchE2e = storedLastWorkbenchE2e || synthesizeWorkbenchE2eFromExecutions(executions, account);
      const mcpReady = Boolean(s.enabled && s.running && s.hasToken);
      const lastWorkbenchE2eFreshness = summarizeWorkbenchE2eFreshness(lastWorkbenchE2e);
      const codexRuntime = readCodexRuntimeStatus();
      const workbenchEntrance = summarizeWorkbenchEntrance({
        mcpReady,
        account,
        lastWorkbenchE2e,
        freshness: lastWorkbenchE2eFreshness,
      });
      const workbenchE2eAcceptance = summarizeWorkbenchE2eAcceptance({
        account,
        workbenchEntrance,
        lastWorkbenchE2e,
        freshness: lastWorkbenchE2eFreshness,
      });
      const workflowPublication = summarizeWorkflowPublicationReadiness(policy, tools);
      const workflowPromotionPreflightEvidence = summarizeWorkflowPromotionPreflightEvidence(executions);
      if (workflowPublication && typeof workflowPublication === 'object') {
        workflowPublication.promotionPreflightEvidence = workflowPromotionPreflightEvidence;
      }
      const blockers = summarizeReadinessBlockers({
        mcpReady,
        codexRuntime,
        account,
        workbenchEntrance,
        workflowPublication,
        usageAudit,
      });
      const teamEntranceReady = Boolean(
        mcpReady &&
          codexRuntime &&
          codexRuntime.readyHint &&
          workbenchEntrance &&
          workbenchEntrance.ready &&
          blockers.length === 0,
      );
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            ...s,
            tokenHint: s.hasToken ? 'configured' : 'missing',
            hasToken: Boolean(s.hasToken),
            shellView,
            toolCount: tools.length,
            riskCounts,
            policy: {
              confirmTools: Boolean(policy.confirmTools),
              autoConfirmToolCount: Array.isArray(policy.autoConfirmTools) ? policy.autoConfirmTools.length : 0,
              forbiddenToolCount: Array.isArray(policy.forbiddenTools) ? policy.forbiddenTools.length : 0,
            },
            recentToolExecutionCount: Array.isArray(executions) ? executions.length : 0,
            readiness: {
              mcp: mcpReady,
              workbenchUsable: Boolean(workbenchEntrance && workbenchEntrance.ready),
              teamEntranceReady,
              teamEntrancePhase: teamEntranceReady
                ? 'ready'
                : workbenchEntrance && workbenchEntrance.ready
                  ? 'governance_blocked'
                  : 'workbench_blocked',
              teamEntranceBlockers: blockers.map((blocker) => String(blocker && blocker.id ? blocker.id : 'unknown')),
              codexRuntime,
              usageAudit,
              workflowPublication,
              blockers,
              account,
              workbenchEntrance,
              workbenchE2eAcceptance,
              lastWorkbenchE2e,
              lastWorkbenchE2eFreshness,
              frontendAuthorizationAvailable: shellView !== 'unknown',
              workbenchLikelyVisible: workbenchVisible,
              workbenchOperation: workbenchVisible ? 'probe_context' : 'navigate_first',
              workbenchNextStep,
              inAppE2e: 'Open Companion Settings -> External Agent (MCP) -> 工作台验收 to run the same MCP workbench chain inside the product.',
              e2eCommand: 'npm run smoke:agent-mcp:e2e -- --config <hermes-mcp-import.json>',
              waitLoginE2eCommand: 'npm run smoke:agent-mcp:e2e:wait-login -- --config <hermes-mcp-import.json>',
              recoveryTools: {
                authRequired: workbenchLoginRecoveryTool,
              },
              recoveryContract: [
                'authRequired means the workbench browser session is not logged in; call recoveryTools.authRequired, complete login, then retry.',
                'requiresFrontendAuthorization means Copilot must stay open so the user can approve or deny the action.',
                'projectRequired means create/open a project before running capabilities.',
                'requiresInput means provide imageDataUrl, inputAssetId, or other required arguments from structuredContent.',
              ],
              note: workbenchNextStep,
            },
          },
          null,
          2,
        ),
      };
    }
    if (uri === 'assetcutter://mcp/usage-audit') {
      const summarize =
        typeof deps.summarizeUsageAudit === 'function'
          ? (days, limit) => deps.summarizeUsageAudit({ days, limit })
          : () => null;
      const current = summarize(1, 5000);
      const windows = {
        day1: current,
        day7: summarize(7, 10000),
        day30: summarize(30, 10000),
      };
      const cloudDraft =
        current && current.cloudDraft && typeof current.cloudDraft === 'object'
          ? current.cloudDraft
          : buildCopilotUsageCloudDraft(current);
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            northStar:
              'Copilot turns personal Agent execution into a governed team entrance by centralizing permission, usage, logs, and audit.',
            scope: {
              source: 'local_companion_audit_log',
              localStore: 'agent-store/audit/*.jsonl',
              includes: [
                'Codex/Copilot turns with token usage reported by the local brain adapter.',
                'By-brain and by-session local aggregates.',
                'Traceability references through assetcutter://mcp/tool-executions.',
              ],
              excludes: [
                'Cloud team quota enforcement.',
                'Cross-device consolidated billing.',
                'Raw prompts, secrets, MCP bearer tokens, cookie values, and tool arguments.',
              ],
            },
            readiness: {
              statusResource: 'assetcutter://mcp/server-status',
              statusField: 'readiness.usageAudit',
              toolExecutionsResource: 'assetcutter://mcp/tool-executions',
              workflowPublicationResource: 'assetcutter://mcp/workflow-publication',
              governanceTools: {
                probeQuotaPolicy: 'ac.usage.probe_quota_policy',
                uploadCloudDraft: 'ac.usage.upload_cloud_draft',
                dryRunArgs: { days: 1, limit: 5000, dryRun: true },
              },
              currentPhase: current && current.currentPhase ? String(current.currentPhase) : 'local_usage_signal',
              cloudEnforced: Boolean(current && current.cloudEnforced),
              cloudDraft,
              nextGovernanceStep:
                'Connect this local summary to the cloud team quota/audit API so admins can set budgets, enforce limits, and review cross-device usage.',
            },
            current,
            windows,
            cloudDraft,
            recommendedExternalAgentUse: [
              'Read this resource before long-running or expensive workflow automation.',
              'Use current.totals and windows.day7/day30 to estimate local Copilot load.',
              'Use byBrain and bySession to identify which Agent/runtime is consuming the most tokens.',
              'Use assetcutter://mcp/tool-executions for execution traceability, not for raw prompt recovery.',
              'Call ac.usage.probe_quota_policy before treating quotaPolicy as current.',
              'Call ac.usage.upload_cloud_draft with dryRun=true before requesting a confirm-risk real upload.',
              'Do not treat local usage as cloud billing or enforced quota until the team quota API is connected.',
            ],
          },
          null,
          2,
        ),
      };
    }
    if (uri === 'assetcutter://mcp/tool-executions') {
      const executions =
        typeof deps.listToolExecutions === 'function' ? deps.listToolExecutions({ days: 7, limit: 80 }) : [];
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            windowDays: 7,
            limit: 80,
            executions: Array.isArray(executions) ? executions : [],
            guidance: {
              correlate: 'Use toolCallId, traceId, and jsonRpcId to connect MCP responses with execution records.',
              privacy: 'Arguments are not stored here; argsDigest is a short hash for correlation only.',
            },
          },
          null,
          2,
        ),
      };
    }
    return null;
  }

  function skillToPrompt(skill) {
    return {
      name: `skill:${skill.id}`,
      description: skill.description || skill.name || skill.id,
      arguments: [],
      _meta: {
        assetcutter: {
          skillId: skill.id,
          title: skill.name || skill.id,
          toolHints: Array.isArray(skill.toolHints) ? skill.toolHints : [],
        },
      },
    };
  }

  function skillPromptId(promptName) {
    const raw = String(promptName || '').trim();
    return raw.startsWith('skill:') ? raw.slice('skill:'.length) : raw;
  }

  function toolToMcpTool(t) {
    const surfaces = Array.isArray(t.surfaces) ? t.surfaces.map(String) : [];
    const risk = String(t.risk || 'safe');
    const catalogTool = buildToolCatalog([t]).surfaces?.[0]?.tools?.[0] || {};
    return {
      name: t.name,
      title: catalogTool.title || t.title || t.name,
      description: t.description || t.name,
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      annotations: {
        destructiveHint: risk === 'confirm' || risk === 'forbidden',
        readOnlyHint: risk === 'safe',
        openWorldHint: surfaces.some((s) => s !== 'shell'),
      },
      _meta: {
        assetcutter: {
          risk,
          surfaces,
          deprecated: Boolean(t.deprecated),
          whenToUse: catalogTool.whenToUse || '',
          exampleArguments: catalogTool.exampleArguments || {},
          successSignals: Array.isArray(catalogTool.successSignals) ? catalogTool.successSignals : [],
        },
      },
    };
  }

  async function handleJsonRpc(body) {
    if (!isObject(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return jsonRpcError(body && body.id, -32600, 'Invalid Request');
    }

    const method = body.method;
    const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : undefined;
    const params = body?.params && typeof body.params === 'object' ? body.params : {};

    if (isNotification(body)) {
      if (method === 'notifications/cancelled') {
        const key = requestIdKey(params.requestId);
        const active = key ? activeRequests.get(key) : null;
        if (active && active.controller) {
          active.controller.abort(String(params.reason || 'cancelled'));
          deps.appendAudit({
            ts: new Date().toISOString(),
            clientId: 'mcp',
            sessionId: 'mcp',
            brainId: 'external',
            action: 'mcp_cancel_requested',
            jsonRpcId: params.requestId ?? null,
            reason: params.reason ? String(params.reason).slice(0, 240) : null,
          });
        }
        return undefined;
      }
      if (method === 'notifications/initialized' || method === 'initialized' || method.startsWith('notifications/')) {
        return undefined;
      }
    }

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          protocolVersion: negotiateProtocolVersion(params.protocolVersion),
            capabilities: {
              tools: { listChanged: true },
              resources: { listChanged: true, subscribe: true },
              prompts: { listChanged: true },
              completions: {},
              logging: {},
            },
          serverInfo: {
            name: MCP_SERVER_NAME,
            title: MCP_SERVER_TITLE,
            version: MCP_SERVER_VERSION,
            description: 'Local MCP body for AssetCutter workbench, Script Hub, companion runtime, skills, and memory.',
          },
          instructions: serverInstructions(),
        },
      };
    }

    if (method === 'tools/list') {
      const tools = await deps.bodyHost.listTools();
      const page = paginateList(tools.map(toolToMcpTool), params);
      const result = { tools: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'tools/call') {
      const name = String(params.name || '');
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const key = requestIdKey(id);
      const controller = new AbortController();
      if (key) activeRequests.set(key, { controller, method, startedAt: Date.now() });
      let result;
      try {
        result = await executeMcpTool(name, args, { jsonRpcId: id ?? null, signal: controller.signal });
      } finally {
        if (key) activeRequests.delete(key);
      }
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: mcpToolCallResult(result),
      };
    }

    if (method === 'skills/list' || method === 'ac/skills/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      const page = paginateList(skills, params);
      const result = { skills: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return { jsonrpc: '2.0', id: id ?? null, result };
    }

    if (method === 'prompts/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      const page = paginateList(skills.map(skillToPrompt), params);
      const result = { prompts: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'prompts/get') {
      const promptName = String(params.name || '');
      const skillId = skillPromptId(promptName);
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skill = readSkillById(root, skillId);
      if (!skill) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32002, message: `prompt not found: ${promptName}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          description: skill.description || skill.name || skill.id,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: skill.prompt || skill.description || skill.name || skill.id,
              },
            },
          ],
          _meta: {
            assetcutter: {
              skillId: skill.id,
              title: skill.name || skill.id,
              toolHints: Array.isArray(skill.toolHints) ? skill.toolHints : [],
            },
          },
        },
      };
    }

    if (method === 'resources/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      const resources = [
        ...builtInResources(),
        ...skills.map((s) => ({
          uri: `skill://${s.id}`,
          name: s.name,
          description: s.description || s.name,
          mimeType: 'application/json',
        })),
        ...skills.map((s) => ({
          uri: `skill://${s.id}/revisions`,
          name: `${s.name} Revisions`,
          description: `Revision history for ${s.name || s.id}`,
          mimeType: 'application/json',
        })),
        ...skillRevisionResources(root, skills),
      ];
      const page = paginateList(resources, params);
      const result = { resources: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'resources/templates/list') {
      const page = paginateList(resourceTemplates(), params);
      const result = { resourceTemplates: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'resources/subscribe') {
      const uri = String(params.uri || '').trim();
      if (!uri) return jsonRpcError(id ?? null, -32602, 'Invalid params', { reason: 'uri required' });
      if (!resourceUriExists(uri)) return jsonRpcError(id ?? null, -32002, `resource not found: ${uri}`);
      subscribedResources.set(uri, {
        uri,
        subscribedAt: new Date().toISOString(),
        jsonRpcId: id ?? null,
      });
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        action: 'mcp_resource_subscribed',
        uri,
        jsonRpcId: id ?? null,
      });
      return { jsonrpc: '2.0', id: id ?? null, result: {} };
    }

    if (method === 'resources/unsubscribe') {
      const uri = String(params.uri || '').trim();
      if (!uri) return jsonRpcError(id ?? null, -32602, 'Invalid params', { reason: 'uri required' });
      subscribedResources.delete(uri);
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        action: 'mcp_resource_unsubscribed',
        uri,
        jsonRpcId: id ?? null,
      });
      return { jsonrpc: '2.0', id: id ?? null, result: {} };
    }

    if (method === 'completion/complete') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: completeArgument(params),
      };
    }

    if (method === 'logging/setLevel') {
      const level = String(params.level || '').trim();
      if (!MCP_LOG_LEVELS.includes(level)) {
        return jsonRpcError(id ?? null, -32602, 'Invalid params', {
          reason: 'unsupported logging level',
          supportedLevels: MCP_LOG_LEVELS,
        });
      }
      loggingLevel = level;
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        action: 'mcp_logging_level_set',
        level,
      });
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {},
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      const builtIn = await readBuiltInResource(uri);
      if (builtIn) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: { contents: [builtIn] },
        };
      }
      const revisionMatch = uri.match(/^skill:\/\/(.+)\/revisions\/(\d+)$/);
      if (revisionMatch) {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const revisionRead = readSkillRevision(root, revisionMatch[1], revisionMatch[2]);
        if (!revisionRead.ok) {
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32002, message: `skill revision not found: ${revisionMatch[1]}#${revisionMatch[2]}` },
          };
        }
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            contents: [
              {
                uri: revisionRead.resourceUri,
                mimeType: 'application/json',
                text: JSON.stringify(revisionRead, null, 2),
              },
            ],
          },
        };
      }
      if (uri.startsWith('skill://') && uri.endsWith('/revisions')) {
        const revisionSkillId = uri.slice('skill://'.length, -'/revisions'.length);
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const revisions = listSkillRevisions(root, revisionSkillId);
        if (!revisions.ok) {
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32002, message: `skill revisions not found: ${revisionSkillId}` },
          };
        }
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            contents: [
              {
                uri: `skill://${revisions.skillId}/revisions`,
                mimeType: 'application/json',
                text: JSON.stringify(revisions, null, 2),
              },
            ],
          },
        };
      }
      const skillId = uri.startsWith('skill://') ? uri.slice('skill://'.length) : uri;
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skill = readSkillById(root, skillId);
      if (!skill) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32002, message: `skill not found: ${skillId}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          contents: [
            {
              uri: `skill://${skill.id}`,
              mimeType: 'application/json',
              text: JSON.stringify(skill, null, 2),
            },
          ],
        },
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id: id ?? null, result: {} };
    }

    if (isNotification(body)) return undefined;
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  async function handleJsonRpcEnvelope(body) {
    if (!Array.isArray(body)) return handleJsonRpc(body);
    if (body.length === 0) return jsonRpcError(null, -32600, 'Invalid Request');
    const responses = [];
    for (const item of body) {
      const out = await handleJsonRpc(item);
      if (out !== undefined) responses.push(out);
    }
    return responses.length ? responses : undefined;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function handleHttp(req, res) {
    const settings = deps.readSettings();
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Agent-Mcp-Token');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && (req.url === '/health' || req.url === '/mcp/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, enabled: Boolean(settings.mcpEnabled), port: runningPort }));
      return;
    }

    if (!settings.mcpEnabled) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mcp_disabled' }));
      return;
    }

    if (!authOk(req, settings)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized', code: 'AGENT_MCP_AUTH_REQUIRED' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    const pathOnly = String(req.url || '/').split('?')[0];
    if (pathOnly !== '/' && pathOnly !== '/mcp' && !pathOnly.endsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : null;
      const protocolVersion = responseProtocolVersion(req, body);
      const out = await handleJsonRpcEnvelope(body);
      if (out === undefined) {
        res.writeHead(202, { 'MCP-Protocol-Version': protocolVersion });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'MCP-Protocol-Version': protocolVersion });
      res.end(JSON.stringify(out));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: msg } }));
    }
  }

  async function stop() {
    if (!server) return { ok: true, running: false };
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    server = null;
    runningPort = null;
    log('stopped');
    return { ok: true, running: false };
  }

  async function start() {
    await stop();
    let settings = deps.readSettings();
    if (!settings.mcpEnabled) {
      return { ok: true, running: false, enabled: false };
    }
    settings = ensureMcpToken(settings);
    const port = Number.isFinite(Number(settings.mcpPort))
      ? Math.min(65535, Math.max(1024, Number(settings.mcpPort)))
      : DEFAULT_MCP_PORT;

    server = http.createServer((req, res) => {
      void handleHttp(req, res);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, MCP_BIND, () => resolve());
    });
    runningPort = port;
    log(`listening http://${MCP_BIND}:${port}/ (POST JSON-RPC)`);
    return {
      ok: true,
      running: true,
      enabled: true,
      port,
      bind: MCP_BIND,
      tokenHint: settings.mcpToken ? `${String(settings.mcpToken).slice(0, 8)}…` : null,
    };
  }

  async function syncFromSettings() {
    const settings = deps.readSettings();
    if (settings.mcpEnabled) return start();
    return stop();
  }

  function status() {
    const settings = deps.readSettings();
    return {
      enabled: Boolean(settings.mcpEnabled),
      running: Boolean(server && server.listening),
      port: runningPort || settings.mcpPort || DEFAULT_MCP_PORT,
      bind: MCP_BIND,
      hasToken: Boolean(settings.mcpToken),
      activeRequestCount: activeRequests.size,
      subscribedResourceCount: subscribedResources.size,
      subscribedResources: Array.from(subscribedResources.keys()).sort(),
      loggingLevel,
    };
  }

  function regenerateToken() {
    const token = randomBytes(24).toString('hex');
    deps.writeSettings({ mcpToken: token });
    return { ok: true, tokenPreview: `${token.slice(0, 8)}…` };
  }

  function requestJsonRpc(payload, timeoutMs) {
    const settings = deps.readSettings();
    const port = runningPort || settings.mcpPort || DEFAULT_MCP_PORT;
    const token = settings.mcpToken ? String(settings.mcpToken) : '';
    const raw = JSON.stringify(payload);
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: MCP_BIND,
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(raw),
            Authorization: `Bearer ${token}`,
          },
          timeout: Number(timeoutMs) || 5000,
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
              /* keep text */
            }
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json, text });
          });
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('mcp probe timeout'));
      });
      req.on('error', (e) => {
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
      req.end(raw);
    });
  }

  function toolStructured(call) {
    return (call && call.json && call.json.result && call.json.result.structuredContent) || {};
  }

  function toolErrorCode(call) {
    const result = (call && call.json && call.json.result) || {};
    const meta = (result._meta && result._meta.assetcutter) || {};
    const structured = result.structuredContent || {};
    return (
      (meta.error && meta.error.code) ||
      (structured.error && structured.error.code) ||
      meta.errorCode ||
      structured.errorCode ||
      ''
    );
  }

  function toolNextStep(call) {
    const result = (call && call.json && call.json.result) || {};
    const meta = (result._meta && result._meta.assetcutter) || {};
    const structured = result.structuredContent || {};
    return meta.nextStep || structured.nextStep || (result.content && result.content[0] && result.content[0].text) || '';
  }

  function toolRecoveryTool(call) {
    const result = (call && call.json && call.json.result) || {};
    const meta = (result._meta && result._meta.assetcutter) || {};
    const structured = result.structuredContent || {};
    return meta.recoveryTool || structured.recoveryTool || null;
  }

  function isWorkbenchLoginRecoveryTool(recoveryTool) {
    return Boolean(
      recoveryTool &&
        recoveryTool.name === 'ac.shell.navigate' &&
        recoveryTool.arguments &&
        recoveryTool.arguments.view === 'workbench',
    );
  }

  function delay(ms) {
    const n = Math.max(0, Number(ms) || 0);
    if (!n) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, n));
  }

  async function waitForAccountLoggedIn(timeoutMs) {
    const maxMs = Math.max(0, Number(timeoutMs) || 0);
    if (!maxMs || typeof deps.getStateSummary !== 'function') {
      if (maxMs > 0) await delay(maxMs);
      return { ok: false, waitedMs: maxMs, account: null, fallbackDelay: true };
    }
    const startedAt = Date.now();
    const deadline = startedAt + maxMs;
    let lastAccount = null;
    while (Date.now() <= deadline) {
      try {
        const state = await deps.getStateSummary();
        lastAccount = state && typeof state.account === 'object' ? state.account : null;
        if (lastAccount && lastAccount.loggedIn === true) {
          return { ok: true, waitedMs: Date.now() - startedAt, account: lastAccount };
        }
      } catch {
        /* keep polling until timeout */
      }
      if (Date.now() >= deadline) break;
      await delay(Math.min(2000, Math.max(250, deadline - Date.now())));
    }
    return { ok: false, waitedMs: Date.now() - startedAt, account: lastAccount };
  }

  function isToolSuccess(call) {
    return Boolean(call && call.ok && call.json && call.json.result && call.json.result.isError === false);
  }

  async function callMcpTool(name, args, id, timeoutMs) {
    return requestJsonRpc(
      { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } },
      timeoutMs || 60000,
    );
  }

  function chooseWorkbenchPreset(context) {
    const presets = Array.isArray(context && context.capabilityPresets) ? context.capabilityPresets : [];
    const direct = presets.filter((p) => p && p.directRunSupported === true && p.requiresImage !== true);
    const isLightTextPreset = (preset) => {
      const text = JSON.stringify({
        id: preset && preset.id,
        label: preset && preset.label,
        name: preset && preset.name,
        kind: preset && preset.kind,
        category: preset && preset.category,
        outputKind: preset && preset.outputKind,
        acceptsText: preset && preset.acceptsText,
      }).toLowerCase();
      if (/video|3d|image|photo|render|generate_video|generate_image|t2i|i2v|text[_-]?to[_-]?image/.test(text)) return false;
      return preset && (preset.acceptsText === true || /text|note|summary|summar|caption|verify|smoke/.test(text));
    };
    return (
      direct.find((p) => p && p.id === AGENT_WORKBENCH_SMOKE_PRESET_ID) ||
      direct.find(isLightTextPreset) ||
      direct.find((p) => p && p.acceptsText === true) ||
      direct[0] ||
      null
    );
  }

  function e2eFail(step, call, fallback) {
    const errorCode = toolErrorCode(call) || (call && call.statusCode) || 'AGENT_MCP_E2E_FAILED';
    const structured = toolStructured(call);
    const recoveryAttrs = {
      ...toolErrorAttributes(errorCode),
      ...structuredRecoveryAttributes(structured),
    };
    const action =
      errorCode === 'AGENT_AUTH_REQUIRED'
        ? 'open_workbench_login'
        : recoveryAttrs.requiresFrontendAuthorization
          ? 'approve_in_copilot'
          : recoveryAttrs.projectRequired
            ? 'create_or_open_project'
            : recoveryAttrs.retryable
              ? 'retry_after_recovery'
              : 'inspect_failure';
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      failedStep: step,
      errorCode,
      nextStep: toolNextStep(call) || fallback || '请检查 MCP、工作台登录状态和当前项目后重试。',
      ...recoveryAttrs,
      ...(errorCode === 'AGENT_AUTH_REQUIRED' ? { view: 'workbench' } : {}),
      action,
      response: call
        ? {
            ok: Boolean(call.ok),
            statusCode: call.statusCode || null,
            json: call.json || null,
            error: call.error || null,
          }
        : null,
    };
  }

  async function runWorkbenchE2eSelf(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const recoveryWaitMs = Math.max(0, Number(opts.recoveryWaitMs) || 0);
    const checkedAt = new Date().toISOString();
    const state = status();
    const settings = deps.readSettings();
    const endpoint = `http://${MCP_BIND}:${runningPort || settings.mcpPort || DEFAULT_MCP_PORT}/mcp`;
    if (!state.enabled) return { ok: false, endpoint, checkedAt, failedStep: 'mcp.enabled', errorCode: 'MCP_DISABLED', nextStep: '???? MCP ??????' };
    if (!state.running) return { ok: false, endpoint, checkedAt, failedStep: 'mcp.running', errorCode: 'MCP_NOT_RUNNING', nextStep: '?????????????? MCP ?????' };
    if (!settings.mcpToken) return { ok: false, endpoint, checkedAt, failedStep: 'mcp.token', errorCode: 'MCP_TOKEN_MISSING', nextStep: '????? MCP Token ????' };

    const steps = [];
    const toolsCall = await requestJsonRpc({ jsonrpc: '2.0', id: 'workbench-e2e-tools', method: 'tools/list', params: {} }, 10000);
    if (!toolsCall.ok || !toolsCall.json || toolsCall.json.error) {
      return e2eFail('tools/list', toolsCall, 'MCP ??????????????');
    }
    const tools = Array.isArray(toolsCall.json.result && toolsCall.json.result.tools) ? toolsCall.json.result.tools : [];
    const advertised = new Set(tools.map((t) => t && t.name).filter(Boolean));
    const requiredTools = WORKBENCH_E2E_REQUIRED_TOOLS;
    const missing = requiredTools.filter((name) => !advertised.has(name));
    if (missing.length) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'tools.required',
        errorCode: 'MCP_WORKBENCH_TOOLS_MISSING',
          nextStep: `????????${missing.join(', ')}?????????`,
        missingTools: missing,
      };
    }
    steps.push({ id: 'tools', ok: true, detail: `${tools.length} tools` });

    let readyCall = await callMcpTool(
      'ac.workbench.ensure_ready',
      { requireProject: false },
      'workbench-e2e-ensure-ready',
      30000,
    );
    if (!isToolSuccess(readyCall)) {
      const recoveryTool = toolRecoveryTool(readyCall);
      if (isWorkbenchLoginRecoveryTool(recoveryTool)) {
        const recoveryCall = await callMcpTool(
          recoveryTool.name,
          recoveryTool.arguments,
          'workbench-e2e-recovery-login',
          30000,
        );
        if (!isToolSuccess(recoveryCall)) {
          return e2eFail('ac.shell.navigate', recoveryCall, '??????????????');
        }
        steps.push({
          id: 'recovery_tool',
          ok: true,
          tool: recoveryTool.name,
          arguments: recoveryTool.arguments,
          waitMs: recoveryWaitMs,
        });
        if (recoveryWaitMs > 0) {
          const loginWait = await waitForAccountLoggedIn(recoveryWaitMs);
          steps.push({
            id: 'account_login_wait',
            ok: Boolean(loginWait.ok),
            waitedMs: loginWait.waitedMs,
            fallbackDelay: Boolean(loginWait.fallbackDelay),
            account: loginWait.account
              ? {
                  loggedIn: Boolean(loginWait.account.loggedIn),
                  partition: loginWait.account.partition || '',
                  cookieCount: Number(loginWait.account.cookieCount) || 0,
                  hasAuthCookie: Boolean(loginWait.account.hasAuthCookie),
                }
              : null,
          });
        }
        readyCall = await callMcpTool(
          'ac.workbench.ensure_ready',
          { requireProject: false },
          'workbench-e2e-ensure-ready-retry',
          30000,
        );
      }
      if (!isToolSuccess(readyCall)) {
        const failed = e2eFail('ac.workbench.ensure_ready', readyCall, '???????????????');
        failed.steps = steps;
        return failed;
      }
    }
    steps.push({ id: 'ensure_ready', ok: true });

    const contextCall = await callMcpTool('ac.workbench.get_context', {}, 'workbench-e2e-context', 30000);
    if (!isToolSuccess(contextCall)) {
      return e2eFail('ac.workbench.get_context', contextCall, '请确认工作台页面已加载完成。');
    }
    const context = toolStructured(contextCall);
    steps.push({
      id: 'get_context',
      ok: true,
      detail: `${(context.projects || []).length} projects / ${(context.capabilityPresets || []).length} presets`,
    });

    let projectId = String(context.activeProjectId || '').trim();
    if (!projectId) {
      const createCall = await callMcpTool(
        'ac.workbench.create_project',
        { name: `MCP ?? ${new Date().toISOString().replace(/[:.]/g, '-')}` },
        'workbench-e2e-create-project',
        30000,
      );
      if (!isToolSuccess(createCall)) {
        return e2eFail('ac.workbench.create_project', createCall, '???????????????');
      }
      const created = toolStructured(createCall);
      projectId = String(created.projectId || (created.project && created.project.id) || '').trim();
      if (!projectId) {
        return {
          ok: false,
          endpoint,
          checkedAt,
          failedStep: 'ac.workbench.create_project',
          errorCode: 'PROJECT_ID_MISSING',
          nextStep: '??????????? projectId???????????',
        };
      }
      steps.push({ id: 'create_project', ok: true, detail: projectId });
    } else {
      steps.push({ id: 'project', ok: true, detail: projectId });
    }

    const preset = chooseWorkbenchPreset(context);
    if (!preset) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'capability.preset',
        errorCode: 'DIRECT_RUN_PRESET_MISSING',
        nextStep: '??????????????????????????? directRunSupported ???',
      };
    }
    steps.push({ id: 'preset', ok: true, detail: preset.id });

    const runCall = await callMcpTool(
      'ac.workbench.run_capability',
      {
        projectId,
        presetId: preset.id,
        inputText: 'MCP ???????? AssetCutter ??????????????',
      },
      'workbench-e2e-run-capability',
      120000,
    );
    if (!isToolSuccess(runCall)) {
      return e2eFail('ac.workbench.run_capability', runCall, '???????????????????????????');
    }
    const run = toolStructured(runCall);
    const assetId = String(run.assetId || (run.output && run.output.assetId) || '').trim();
    if (!assetId || !run.resultKey) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'ac.workbench.run_capability',
        errorCode: 'RUN_OUTPUT_MISSING',
        nextStep: '??????????? assetId/resultKey???????????',
        run,
      };
    }
    steps.push({ id: 'run_capability', ok: true, detail: `${assetId} / ${run.resultKey}` });

    const listCall = await callMcpTool(
      'ac.workbench.list_assets',
      { projectId, limit: 20 },
      'workbench-e2e-list-assets',
      30000,
    );
    if (!isToolSuccess(listCall)) {
      return e2eFail('ac.workbench.list_assets', listCall, '?????????????');
    }
    const list = toolStructured(listCall);
    const assets = Array.isArray(list.assets) ? list.assets : [];
    if (!assets.some((asset) => asset && asset.id === assetId)) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'ac.workbench.list_assets',
        errorCode: 'CREATED_ASSET_NOT_LISTED',
        nextStep: '????????????????????????????',
        assetId,
      };
    }
    steps.push({ id: 'list_assets', ok: true, detail: `${assets.length} returned` });

    const getCall = await callMcpTool(
      'ac.workbench.get_asset',
      { projectId, assetId },
      'workbench-e2e-get-asset',
      30000,
    );
    if (!isToolSuccess(getCall)) {
      return e2eFail('ac.workbench.get_asset', getCall, '????????????');
    }
    const detail = toolStructured(getCall);
    if (!detail || (!detail.text && !detail.resultMeta && !detail.media)) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'ac.workbench.get_asset',
        errorCode: 'ASSET_DETAIL_EMPTY',
        nextStep: '?????????????????? get_asset ?????',
        assetId,
      };
    }
    steps.push({ id: 'get_asset', ok: true, detail: detail.displayKey || assetId });

    return {
      ok: true,
      endpoint,
      checkedAt,
      projectId,
      presetId: preset.id,
      assetId,
      resultKey: run.resultKey,
      steps,
      nextStep: 'MCP ????????????? Agent ??? ensure_ready -> run_capability -> list_assets -> get_asset ???',
    };
  }

  async function probeSelf() {
    const settings = deps.readSettings();
    const port = runningPort || settings.mcpPort || DEFAULT_MCP_PORT;
    const endpoint = `http://${MCP_BIND}:${port}/mcp`;
    const checkedAt = new Date().toISOString();
    const state = status();
    if (!state.enabled) {
      return { ok: false, endpoint, checkedAt, state, error: 'mcp_disabled' };
    }
    if (!state.running) {
      return { ok: false, endpoint, checkedAt, state, error: 'mcp_not_running' };
    }
    if (!settings.mcpToken) {
      return { ok: false, endpoint, checkedAt, state, error: 'mcp_token_missing' };
    }

    const init = await requestJsonRpc(
      { jsonrpc: '2.0', id: 'probe-init', method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      5000,
    );
    if (!init.ok || !init.json || init.json.error) {
      return { ok: false, endpoint, checkedAt, state, step: 'initialize', probe: init };
    }

    const tools = await requestJsonRpc({ jsonrpc: '2.0', id: 'probe-tools', method: 'tools/list', params: {} }, 5000);
    if (!tools.ok || !tools.json || tools.json.error) {
      return { ok: false, endpoint, checkedAt, state, step: 'tools/list', probe: tools };
    }

    const listedTools = Array.isArray(tools.json.result?.tools) ? tools.json.result.tools : [];
    return {
      ok: true,
      endpoint,
      checkedAt,
      state,
      protocolVersion: init.json.result?.protocolVersion || null,
      serverInfo: init.json.result?.serverInfo || null,
      toolCount: listedTools.length,
      toolsSample: listedTools.slice(0, 8).map((t) => t.name).filter(Boolean),
    };
  }

  function buildMcpClientConfig() {
    const settings = deps.readSettings();
    const port = runningPort || settings.mcpPort || DEFAULT_MCP_PORT;
    const token = settings.mcpToken ? String(settings.mcpToken) : '<token>';
    return {
      mcpServers: {
        'assetcutter-body': {
          url: `http://${MCP_BIND}:${port}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    };
  }

  return {
    start,
    stop,
    syncFromSettings,
    status,
    regenerateToken,
    probeSelf,
    runWorkbenchE2eSelf,
    summarizeWorkbenchEntranceState,
    summarizeWorkflowPublicationState,
    ensureMcpToken,
    buildMcpClientConfig,
    DEFAULT_MCP_PORT,
  };
}

module.exports = { createAgentBodyMcpServer, DEFAULT_MCP_PORT };
