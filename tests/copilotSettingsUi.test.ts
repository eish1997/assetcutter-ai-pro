import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const shellIndexPath = path.resolve(process.cwd(), 'companion-desktop/shell/index.html');
const shellMainPath = path.resolve(process.cwd(), 'companion-desktop/main.cjs');
const shellPreloadPath = path.resolve(process.cwd(), 'companion-desktop/preload-shell.cjs');
const copilotPanelPath = path.resolve(process.cwd(), 'companion-desktop/shell/copilot-panel.js');
const scriptHubClientPath = path.resolve(process.cwd(), 'companion-desktop/agent-script-hub-client.cjs');

describe('copilot settings UI', () => {
  it('keeps the shell page scripts parseable after wiring product entrances', () => {
    const html = fs.readFileSync(shellIndexPath, 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);

    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
    expect(() => new Function(fs.readFileSync(copilotPanelPath, 'utf8'))).not.toThrow();
  });

  it('keeps visible shell and Copilot UI text free of mojibake markers', () => {
    const checkedFiles = [shellIndexPath, copilotPanelPath];
    const mojibakePatterns = [
      /[\uFFFD]/,
      /(?:\?){4,}/,
      /[\u93bc\u93bb\u95c1\u6d93\u9420\u95ca\u93b4\u7480]/,
      /[\u5a34\u6fee\u6fec\u6fe1\u9428\u95b3]/,
      /[\u9396\u934f\u93c8\u9422\u6957\u6faa]/,
      /鎷掔粷/,
    ];

    for (const filePath of checkedFiles) {
      const text = fs.readFileSync(filePath, 'utf8');
      const matches = mojibakePatterns.flatMap((pattern) => {
        const match = text.match(pattern);
        return match ? [`${pattern}@${match.index ?? 0}`] : [];
      }).slice(0, 8);
      expect(matches, `${path.relative(process.cwd(), filePath)} mojibake markers`).toEqual([]);
    }
  });

  it('denoise casual Copilot chat: Chinese confirm, no composer task-thread, no tool-call bubbles', () => {
    const panel = fs.readFileSync(copilotPanelPath, 'utf8').replace(/\r\n/g, '\n');

    expect(panel).toContain("rejectBtn.textContent = '\\u62d2\\u7edd'");
    expect(panel).toContain("approveBtn.textContent = '\\u5141\\u8bb8'");
    expect(panel).not.toContain('鎷掔粷');
    expect(panel).not.toContain("appendTaskThreadCard(text, { source: 'composer' })");
    expect(panel).toContain("appendTaskThreadCard(text, { source: 'quick_task' })");
    expect(panel).toContain('const phrases = EXAMPLE_PHRASES.slice()');
    expect(panel).not.toContain("appendBubble('tool', '> '");
    expect(panel).not.toContain("appendBubble('tool', 'done '");
    expect(panel).toContain('shouldMuteActivityInChat');
    expect(panel).toContain('noteActivityProgress');
    expect(panel).toContain('formatCopilotAssistantText');
    expect(panel).toContain('if (activeTaskThreadEls)');
    expect(panel).toContain('function dismissPendingConfirmCards');
    expect(panel).toContain('if (card.parentNode) card.parentNode.removeChild(card)');
    expect(panel).not.toContain("status.textContent = 'Handled'");
  });

  it('exposes Copilot clear-history entrance through panel, preload, and main IPC', () => {
    const panel = fs.readFileSync(copilotPanelPath, 'utf8').replace(/\r\n/g, '\n');
    const html = fs.readFileSync(shellIndexPath, 'utf8').replace(/\r\n/g, '\n');
    const preload = fs.readFileSync(shellPreloadPath, 'utf8').replace(/\r\n/g, '\n');
    const main = fs.readFileSync(shellMainPath, 'utf8').replace(/\r\n/g, '\n');

    expect(html).toContain('id="copilot-clear-history"');
    expect(html).toContain('copilot-head-actions');
    expect(panel).toContain('clearCopilotHistory');
    expect(panel).toContain('agent.clearHistory');
    expect(preload).toContain("clearHistory: (sessionId) => timedInvoke('agent-session-clear-history'");
    expect(main).toContain("ipcMain.handle('agent-session-clear-history'");
    expect(main).toContain('agentSessionService.clearHistory');
  });

  it('keeps assistant bubbles pre-wrap and mutes routine Codex activity cards', () => {
    const panel = fs.readFileSync(copilotPanelPath, 'utf8').replace(/\r\n/g, '\n');
    const html = fs.readFileSync(shellIndexPath, 'utf8').replace(/\r\n/g, '\n');

    expect(panel).toContain("return ev.phase === 'start' || ev.phase === 'done'");
    expect(panel).toContain('if (!shouldMuteActivityInChat(ev))');
    expect(panel).toContain("setBubbleText(bubble, 'assistant', streamingText)");
    expect(html).toContain('#shell-copilot .copilot-msg');
    expect(html).toMatch(/#shell-copilot \.copilot-msg \{[\s\S]*?white-space:\s*pre-wrap\s*!important/);
  });

  it('uses Workbench as the first shell entry and moves home diagnostics into categorized settings', () => {
    const html = fs.readFileSync(shellIndexPath, 'utf8').replace(/\r\n/g, '\n');
    const main = fs.readFileSync(shellMainPath, 'utf8').replace(/\r\n/g, '\n');

    expect(html).not.toContain('id="view-home"');
    expect(html).not.toContain('data-view="home"');
    expect(html).toContain('data-view="workbench" class="active"');
    expect(html).toMatch(/<\/main>\s*<\/div>\s*<\/div>\s*<\/div>\s*<aside class="shell-copilot"/);
    expect(html).toContain('class="settings-section-nav"');
    expect(html).toContain('data-settings-section="overview"');
    expect(html).toContain('data-settings-section="entrances"');
    expect(html).toContain('data-settings-section="account"');
    expect(html).toContain('data-settings-section="agent"');
    expect(html).toContain('data-settings-section="storage"');
    expect(html).toContain('data-settings-section="service"');
    expect(html).toContain('data-settings-section-panel="overview"');
    expect(html).toContain('data-settings-section-panel="agent"');
    expect(html).toContain('function showSettingsSection');
    expect(html).toContain("showSettingsSection(activeSettingsSection, { preserveScroll: true })");
    expect(html).toContain("showSettingsSection(link.getAttribute('data-settings-section'))");
    expect(html).toContain('class="settings-group settings-overview is-active"');
    expect(html).toContain('.settings-content {\n      min-height: 0;\n      padding: 16px 18px 22px;\n      overflow: auto;\n      display: flex;');
    expect(html).toContain('max-width: 820px;');
    expect(html).toContain('.settings-group.is-active {\n      display: flex;\n      flex-direction: column;');
    expect(html).not.toContain('grid-template-columns: repeat(2, minmax(280px, 1fr));');
    expect(html).not.toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(html).toContain('id="settings-overview"');
    expect(html).toContain('id="settings-entrances"');
    expect(html).toContain('id="settings-account"');
    expect(html).toContain('id="settings-agent"');
    expect(html).toContain('id="settings-storage"');
    expect(html).toContain('id="settings-service"');
    expect(html).toContain('id="statusLabel"');
    expect(html).toContain('id="pluginRows"');
    expect(html).toContain("await applyShellView('workbench')");
    expect(html).not.toContain('views.home');

    expect(main).toContain("let shellMainProcessActiveView = 'workbench'");
    expect(main).not.toContain("shellMainProcessActiveView = 'home'");
    expect(main).not.toContain("view === 'home'");
  });

  it('skins the shell Copilot composer after the Workbench global input', () => {
    const html = fs.readFileSync(shellIndexPath, 'utf8');

    expect(html).toContain('copilot-workbench-composer-skin');
    expect(html).toContain('#shell-copilot .copilot-input-row');
    expect(html).toContain('min-height: 104px !important');
    expect(html).toContain('border-radius: 12px !important');
    expect(html).toContain('background: #0f0f12 !important');
    expect(html).toContain('#shell-copilot .copilot-send');
    expect(html).toContain('border-radius: 999px !important');
    expect(html).toContain('background: #fff !important');
  });

  it('exposes Codex runtime settings in the Agent settings panel', () => {
    const html = fs.readFileSync(shellIndexPath, 'utf8');

    expect(html).toContain('id="inpCodexCommand"');
    expect(html).toContain('id="inpCodexCwd"');
    expect(html).toContain('id="inpCodexModel"');
    expect(html).toContain('id="codexSandboxPicker"');
    expect(html).toContain('id="codexRuntimeStatusDetail"');
    expect(html).toContain('id="btnProbeCodexRuntime"');
    expect(html).toMatch(
      /<div class="agent-mcp-title">[\s\S]*?<span id="agentMcpProbeTitle">[\s\S]*?<\/span>\s*<\/div>\s*<span class="agent-mcp-endpoint" id="agentMcpEndpoint">/,
    );
    expect(html).toMatch(
      /<div class="agent-mcp-tools" id="agentWorkflowPromotionCard">[\s\S]*?<div class="agent-mcp-tools-head">[\s\S]*?<span class="agent-mcp-endpoint">Copilot UI approval<\/span>\s*<\/div>[\s\S]*?<div class="agent-mcp-detail" id="agentWorkflowPromotionDetail"/,
    );
    expect(html).toMatch(
      /<span class="agent-mcp-tools-summary" id="agentMcpToolsSummary">0 tools<\/span>\s*<\/div>\s*<div class="agent-mcp-tool-groups" id="agentMcpToolGroups">/,
    );
    expect(html).toMatch(
      /<span class="agent-policy-summary" id="agentPolicySummary">[\s\S]*?<\/span>\s*<\/div>\s*<label class="agent-policy-toggle">/,
    );
    expect(html).toContain('agentPolicyTemplates');
    expect(html).toContain('renderAgentPolicyTemplates');
    expect(html).toContain('templateId: id');
    expect(html.replace(/\r\n/g, '\n')).toContain('display: flex;\n      flex-direction: column;\n      gap: 8px;');
    expect(html).toContain('renderCodexRuntimeStatus');
    expect(html).toContain('codexRuntimeStatusCache');
    expect(html).toContain('agent.probeAllBrains');
    expect(html).toContain("codexCommand: $('inpCodexCommand')");
    expect(html).toContain("codexCwd: $('inpCodexCwd')");
    expect(html).toContain("codexModel: $('inpCodexModel')");
    expect(html).toContain("codexSandbox: agentSettingsCache.codexSandbox");
    const main = fs.readFileSync(shellMainPath, 'utf8');
    expect(main).toContain('buildCodexRuntimeStatus');
    expect(main).toContain('codexRuntime: buildCodexRuntimeStatus');
    expect(main).toContain('cwdExists');
    expect(main).toContain('readyHint');
  });

  it('renders the workbench e2e status as the Copilot entrance chain', () => {
    const html = fs.readFileSync(shellIndexPath, 'utf8');

    expect(html).toContain('外部 Agent（已改 CLI）');
    expect(html).toContain('npm run agent:init');
    expect(html).toContain('npm run agent:cli');
  });

  it('shows workbench login diagnostics in the e2e entrance state', () => {
    const html = fs.readFileSync(shellIndexPath, 'utf8');
    const main = fs.readFileSync(shellMainPath, 'utf8');
    const preload = fs.readFileSync(shellPreloadPath, 'utf8');

    expect(html).toContain('formatAgentMcpE2eAuthDiagnostics');
    expect(html).toContain('formatShellAccountDiagnosticLine');
    expect(html).toContain('Account: ${formatShellAccountDiagnosticLine(account)}');
    expect(html).toContain('Waiting for Workbench sign-in: ${remaining}s remaining');
    expect(html).toContain('agent-mcp-e2e-diag');
    expect(html).toContain('formatAgentMcpE2eFreshness');
    expect(html).toContain('agent-mcp-e2e-freshness');
    expect(html).toContain('id="agentMcpWorkbenchEntranceDetail"');
    expect(html).toContain('renderAgentMcpWorkbenchEntrance');
    expect(html).toContain('result && result.mcpEntranceStatus');
    expect(html).toContain('workflowPublication');
    expect(html).toContain('status.blockers');
    expect(html).toContain('status.blockers');
    expect(html).toContain('workbench_login_required');
    expect(html).toContain('workflow_promotion_draft_only');
    expect(html).toContain('usage_governance_local_only');
    expect(html).toContain('blocker.actions');
    expect(html).toContain('Actions: ${actions.join');
    expect(html).toContain('renderAgentMcpBlockerActionButtons');
    expect(html).toContain('Blocker actions');
    expect(html).toContain('id="agentMcpBlockerActionDetail"');
    expect(html).toContain('runAgentMcpBlockerAction');
    expect(html).toContain('renderAgentMcpBlockerActionResult');
    expect(html).toContain("renderAgentMcpBlockerActionResult(label, 'started'");
    expect(html).toContain("renderAgentMcpBlockerActionResult(label, r && r.ok ? 'finished' : 'needs_input'");
    expect(html).toContain("renderAgentMcpBlockerActionResult(label, 'failed'");
    expect(html).toContain('skill_id_required');
    expect((html.match(/skill_id_required/g) || []).length).toBe(1);
    expect(html).toContain('unsupported_action');
    expect(html).toContain('requiredInputs');
    expect(html).toContain('inputs=${r.requiredInputs.map');
    expect(html).toContain("tool === 'ac.usage.probe_quota_policy'");
    expect(html).toContain("tool === 'ac.usage.upload_cloud_draft'");
    expect(html).toContain("tool === 'ac.workflow.promote_workbench_preset'");
    expect(html).toContain("tool === 'ac.workflow.promote_script_hub_tool'");
    expect(html).toContain("command.includes('smoke:agent-mcp:e2e:open-login-wait')");
    expect(html).toContain('teamEntranceReady');
    expect(html).toContain('teamEntrancePhase');
    expect(html).toContain('teamEntranceBlockers');
    expect(html).toContain('Team entrance:');
    expect(html).toContain('workbenchE2eAcceptance');
    expect(html).toContain('Workbench E2E acceptance:');
    expect(html).toContain('Proof: ${acceptance.proofSource}');
    expect(html).toContain('工作台登录未完成');
    expect(html).toContain('Workflow 仍是草稿阶段');
    expect(html).toContain('Actions: ${actions.join');
    expect(html).toContain('promotionReadiness');
    expect(html).toContain('publishableNow');
    expect(html).toContain('Promotion phase: ${promotionPhase}');
    expect(html).toContain('not publishable');
    expect(html).toContain('发布工具');
    expect(html).toContain('plannedTool || target.id');
    expect(html).toContain('promotionTargetLines');
    expect(html).toContain('target.status');
    expect(html).toContain('target.missing');
    expect(html).toContain('Workflow promotion preflight');
    expect(html).toContain('promotionTargetDetailLines');
    expect(html).toContain('Workflow promotion gates');
    expect(html).toContain('promotionPreflightEvidence');
    expect(html).toContain('Workflow promotion evidence');
    expect(html).toContain('latestPromotionEvidence');
    expect(html).toContain('Skill exists: ${Boolean(latestPromotionEvidence.skillExists)}');
    expect(html).toContain('Evidence current: ${Boolean(latestPromotionEvidence.evidenceCurrent)}');
    expect(html).toContain('Passed: ${passed.join');
    expect(html).toContain('Missing: ${missing.join');
    expect(html).toContain('adminConfirmation');
    expect(html).toContain('adminConfirmation');
    expect(html).toContain('usageAudit');
    expect(html).toContain('本地用量审计');
    expect(html).toContain('assetcutter://mcp/usage-audit');
    expect(html).toContain('usage.cloudDraft');
    expect(html).toContain('usageUploadPlan.tool');
    expect(html).toContain('Upload tool: ${usageUploadTool}');
    expect(html).toContain('usageUploadReady');
    expect(html).toContain('usageEventCount');
    expect(html).toContain('usageBlockedBy');
    expect(html).toContain('Upload ready: ${usageUploadReady} / events: ${usageEventCount}');
    expect(html).toContain('Upload blockers: ${usageBlockedBy.join');
    expect(html).toContain('Quota enforced: ${Boolean(usageQuotaPolicy.cloudQuotaEnforced)}');
    expect(html).toContain('usageQuotaSource');
    expect(html).toContain('usageQuotaPolicyId');
    expect(html).toContain('usageQuotaProbeTool');
    expect(html).toContain('usageQuotaExit');
    expect(html).toContain('Quota source: ${usageQuotaSource}');
    expect(html).toContain('Quota policy: ${usageQuotaPolicyId}');
    expect(html).toContain('Quota probe: ${usageQuotaProbeTool}');
    expect(html).toContain('Required to exit blocker: ${usageQuotaExit.join');
    expect(html).toContain('usage.governanceEvidence');
    expect(html).toContain('Usage governance evidence');
    expect(html).toContain('latestUsageEvidence');
    expect(html).toContain('Dry run: ${Boolean(latestUsageEvidence.dryRun)}');
    expect(html).toContain('Exit ready: ${Boolean(latestUsageEvidence.exitReady)}');
    expect(html).toContain('usageRemainingGates');
    expect(html).toContain('Remaining: ${usageRemainingGates.join');
    expect(html).toContain('ac.usage.upload_cloud_draft');
    expect(html).toContain('id="btnUsageUploadDryRun"');
    expect(html).toContain('id="btnUsageUploadCloudDraft"');
    expect(html).toContain('id="btnUsageQuotaPolicyProbe"');
    expect(html).toContain('id="agentUsageUploadDetail"');
    expect(html).toContain('runAgentUsageUploadUi');
    expect(html).toContain('runAgentUsageQuotaPolicyProbeUi');
    expect(html).toContain('agent.usageUploadCloudDraft');
    expect(html).toContain('agent.usageQuotaPolicyProbe');
    expect(html).toContain('quotaEnforced=${Boolean(quota.cloudQuotaEnforced)}');
    expect(html).toContain('id="agentWorkflowPromotionCard"');
    expect(html).toContain('id="inpWorkflowPromotionSkillId"');
    expect(html).toContain('id="btnFillLatestWorkflowDraft"');
    expect(html).toContain('id="btnPromoteWorkbenchPresetPreflight"');
    expect(html).toContain('id="btnPromoteScriptHubToolPreflight"');
    expect(html).toContain('id="agentWorkflowPromotionDetail"');
    expect(html).toContain('runWorkflowPromotionPreflightUi');
    expect(html).toContain('fillLatestWorkflowPromotionDraftUi');
    expect(html).toContain('agent.workflowPromotionDrafts');
    expect(html).toContain('selected=${latest.id}');
    expect(html).toContain('agent.workflowPromotionPreflight');
    expect(html).toContain("target, skillId");
    expect(html).toContain('adminApproved=${Boolean(preflight.adminConfirmation');
    expect(preload).toContain("workflowPromotionPreflight: (options) => timedInvoke('agent-workflow-promotion-preflight'");
    expect(preload).toContain("workflowPromotionDrafts: () => timedInvoke('agent-workflow-promotion-drafts'");
    expect(main).toContain("ipcMain.handle('agent-workflow-promotion-preflight'");
    expect(main).toContain("ipcMain.handle('agent-workflow-promotion-drafts'");
    expect(main).toContain('listWorkflowPromotionDraftSummaries');
    expect(main).toContain('listSkillEntries(skillsRoot)');
    expect(main).toContain("policyDecision: 'copilot_ui_admin_confirm'");
    expect(main).toContain("adminConfirmationSource: 'copilot_ui'");
    expect(main).toContain("auditRecordWritten: true");
    expect(html).toContain('dryRun: true');
    expect(html).toContain('dryRun: false');
    expect(html).toContain('authRequired=true');
    expect(html).toContain('noEvents=true');
    expect(html).toContain('外部 Agent（已改 CLI）');
    expect(html).toContain('usage.generatedAt');
    expect(html).toContain('compactAgentUsageNumber(totals.totalTokens)');
    expect(html).toContain('totals.freshInputTokens');
    expect(html).toContain('totals.cachedInputTokens');
    expect(html).toContain('totals.outputTokens');
    expect(html).toContain('Workflow draft registry ready');
    expect(html).toContain('Workflow draft registry needs approval');
    expect(html).toContain('Workflow draft registry blocked by policy');
    expect(html).toContain('Workflow draft registry tools missing');
    expect(html).toContain('External Agents can save a skill draft first');
    expect(html).toContain('Workbench entrance ready');
    expect(html).toContain('Workbench login required');
    expect(html).toContain('Workbench E2E missing');
    expect(html).toContain('cookieCount');
    expect(html).toContain('hasLikelyAuthCookie');
    expect(html).toContain('account && typeof account.hasAuthCookie');
    expect(html).toContain('account && account.partition');
    expect(html).toContain('Partition');
  });

  it('exposes a local shell account status card backed by the shared team partition', () => {
    const html = fs.readFileSync(shellIndexPath, 'utf8');
    const main = fs.readFileSync(shellMainPath, 'utf8');
    const preload = fs.readFileSync(shellPreloadPath, 'utf8');
    const scriptHubClient = fs.readFileSync(scriptHubClientPath, 'utf8');

    expect(html).toContain('id="shellAccountCard"');
    expect(html).toContain('id="btnOpenWorkbenchLogin"');
    expect(html).toContain('id="btnShellAccountWaitLoginE2e"');
    expect(html).toContain('id="btnRefreshShellAccount"');
    expect(html).toContain('loadShellAccountStatusUi');
    expect(html).toContain("const btnShellAccountWaitLoginE2e = $('btnShellAccountWaitLoginE2e');");
    expect(html).toContain('await loadShellAccountStatusUi();');
    expect(html).toContain('waitForShellAccountLoginUi({ timeoutMs: 120000, intervalMs: 2000 })');
    expect(html).toContain('runAgentMcpWorkbenchE2eUi(login && login.ok ? {} : { recoveryWaitMs: 30000 })');
    expect(html).toContain('openWorkbenchLoginUi');
    expect(preload).toContain("accountStatus: () => timedInvoke('shell-account-status')");
    expect(main).toContain("const FIRST_PARTY_WEB_PARTITION = TEAM_WEB_PARTITION");
    expect(main).toContain('LEGACY_FIRST_PARTY_WEB_PARTITIONS');
    expect(main).toContain("['persist:assetcutter-workbench', 'persist:assetcutter-script-hub']");
    expect(main).toContain('migrateLegacyFirstPartyCookies');
    expect(main).toContain("skippedReason = 'target_has_auth_cookie'");
    expect(main).toContain('electronCookieSetDetails');
    expect(main).toContain('summarizeShellAccountForAgent');
    expect(main).toContain('account: shellAccount');
    expect(main).toContain('Use ac.workbench.ensure_ready');
    expect(main).toContain('readShellAccountStatus');
    expect(main).toContain("ipcMain.handle('shell-account-status'");
    expect(main).toContain('partition: FIRST_PARTY_WEB_PARTITION');
    expect(main).toContain('function ensureWorkbenchBrowserView()');
    expect(main).toContain('function ensureScriptsBrowserView()');
    expect(main).toMatch(/function ensureWorkbenchBrowserView\(\)[\s\S]*?webPreferences:\s*\{[\s\S]*?partition:\s*FIRST_PARTY_WEB_PARTITION/);
    expect(main).toMatch(/function ensureScriptsBrowserView\(\)[\s\S]*?webPreferences:\s*\{[\s\S]*?partition:\s*FIRST_PARTY_WEB_PARTITION/);
    expect(main).toContain("credentials: 'include'");
    expect(main).toContain('const shellAccount = await readShellAccountStatus();');
    expect(main).toContain('summarizeWorkbenchE2eEntrance');
    expect(main).toContain('mcpWorkbenchLastE2e');
    expect(main).toContain('buildAgentMcpEntranceStatus');
    expect(main).toContain('mcpEntranceStatus');
    expect(main).toContain('buildAgentMcpEntranceBlockers');
    expect(main).toContain("require('./agent-blocker-actions.cjs')");
    expect(main).toContain('workbenchLoginActions()');
    expect(main).toContain('workflowPromotionActions()');
    expect(main).toContain('usageGovernanceActions()');
    expect(main).toContain('const usageCloudDraft = usage.cloudDraft');
    expect(main).toContain('missingGates: usageMissingGates');
    expect(main).toContain('cloudDraft: usageCloudDraft');
    expect(main).toContain('blockedBy: Array.isArray(usageCloudDraft.blockedBy)');
    expect(main).toContain('teamEntranceReady');
    expect(main).toContain('teamEntrancePhase');
    expect(main).toContain('teamEntranceBlockers');
    expect(main).toContain('governance_blocked');
    expect(main).toContain('workbench_blocked');
    expect(main).toContain('summarizeWorkflowPublicationState');
    expect(main).toContain('summarizeCopilotUsageAudit({ days: 1, limit: 5000 })');
    expect(main).toContain('readCopilotUsageQuotaPolicy');
    expect(main).toContain("ipcMain.handle('agent-usage-upload-cloud-draft'");
    expect(main).toContain('uploadCopilotUsageCloudDraft(options');
    expect(main).toContain("require('./agent-usage-cloud-draft.cjs')");
    expect(main.indexOf("code: 'AGENT_USAGE_UPLOAD_NO_EVENTS'")).toBeLessThan(
      main.indexOf("code: 'AGENT_AUTH_REQUIRED'"),
    );
    expect(main.indexOf('if (dryRun)')).toBeLessThan(main.indexOf("code: 'AGENT_AUTH_REQUIRED'"));
    expect(preload).toContain("usageUploadCloudDraft: (options) => timedInvoke('agent-usage-upload-cloud-draft'");
    expect(preload).toContain("usageQuotaPolicyProbe: () => timedInvoke('agent-usage-quota-policy-probe'");
    expect(main).toContain("ipcMain.handle('agent-usage-quota-policy-probe'");
    expect(main).toContain('/api/usage/policy');
    expect(main).toContain('summarizeWorkbenchEntranceState');
    expect(main).toContain('authOrigin: account.authOrigin');
    expect(main).toContain('siteOrigin: account.siteOrigin');
    expect(main).toContain('shellAccount,');
    expect(main).toContain('mcpWorkbenchLastE2e,');
    expect(main).not.toContain("partition: 'persist:assetcutter-script-hub'");
    expect(main).not.toContain("partition: 'persist:assetcutter-workbench'");
    expect(scriptHubClient).toContain("const SCRIPT_HUB_PARTITION = TEAM_WEB_PARTITION");
    expect(scriptHubClient).not.toContain("const SCRIPT_HUB_PARTITION = 'persist:assetcutter-script-hub'");
    expect(html).toContain('if (result && result.shellAccount) renderShellAccountStatus(result.shellAccount);');
    expect(html).toContain('r.settings.mcpWorkbenchLastE2e');
    expect(html).toContain('renderAgentMcpE2e({ e2e: r.settings.mcpWorkbenchLastE2e })');
    expect(html).toContain('migration.copiedCount');
    expect(html).toContain('\u5df2\u4ece\u65e7\u4f1a\u8bdd\u5206\u533a\u8fc1\u79fb ${Number(migration.copiedCount)} \u4e2a Cookie');
  });

  it('surfaces workbench login readiness in the right-side Copilot entrance', () => {
    const panel = fs.readFileSync(copilotPanelPath, 'utf8');

    expect(panel).toContain('lastAccountSnapshot');
    expect(panel).toContain('lastWorkbenchEntranceSnapshot');
    expect(panel).toContain('loadTeamAccountStatus');
    expect(panel).toContain('workbenchEntranceFromSettings');
    expect(panel).toContain('workbenchAcceptanceFromSettings');
    expect(panel).toContain('teamEntranceFromSettings');
    expect(panel).toContain('lastTeamEntranceSnapshot');
    expect(panel).toContain('blockersFromSettings');
    expect(panel).toContain('runWorkbenchEntranceValidation');
    expect(panel).toContain('agent.mcpWorkbenchE2e');
    expect(panel).toContain('waitForTeamAccountLogin');
    expect(panel).toContain('await waitForTeamAccountLogin(120000)');
    expect(panel).toContain('recoveryWaitMs: 30000');
    expect(panel).toContain('\\u8fd0\\u884c\\u5de5\\u4f5c\\u53f0\\u9a8c\\u6536');
    expect(panel).toContain('\\u767b\\u5f55\\u540e\\u9a8c\\u6536');
    expect(panel).toContain("if (info.kind === 'workbench-auth')");
    expect(panel).toContain('shell.accountStatus');
    expect(panel).toContain('mcpEntranceStatus');
    expect(panel).toContain('workbenchEntrance');
    expect(panel).toContain('workbenchAcceptance');
    expect(panel).toContain('mcpEntranceStatus.blockers');
    expect(panel).toContain('opts.blockers');
    expect(panel).toContain('opts.teamEntrance');
    expect(panel).toContain('teamEntrancePhase');
    expect(panel).toContain('teamEntranceReady');
    expect(panel).toContain('governance_blocked');
    expect(panel).toContain('workbench_blocked');
    expect(panel).toContain('\\u56e2\\u961f\\u53d1\\u5e03\\u6cbb\\u7406');
    expect(panel).toContain('blockerList');
    expect(panel).toContain('formatBlockerActions');
    expect(panel).toContain('runCopilotBlockerAction');
    expect(panel).toContain('appendBlockerActionButtons');
    expect(panel).toContain('blockerActionKey');
    expect(panel).toContain('formatRequiredInputs');
    expect(panel).toContain('formatTeamAccountDiagnostics');
    expect(panel).toContain("'Account: ' + formatTeamAccountDiagnostics(account)");
    expect(panel).toContain('formatTeamAccountDiagnostics(login)');
    expect(panel).toContain('action.requiredInputs');
    expect(panel).toContain('inputs=${names.join');
    expect(panel).toContain('requiredInputLine');
    expect(panel).toContain('action started: ${label}');
    expect(panel).toContain('action finished: ${label}');
    expect(panel).toContain('action needs input: ${label}');
    expect(panel).toContain('action failed: ${label}');
    expect(panel).toContain('blockerActions');
    expect(panel).toContain("'Actions: ' + blockerActions.join");
    expect(panel).toContain("command.includes('smoke:agent-mcp:e2e:open-login-wait')");
    expect(panel).toContain("command.includes('smoke:agent-mcp:e2e:wait-login')");
    expect(panel).toContain("tool === 'ac.usage.probe_quota_policy'");
    expect(panel).toContain("tool === 'ac.usage.upload_cloud_draft'");
    expect(panel).toContain("tool === 'ac.workflow.promote_workbench_preset'");
    expect(panel).toContain('appendBlockerActionButtons(actions, blockers)');
    expect(panel).toContain('workbench_login_required');
    expect(panel).toContain('workflow_promotion_draft_only');
    expect(panel).toContain('usage_governance_local_only');
    expect(panel).toContain('workflowMissing');
    expect(panel).toContain('Workflow gates:');
    expect(panel).toContain('workflowPublicationFromSettings');
    expect(panel).toContain('workflowPublication');
    expect(panel).toContain('promotionPreflightEvidence');
    expect(panel).toContain('Workflow evidence:');
    expect(panel).toContain('deleted draft');
    expect(panel).toContain("' stale ' + (latestPromotionEvidence.staleReason");
    expect(panel).toContain('usageBlocker');
    expect(panel).toContain('Usage upload:');
    expect(panel).toContain('usageBlocker.cloudDraft.uploadPlan.tool');
    expect(panel).toContain('Usage quota:');
    expect(panel).toContain('cloudQuotaEnforced ?');
    expect(panel).toContain('Usage policy probe:');
    expect(panel).toContain('usageBlockedBy');
    expect(panel).toContain('Usage blockers:');
    expect(panel).toContain('usageAuditFromSettings');
    expect(panel).toContain('usageAudit');
    expect(panel).toContain('governanceEvidence');
    expect(panel).toContain('Usage evidence:');
    expect(panel).toContain('latestUsageEvidence.exitReady');
    expect(panel).toContain('usageRemaining');
    expect(panel).toContain('Workbench acceptance:');
    expect(panel).toContain('admin approval');
    expect(panel).toContain('.slice(0, 3)');
    expect(panel).toContain('if (ready && blockers.length)');
    expect(panel).not.toContain('if (ready && blockers.length && !entranceReady)');
    expect(panel).toContain("\\u5de5\\u4f5c\\u53f0\\u767b\\u5f55\\u672a\\u5b8c\\u6210");
    expect(panel).toContain("Workflow \\u4ecd\\u662f\\u8349\\u7a3f\\u9636\\u6bb5");
    expect(panel).toContain('entranceReady');
    expect(panel).toContain("entranceStatus !== 'login_required'");
    expect(panel).toContain('e2e_missing');
    expect(panel).toContain("\\u5de5\\u4f5c\\u53f0\\u5f85\\u767b\\u5f55");
    expect(panel).toContain('\\u6253\\u5f00\\u8bbe\\u7f6e\\u9a8c\\u6536');
    expect(panel).toContain("\\u6253\\u5f00\\u5de5\\u4f5c\\u53f0\\u767b\\u5f55");
    expect(panel).toContain("Copilot \\u5927\\u8111\\u5df2\\u5c31\\u7eea");
    expect(panel).toContain('workflowPublication,');
    expect(panel).toContain('usageAudit,');
  });

  it('passes sidebar inset as an object so collapsed width 0 is not eaten as IPC timeout', () => {
    const preload = fs.readFileSync(shellPreloadPath, 'utf8');
    const main = fs.readFileSync(shellMainPath, 'utf8');

    expect(preload).toContain("timedInvoke('shell-workbench-sidebar-inset', { px:");
    expect(preload).not.toMatch(
      /setWorkbenchSidebarInsetPx:\s*\(px\)\s*=>\s*timedInvoke\('shell-workbench-sidebar-inset',\s*px\)/,
    );
    expect(main).toContain("payload.px");
    expect(main).toContain("shell-workbench-sidebar-inset");
  });

  it('hides Copilot completely when collapsed and puts the toggle next to window controls', () => {
    const panel = fs.readFileSync(copilotPanelPath, 'utf8');
    const html = fs.readFileSync(shellIndexPath, 'utf8').replace(/\r\n/g, '\n');
    const main = fs.readFileSync(shellMainPath, 'utf8');

    expect(html).toMatch(
      /id="copilot-toggle"[\s\S]*?id="btnTrafficMin"/,
    );
    expect(html).not.toMatch(
      /<aside class="shell-copilot"[\s\S]*?id="copilot-toggle"/,
    );
    expect(html).toContain('body.shell-copilot-collapsed aside.shell-copilot');
    expect(html).toContain('visibility: hidden');
    expect(html).toContain('body.shell-sidebar-collapsed nav.shell-sidebar');
    expect(html).not.toContain('flex: 0 0 48px');
    expect(panel).toContain('const COPILOT_COLLAPSED_WIDTH = 0');
    expect(main).toContain('const SHELL_COPILOT_WIDTH_COLLAPSED = 0');
  });

  it('keeps the right-side Copilot aligned to the long-work P0 home screen', () => {
    const panel = fs.readFileSync(copilotPanelPath, 'utf8');
    const html = fs.readFileSync(shellIndexPath, 'utf8');
    const main = fs.readFileSync(shellMainPath, 'utf8');
    const preload = fs.readFileSync(shellPreloadPath, 'utf8');

    expect(panel).toContain('showMemberOnboardCard');
    expect(panel).toContain('showLongWorkHomeCard');
    expect(panel).toContain('loadWorkbenchContextSnapshot');
    expect(panel).toContain('loadProjectMemorySnapshot');
    expect(panel).toContain('saveProjectMemoryFromCopilot');
    expect(panel).toContain('summarizeWorkbenchContext');
    expect(panel).toContain('summarizeProjectMemorySnapshot');
    expect(panel).toContain('copilot-work-home');
    expect(panel).toContain('copilot-work-status-grid');
    expect(panel).toContain("\\u8d26\\u53f7");
    expect(panel).toContain("\\u5de5\\u4f5c\\u53f0");
    expect(panel).toContain('Agent');
    expect(panel).toContain("\\u6cbb\\u7406");
    expect(panel).toContain('startCopilotWorkTask');
    expect(panel).toContain('Prepare Workbench, create a new project');
    expect(panel).toContain('Read the current Workbench project context and list recent assets.');
    expect(panel).toContain('Use ac.workbench.ensure_ready with requireProject=true and createIfMissing=true');
    expect(panel).toContain('choose one directly runnable capability');
    expect(panel).toContain('runWorkbenchEntranceValidation(null');
    expect(panel).toContain('appendTaskThreadCard');
    expect(panel).toContain('appendResultCard');
    expect(panel).toContain('copilot-task-thread-card');
    expect(panel).toContain('copilot-result-card');
    expect(panel).toContain('AGENT_CREDITS_REQUIRED');
    expect(panel).toContain("kind: 'credits-required'");
    expect(panel).toContain('workbench_e2e_failed');
    expect(panel).toContain('is-save-outlet');
    expect(panel).toContain('updateActiveTaskThread');
    expect(panel).toContain("\\u4fdd\\u5b58\\u51fa\\u53e3");
    expect(panel).toContain("\\u9879\\u76ee\\u8bb0\\u5fc6");
    expect(panel).toContain("\\u8bb0\\u4f4f\\u7ed3\\u8bba");
    expect(panel).toContain("\\u8bb0\\u4f4f\\u53c2\\u6570");
    expect(panel).toContain("\\u8bb0\\u5f55\\u5f53\\u524d\\u72b6\\u6001");
    expect(panel).toContain("\\u6700\\u8fd1\\u4efb\\u52a1");

    expect(html).toContain('#shell-copilot .copilot-work-home');
    expect(html).toContain('#shell-copilot .copilot-work-status-grid');
    expect(html).toContain('#shell-copilot .copilot-work-actions');
    expect(html).toContain('#shell-copilot .copilot-task-thread-card');
    expect(html).toContain('#shell-copilot .copilot-result-card');

    expect(preload).toContain("workbenchContext: () => timedInvoke('agent-workbench-context'");
    expect(preload).toContain("projectMemory: (options) => timedInvoke('agent-project-memory-list'");
    expect(preload).toContain("saveProjectMemory: (entry) => timedInvoke('agent-project-memory-save'");
    expect(main).toContain('let agentWorkbenchClient = null');
    expect(main).toContain('agentWorkbenchClient = workbenchClient');
    expect(main).toContain("ipcMain.handle('agent-workbench-context'");
    expect(main).toContain("ipcMain.handle('agent-project-memory-list'");
    expect(main).toContain("ipcMain.handle('agent-project-memory-save'");
    expect(main).toContain('agentWorkbenchClient.getContext()');
    expect(main).toContain('agentStore.listToolExecutions({ limit: 5 })');
  });
});
