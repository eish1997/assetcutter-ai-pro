import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultLocalAgentSettingsPath,
  loadConfig,
  loadLocalAgentSettings,
  resolveTarget,
  validateBlockerAction,
} from '../scripts/agent-mcp-smoke.mjs';

describe('agent MCP smoke script', () => {
  it('loads endpoint and bearer token from mcpServers config', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mcp-smoke-'));
    const file = path.join(tmp, 'mcp.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          'assetcutter-body': {
            url: 'http://127.0.0.1:19120/mcp',
            headers: { Authorization: 'Bearer test-token' },
          },
        },
      }),
    );

    expect(loadConfig(file)).toEqual({
      url: 'http://127.0.0.1:19120/mcp',
      token: 'test-token',
    });
    expect(resolveTarget({}, ['node', 'script', '--config', file])).toMatchObject({
      url: 'http://127.0.0.1:19120/mcp',
      token: 'test-token',
      source: 'config',
      workbenchE2e: false,
    });
  });

  it('lets environment override config values', () => {
    expect(
      resolveTarget(
        { AGENT_MCP_URL: 'http://127.0.0.1:19999/mcp', AGENT_MCP_TOKEN: 'env-token' },
        ['node', 'script'],
      ),
    ).toMatchObject({
      url: 'http://127.0.0.1:19999/mcp',
      token: 'env-token',
      source: 'env',
      workbenchE2e: false,
    });
  });

  it('falls back to the local companion agent settings when no config is supplied', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mcp-smoke-settings-'));
    const settingsPath = path.join(tmp, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        mcpEnabled: true,
        mcpPort: 19124,
        mcpToken: 'local-settings-token',
      }),
    );

    expect(loadLocalAgentSettings({ AGENT_MCP_SETTINGS: settingsPath })).toMatchObject({
      url: 'http://127.0.0.1:19124/mcp',
      token: 'local-settings-token',
      enabled: true,
      settingsPath,
    });
    expect(resolveTarget({ AGENT_MCP_SETTINGS: settingsPath }, ['node', 'script'])).toMatchObject({
      url: 'http://127.0.0.1:19124/mcp',
      token: 'local-settings-token',
      source: 'local-settings',
      statusOnly: false,
    });
  });

  it('resolves the default local companion settings path from sandbox root or LOCALAPPDATA', () => {
    expect(defaultLocalAgentSettingsPath({ AC_COMPANION_SANDBOX_ROOT: 'C:\\ac-sandbox' })).toContain(
      path.join('C:\\ac-sandbox', 'agent-store', 'settings.json'),
    );
    expect(defaultLocalAgentSettingsPath({ LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' })).toContain(
      path.join('C:\\Users\\Test\\AppData\\Local', 'AssetCutterCompanion', 'sandbox', 'agent-store', 'settings.json'),
    );
  });

  it('enables optional authenticated workbench e2e checks from env or args', () => {
    expect(
      resolveTarget(
        {
          AGENT_MCP_WORKBENCH_E2E: '1',
          AGENT_MCP_WORKBENCH_PRESET_ID: 'text_writer',
          AGENT_MCP_WORKBENCH_PROJECT_NAME: 'Smoke Project',
          AGENT_MCP_WORKBENCH_RECOVERY_WAIT_MS: '1500',
        },
        ['node', 'script'],
      ),
    ).toMatchObject({
      workbenchE2e: true,
      workbenchPresetId: 'text_writer',
      workbenchProjectName: 'Smoke Project',
      workbenchRecoveryWaitMs: 1500,
    });
    expect(
      resolveTarget(
        {},
        ['node', 'script', '--workbench-e2e', '--workbench-preset-id', 'demo', '--workbench-recovery-wait-ms', '2500'],
      ),
    ).toMatchObject({
      workbenchE2e: true,
      workbenchPresetId: 'demo',
      workbenchRecoveryWaitMs: 2500,
    });
  });

  it('supports a lightweight status-only entrance check', () => {
    expect(resolveTarget({ AGENT_MCP_STATUS: '1' }, ['node', 'script'])).toMatchObject({
      statusOnly: true,
      statusJson: false,
    });
    expect(resolveTarget({}, ['node', 'script', '--status'])).toMatchObject({
      statusOnly: true,
      statusJson: false,
    });
    expect(resolveTarget({ AGENT_MCP_STATUS_JSON: '1' }, ['node', 'script'])).toMatchObject({
      statusOnly: true,
      statusJson: true,
    });
    expect(resolveTarget({}, ['node', 'script', '--status-json'])).toMatchObject({
      statusOnly: true,
      statusJson: true,
    });
    expect(resolveTarget({ AGENT_MCP_OPEN_LOGIN: '1' }, ['node', 'script'])).toMatchObject({
      openLogin: true,
    });
    expect(resolveTarget({}, ['node', 'script', '--open-login'])).toMatchObject({
      openLogin: true,
    });
    expect(
      resolveTarget({}, ['node', 'script', '--open-login', '--workbench-e2e', '--workbench-recovery-wait-ms', '120000']),
    ).toMatchObject({
      openLogin: true,
      workbenchE2e: true,
      workbenchRecoveryWaitMs: 120000,
    });
  });

  it('validates blocker action risk, owner, command, and MCP tool references', () => {
    const toolNames = new Set(['ac.usage.probe_quota_policy']);
    expect(
      validateBlockerAction(
        {
          id: 'probe_quota_policy',
          label: 'Probe team quota policy',
          command: '',
          tool: 'ac.usage.probe_quota_policy',
          args: {},
          owner: 'admin',
          risk: 'safe',
        },
        toolNames,
      ),
    ).toMatchObject({ ok: true });
    expect(
      validateBlockerAction(
        {
          id: 'promote_workbench_preset_preflight',
          label: 'Preflight a Workbench preset promotion',
          command: '',
          tool: 'ac.workflow.promote_workbench_preset',
          args: { skillId: '<workflow-draft-skill-id>', requireAdminConfirmation: true },
          requiredInputs: [
            {
              name: 'skillId',
              label: 'Workflow draft skill id',
              source: 'settings.workflowPromotionSkillId',
            },
          ],
          owner: 'admin',
          risk: 'confirm-risk',
        },
        new Set(['ac.workflow.promote_workbench_preset']),
      ),
    ).toMatchObject({ ok: true });
    expect(
      validateBlockerAction({
        id: 'wait_login_e2e',
        label: 'Validate after Workbench login',
        command: 'npm run smoke:agent-mcp:e2e:wait-login',
        tool: '',
        args: null,
        owner: 'user',
        risk: 'safe',
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateBlockerAction({
        id: 'bad_risk',
        label: 'Bad risk',
        command: 'npm run smoke:agent-mcp:status',
        owner: 'admin',
        risk: 'confirm',
      }),
    ).toMatchObject({ ok: false, reason: 'bad_risk:unknown_risk=confirm' });
    expect(
      validateBlockerAction({
        id: 'bad_owner',
        label: 'Bad owner',
        command: 'npm run smoke:agent-mcp:status',
        owner: 'operator',
        risk: 'safe',
      }),
    ).toMatchObject({ ok: false, reason: 'bad_owner:unknown_owner=operator' });
    expect(
      validateBlockerAction(
        {
          id: 'missing_tool',
          label: 'Missing tool',
          tool: 'ac.missing.tool',
          owner: 'admin',
          risk: 'confirm-risk',
        },
        toolNames,
      ),
    ).toMatchObject({ ok: false, reason: 'missing_tool:unknown_tool=ac.missing.tool' });
    expect(
      validateBlockerAction({
        id: 'unknown_command',
        label: 'Unknown command',
        command: 'npm run not-real',
        owner: 'admin',
        risk: 'safe',
      }),
    ).toMatchObject({ ok: false, reason: 'unknown_command:unknown_command=npm run not-real' });
    expect(
      validateBlockerAction(
        {
          id: 'bad_required_input',
          label: 'Bad required input',
          tool: 'ac.usage.probe_quota_policy',
          owner: 'admin',
          risk: 'safe',
          requiredInputs: [{ name: 'skillId', source: 'settings.workflowPromotionSkillId' }],
        },
        toolNames,
      ),
    ).toMatchObject({ ok: false, reason: 'bad_required_input:required_input_missing_label' });
  });

  it('covers product-grade MCP compatibility checks', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'agent-mcp-smoke.mjs'), 'utf8');
    expect(script).toContain('logging/setLevel');
    expect(script).toContain('resources/subscribe');
    expect(script).toContain('resources/unsubscribe');
    expect(script).toContain('assetcutter://mcp/tool-executions');
    expect(script).toContain('assetcutter://mcp/workbench-flow');
    expect(script).toContain('resource.workbench-flow.read');
    expect(script).toContain('resource.workbench-flow.account_gate');
    expect(script).toContain('readiness.account.loggedIn');
    expect(script).toContain('resource.manifest.recovery');
    expect(script).toContain('loginRecoveryTool');
    expect(script).toContain('ac.workbench.ensure_ready');
    expect(script).toContain('ac.workbench.get_context');
    expect(script).toContain('ac.workbench.run_capability.schema');
    expect(script).toContain('imageDataUrl');
    expect(script).toContain('directRunSupported');
    expect(script).toContain('recoverable:');
    expect(script).toContain('tool.ac.workbench.get_context.timeout_recovery');
    expect(script).toContain('workbench-context-timeout-recovery');
    expect(script).toContain('recoveryTool');
    expect(script).toContain('isWorkbenchLoginRecoveryTool');
    expect(script).toContain('ac.shell.navigate');
    expect(script).toContain('workbench.e2e.recovery_tool');
    expect(script).toContain('workbench.e2e.recovery_wait');
    expect(script).toContain('waitForWorkbenchLoginReadiness');
    expect(script).toContain('formatAccountDiagnostics');
    expect(script).toContain('timeout=${target.workbenchRecoveryWaitMs}ms ${formatAccountDiagnostics(account)}');
    expect(script).toContain('assetcutter://mcp/server-status');
    expect(script).toContain('workbench-e2e-login-status');
    expect(script).toContain('waited=${loginWait.waitedMs}ms ${formatAccountDiagnostics(account)}');
    expect(script).toContain('workbench-e2e-recovery-login');
    expect(script).toContain('--workbench-recovery-wait-ms');
    expect(script).toContain('--workbench-e2e');
    expect(script).toContain('workbenchAuthDiagnostics');
    expect(script).toContain('retry=npm run smoke:agent-mcp:e2e');
    expect(script).toContain('smoke:agent-mcp:e2e:wait-login');
    expect(script).toContain('authCookie=missing');
    expect(script).toContain('tool.ac.shell.get_state.account');
    expect(script).toContain('shellAccountReadiness');
    expect(script).toContain('shellAccountReadiness.loggedIn === false');
    expect(script).toContain('resource.server-status.account');
    expect(script).toContain('resource.server-status.codex_runtime');
    expect(script).toContain('codexRuntime');
    expect(script).toContain('resource.server-status.last_workbench_e2e');
    expect(script).toContain('resource.server-status.last_workbench_e2e_freshness');
    expect(script).toContain('resource.server-status.workbench_entrance');
    expect(script).toContain('resource.server-status.usage_audit');
    expect(script).toContain('resource.server-status.usage_governance_evidence');
    expect(script).toContain('resource.server-status.workflow_publication');
    expect(script).toContain('resource.server-status.workflow_promotion_preflight_evidence');
    expect(script).toContain('resource.server-status.blockers');
    expect(script).toContain('isBlockerAction');
    expect(script).toContain('blockerActionContractOk');
    expect(script).toContain('workflowReady');
    expect(script).toContain('teamEntranceReady');
    expect(script).toContain('readiness.usageAudit');
    expect(script).toContain('readiness.workflowPublication');
    expect(script).toContain('readiness.blockers');
    expect(script).toContain('resource.usage-audit.listed');
    expect(script).toContain('resource.usage-audit.read');
    expect(script).toContain('assetcutter://mcp/usage-audit');
    expect(script).toContain('local_usage_signal');
    expect(script).toContain('cloud_event_draft');
    expect(script).toContain('/api/usage/events');
    expect(script).toContain('resource.workflow-publication.read');
    expect(script).toContain('assetcutter://mcp/workflow-publication');
    expect(script).toContain('promotionReadiness');
    expect(script).toContain('draft_only');
    expect(script).toContain('ac.workflow.promote_workbench_preset');
    expect(script).toContain('tool.ac.workflow.promote_workbench_preset.schema');
    expect(script).toContain('tool.ac.workflow.promote_script_hub_tool.schema');
    expect(script).toContain('tool.ac.usage.upload_cloud_draft.schema');
    expect(script).toContain('tool.ac.usage.upload_cloud_draft.dry_run');
    expect(script).toContain('tool.ac.usage.probe_quota_policy.schema');
    expect(script).toContain('tool.ac.usage.probe_quota_policy.call');
    expect(script).toContain('ac.usage.upload_cloud_draft');
    expect(script).toContain('ac.usage.probe_quota_policy');
    expect(script).toContain('usage-quota-policy-probe');
    expect(script).toContain('usage-upload-dry-run');
    expect(script).toContain("details.endpoint === '/api/usage/policy'");
    expect(script).toContain("details.endpoint === '/api/usage/events'");
    expect(script).toContain("errorCode === 'AGENT_CONFIRM_REQUIRED'");
    expect(script).toContain('confirm-risk promotion preflight');
    expect(script).toContain('runWorkflowDraftLifecycleSmoke');
    expect(script).toContain('workflow-draft.save');
    expect(script).toContain('workflow-draft.promote_workbench_preflight');
    expect(script).toContain('workflow-draft.promote_script_hub_preflight');
    expect(script).toContain('AGENT_WORKFLOW_PROMOTION_NOT_READY');
    expect(script).toContain('missingGates');
    expect(script).toContain('unevaluatedGates');
    expect(script).toContain('workflow-draft.delete');
    expect(script).toContain('policy requires confirmation');
    expect(script).toContain('policyDecisionForTool');
    expect(script).toContain('workbenchEntrance');
    expect(script).toContain('workbenchE2eAcceptance');
    expect(script).toContain('resource.server-status.workbench_e2e_acceptance');
    expect(script).toContain('settings.mcpWorkbenchLastE2e');
    expect(script).toContain('printStatusSummary');
    expect(script).toContain('openWorkbenchLoginAndPrintStatus');
    expect(script).toContain('if (!target.workbenchE2e)');
    expect(script).toContain('open-workbench-login');
    expect(script).toContain('[agent-mcp-login] target:');
    expect(script).toContain('[agent-mcp-status] target:');
    expect(script).toContain('statusJson');
    expect(script).toContain('AGENT_MCP_STATUS_JSON');
    expect(script).toContain('WORKBENCH_STATUS_COMMAND');
    expect(script).toContain('WORKBENCH_OPEN_LOGIN_WAIT_COMMAND');
    expect(script).toContain('openLoginWaitCommand');
    expect(script).toContain('statusCommand');
    expect(script).toContain('authPresent');
    expect(script).toContain('e2eFreshness');
    expect(script).toContain('requiredChain');
    expect(script).toContain('freshInputTokens');
    expect(script).toContain('cachedInputTokens');
    expect(script).toContain('freshInputTokens + cachedInputTokens');
    expect(script).toContain('codex: readyHint=');
    expect(script).toContain('workbench: status=');
    expect(script).toContain('workbenchAcceptance: passed=');
    expect(script).toContain('teamEntrance: ready=');
    expect(script).toContain('teamEntranceReady');
    expect(script).toContain('teamEntrancePhase');
    expect(script).toContain('teamEntranceBlockers');
    expect(script).toContain('workbenchUsable');
    expect(script).toContain('account: ${formatAccountDiagnostics(account)}');
    expect(script).toContain('authCookie=');
    expect(script).toContain('accountDiag: authOrigin=');
    expect(script).toContain('siteOrigin=');
    expect(script).toContain('statusCode');
    expect(script).toContain('usage: phase=${usage.currentPhase');
    expect(script).toContain('cloudEnforced=${Boolean(usage.cloudEnforced)}');
    expect(script).toContain('cloudEnforced: Boolean(usage.cloudEnforced)');
    expect(script).toContain('cloudDraft:');
    expect(script).toContain('usageUpload:');
    expect(script).toContain('tool=${usageUploadPlan.tool');
    expect(script).toContain('usageQuota:');
    expect(script).toContain('usageEvidence: action=');
    expect(script).toContain('exitReady=');
    expect(script).toContain('remaining=${remaining.join');
    expect(script).toContain('probe=${usageQuotaPolicy.probeTool');
    expect(script).toContain('governanceEvidence');
    expect(script).toContain('uploadPlan');
    expect(script).toContain('quotaPolicy');
    expect(script).toContain('policyEndpoint');
    expect(script).toContain('billingSkuRegisteredInDefaultCatalog');
    expect(script).toContain('credentials=');
    expect(script).toContain('privacyExcludes');
    expect(script).toContain('assetcutter://mcp/usage-audit');
    expect(script).toContain('readiness.blockers[].actions');
    expect(script).toContain('governanceTools');
    expect(script).toContain('probeQuotaPolicy');
    expect(script).toContain('byBrain: compactUsageRows');
    expect(script).toContain('workflow: status=');
    expect(script).toContain('promotion: phase=');
    expect(script).toContain('publishableNow');
    expect(script).toContain('promotionTargets:');
    expect(script).toContain('requiredGates');
    expect(script).toContain('passedGates');
    expect(script).toContain('missingGates');
    expect(script).toContain('missing=${missing.join');
    expect(script).toContain('promotionPassed:');
    expect(script).toContain('promotionUnevaluated:');
    expect(script).toContain('promotionAdmin:');
    expect(script).toContain('preflightEvidence');
    expect(script).toContain('promotionPreflight: target=');
    expect(script).toContain('skillExists=');
    expect(script).toContain('current=${Boolean(latestPreflight.evidenceCurrent)}');
    expect(script).toContain('stale=${latestPreflight.staleReason}');
    expect(script).toContain('adminConfirmation');
    expect(script).toContain('autoConfirmCountsAsAdminApproval');
    expect(script).toContain('blocker.workbench_login.actions=');
    expect(script).toContain('blocker.workflow_promotion.missing=');
    expect(script).toContain('blocker.workflow_promotion.actions=');
    expect(script).toContain('blocker.workflow_promotion.inputs=');
    expect(script).toContain('summarizeActionRequiredInputs');
    expect(script).toContain('blocker.workflow_promotion.passed=');
    expect(script).toContain('usage_governance_local_only');
    expect(script).toContain('blocker.usage_governance.phase=');
    expect(script).toContain('blocker.usage_governance.missing=');
    expect(script).toContain('blocker.usage_governance.actions=');
    expect(script).toContain('blocker.actions');
    expect(script).toContain('blocker.promotionTargets');
    expect(script).toContain('blockers:');
    expect(script).toContain('recovery: openLoginWait=');
    expect(script).toContain('--status');
    expect(script).toContain('--status-json');
    expect(script).toContain('--open-login');
    expect(script).toContain('lastWorkbenchE2eFreshness');
    expect(script).toContain('lastWorkbenchE2e');
    expect(script).toContain('persist:assetcutter-team');
    expect(script).toContain('30000');
    expect(script).toContain('ac.workbench.ensure_ready');
    expect(script).toContain('workbench.e2e.ensure_ready');
    expect(script).toContain('workbench.e2e.run_capability');
    expect(script).toContain('workbench.e2e.get_asset');
    expect(script).toContain('agent_workbench_smoke_text_note');
  });

  it('exposes a team-friendly wait-login workbench e2e npm script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['smoke:agent-mcp:status']).toBe('node scripts/agent-mcp-smoke.mjs --status');
    expect(pkg.scripts['smoke:agent-mcp:status:json']).toBe('node scripts/agent-mcp-smoke.mjs --status-json');
    expect(pkg.scripts['smoke:agent-mcp:open-login']).toBe('node scripts/agent-mcp-smoke.mjs --open-login');
    expect(pkg.scripts['smoke:agent-mcp:e2e:wait-login']).toBe(
      'node scripts/agent-mcp-smoke.mjs --workbench-e2e --workbench-recovery-wait-ms 120000',
    );
    expect(pkg.scripts['smoke:agent-mcp:e2e:open-login-wait']).toBe(
      'node scripts/agent-mcp-smoke.mjs --open-login --workbench-e2e --workbench-recovery-wait-ms 120000',
    );
  });
});
