(function () {
  'use strict';

  const shell = window.companionShell;
  const agent = shell && shell.agentSession;
  if (!agent) return;

  const root = document.getElementById('shell-copilot');
  const bodyEl = root ? root.querySelector('.copilot-body') : null;
  const messagesEl = document.getElementById('copilot-messages');
  const inputEl = document.getElementById('copilot-input');
  const sendBtn = document.getElementById('copilot-send');
  const abortBtn = document.getElementById('copilot-abort');
  const toggleBtn = document.getElementById('copilot-toggle');
  const brainSettingsBtn = document.getElementById('copilot-brain-settings');
  const clearHistoryBtn = document.getElementById('copilot-clear-history');
  const brainLabel = document.getElementById('copilot-brain-label');
  const statusEl = document.getElementById('copilot-status');
  const examplesEl = document.getElementById('copilot-examples');
  const tokenBarEl = document.getElementById('copilot-token-bar');
  const tokenTotalEl = document.getElementById('copilot-token-total');
  const tokenNewEl = document.getElementById('copilot-token-new');
  const tokenCachedEl = document.getElementById('copilot-token-cached');
  const tokenOutputEl = document.getElementById('copilot-token-output');
  const tokenReasoningEl = document.getElementById('copilot-token-reasoning');
  const tokenPopoverEl = document.getElementById('copilot-token-popover');
  const perceptionBarEl = document.getElementById('copilot-perception-bar');
  const perceptionWorkspaceEl = document.getElementById('copilot-perception-workspace');
  const perceptionObjectEl = document.getElementById('copilot-perception-object');
  const perceptionExternalEl = document.getElementById('copilot-perception-external');
  const perceptionDesktopEl = document.getElementById('copilot-perception-desktop');
  const perceptionRecentEl = document.getElementById('copilot-perception-recent');
  const perceptionRefreshEl = document.getElementById('copilot-perception-refresh');
  const timelineEl = document.getElementById('copilot-timeline');
  const timelineSummaryEl = document.getElementById('copilot-timeline-summary');
  const timelineCountEl = document.getElementById('copilot-timeline-count');
  const timelineListEl = document.getElementById('copilot-timeline-list');
  const desktopObservationEl = document.getElementById('copilot-desktop-observation');
  const desktopObservationSummaryEl = document.getElementById('copilot-desktop-observation-summary');
  const desktopObservationScopeEl = document.getElementById('copilot-desktop-observation-scope');
  const desktopObservationStatusEl = document.getElementById('copilot-desktop-observation-status');
  const desktopObservationEnableBtn = document.getElementById('copilot-desktop-observation-enable');
  const desktopObservationPauseBtn = document.getElementById('copilot-desktop-observation-pause');
  const desktopObservationStopBtn = document.getElementById('copilot-desktop-observation-stop');
  const desktopObservationScopeBtns = Array.from(document.querySelectorAll('[data-desktop-observation-scope]'));
  const topStateEl = document.getElementById('copilot-top-state');
  const topStateTextEl = document.getElementById('copilot-top-state-text');
  const contextTitleEl = document.getElementById('copilot-context-title');
  const contextBadgeEl = document.getElementById('copilot-context-badge');
  const currentRunEl = document.getElementById('copilot-current-run');
  const currentRunStateEl = document.getElementById('copilot-current-run-state');
  const currentRunGoalEl = document.getElementById('copilot-current-run-goal');
  const currentRunProgressEl = document.getElementById('copilot-current-run-progress');
  const currentRunActivityEl = document.getElementById('copilot-current-run-activity');

  if (!root || !messagesEl || !inputEl || !sendBtn) return;

  let streamingText = '';
  let turnBusy = false;
  let brainReady = false;
  let onboardEl = null;
  let brainStateCard = null;
  let brainStateEls = null;
  let lastSettingsSnapshot = null;
  let lastProbeSnapshot = null;
  let lastAccountSnapshot = null;
  let lastWorkbenchEntranceSnapshot = null;
  let lastWorkbenchAcceptanceSnapshot = null;
  let lastTeamEntranceSnapshot = null;
  let lastWorkbenchContextSnapshot = null;
  let lastToolExecutionsSnapshot = [];
  let lastExternalConnectionSnapshot = null;
  let lastPerceptionRefreshedAt = 0;
  let lastPerceptionRefreshFailed = false;
  let lastProjectMemorySnapshot = null;
  let lastUsageSnapshot = null;
  let lastAgentPolicySnapshot = { confirmTools: true, autoConfirmTools: [], forbiddenTools: [] };
  let copilotTimelineEvents = [];
  let desktopObservationState = {
    enabled: false,
    paused: false,
    permissionGranted: false,
    scope: 'current_window',
    foregroundApp: '',
    foregroundWindowTitle: '',
    lastFrameAt: 0,
    lastSummary: '',
    privacyMode: 'strict',
    recordingIndicatorVisible: false,
    cacheFrameCount: 0,
    cacheFrameLimit: 30,
  };
  let lastDesktopObservationFrameId = '';
  let lastUserPrompt = '';
  let activeCodexSetupRunId = '';
  let activeTaskThreadCard = null;
  let activeTaskThreadEls = null;
  let activeTaskThreadKey = '';
  let activeTaskThreadAttempt = 0;
  let pendingTaskThreadPrompt = '';
  let permissionPolicySyncedForMode = '';
  let codexWaitHintTimer = null;
  let codexWaitStartedAt = 0;
  let codexLastProgressLabel = '';
  let activeObjectSessionId = '';
  let activeObjectSessionLabel = '';
  let activeObjectSessionType = '';
  let activeObjectContextPrompt = '';
  const COPILOT_EXPANDED_MIN_WIDTH = 360;
  const COPILOT_EXPANDED_DEFAULT_WIDTH = 380;
  const COPILOT_EXPANDED_MAX_WIDTH = 720;
  const COPILOT_TIMELINE_LIMIT = 50;
  /** Collapsed: fully hidden (no residual rail). Toggle lives in the titlebar. */
  const COPILOT_COLLAPSED_WIDTH = 0;
  const COPILOT_TOGGLE_ICON_EXPANDED =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" opacity="0.42" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg>';
  const COPILOT_TOGGLE_ICON_COLLAPSED =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" opacity="0.42" /><rect x="14" y="4" width="7" height="16" rx="1.5" opacity="0.28" /></svg>';

  const EXAMPLE_PHRASES = [
    '\u6253\u5f00\u811a\u672c\u9875',
    '\u4f34\u4fa3\u8fd0\u884c\u72b6\u6001\u600e\u4e48\u6837\uff1f',
    '\u5207\u6362\u5230\u8bbe\u7f6e\u9875',
  ];

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
  }

  function normalizeObjectSessionPart(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function buildObjectSessionId(type, id) {
    const safeType = normalizeObjectSessionPart(type);
    const safeId = normalizeObjectSessionPart(id);
    return safeType && safeId ? safeType + '-' + safeId : '';
  }

  function currentSessionId() {
    return activeObjectSessionId || undefined;
  }

  function buildObjectContextPrompt(type, id, label) {
    const objectType = normalizeObjectSessionPart(type);
    const objectId = String(id || '').trim();
    const objectLabel = String(label || id || '').trim();
    if (objectType === 'tool') {
      return [
        '\u5f53\u524d\u5bf9\u8bdd\u7ed1\u5b9a\u5230\u4e00\u4e2a\u672c\u5730\u5de5\u5177\u3002',
        '\u5de5\u5177 ID: ' + objectId,
        '\u5de5\u5177\u540d\u79f0: ' + objectLabel,
        '\u5982\u679c\u7528\u6237\u8981\u4fee\u590d\u3001\u8c03\u6574\u6216\u7ee7\u7eed\u4f18\u5316\u8fd9\u4e2a\u5de5\u5177\uff0c\u4f18\u5148\u4f7f\u7528 ac.shell_tool.authored_upsert \u4fee\u6539\u5b83\u7684\u672c\u673a\u8349\u7a3f\uff0c\u5fc5\u8981\u65f6\u7528 ac.shell_tool.run \u590d\u6d4b\u3002',
      ].join('\n');
    }
    if (objectType === 'host') {
      return [
        '\u5f53\u524d\u5bf9\u8bdd\u7ed1\u5b9a\u5230\u4e00\u4e2a\u5bbf\u4e3b\u8fde\u63a5\u3002',
        '\u5bbf\u4e3b ID: ' + objectId,
        '\u5bbf\u4e3b\u540d\u79f0: ' + objectLabel,
        '\u5982\u679c\u7528\u6237\u8981\u5b89\u88c5\u3001\u542f\u52a8\u3001\u5173\u95ed\u3001\u63a2\u6d4b\u6216\u4fee\u590d\u8fd9\u4e2a\u5bbf\u4e3b\uff0c\u4f18\u5148\u4f7f\u7528 ac.companion.host_bridge.* \u5de5\u5177\uff0c\u6210\u529f\u9a8c\u6536\u5fc5\u987b\u6765\u81ea\u771f\u5b9e\u8f6f\u4ef6\u8fde\u63a5\u4fe1\u53f7\u3002',
      ].join('\n');
    }
    return '';
  }

  function setObjectSessionUi() {
    root.dataset.copilotSessionId = activeObjectSessionId || 'default';
    root.dataset.copilotSessionType = activeObjectSessionType || 'default';
    const suffix = activeObjectSessionLabel ? '\u5f53\u524d\uff1a' + activeObjectSessionLabel : '';
    if (inputEl) {
      inputEl.placeholder = activeObjectSessionLabel
        ? '\u7ee7\u7eed\u4f18\u5316 ' + activeObjectSessionLabel
        : '\u8bd5\u8bd5\uff1a\u6253\u5f00\u811a\u672c / \u4f34\u4fa3\u72b6\u6001\u600e\u4e48\u6837\uff1f';
    }
    if (suffix) setStatus(suffix);
    updateShellCopilotPerceptionBar(lastWorkbenchContextSnapshot, lastToolExecutionsSnapshot, lastExternalConnectionSnapshot);
  }

  async function openObjectSession(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const explicitSessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
    const sessionId = explicitSessionId || buildObjectSessionId(data.type, data.id);
    if (!sessionId) return { ok: false, error: 'invalid_object_session' };
    activeObjectSessionId = sessionId;
    activeObjectSessionType = normalizeObjectSessionPart(data.type);
    activeObjectSessionLabel = String(data.label || data.id || '').trim();
    activeObjectContextPrompt =
      typeof data.contextPrompt === 'string' && data.contextPrompt.trim()
        ? data.contextPrompt.trim()
        : buildObjectContextPrompt(data.type, data.id, activeObjectSessionLabel);
    emitCopilotTimelineEvent({
      source: 'user',
      title: '切换对象：' + (activeObjectSessionLabel || activeObjectSessionId),
      status: 'done',
    });
    setObjectSessionUi();
    await loadHistory();
    if (data.focus !== false && typeof inputEl.focus === 'function') inputEl.focus();
    if (data.prompt && typeof data.prompt === 'string') {
      inputEl.value = data.prompt;
      resizeComposer();
    }
    return { ok: true, sessionId };
  }

  window.__acOpenCopilotObjectSession = openObjectSession;

  if (typeof shell.onOpenCopilotObjectSession === 'function') {
    shell.onOpenCopilotObjectSession((payload) => {
      void openObjectSession(payload || {});
    });
  }

  function clearCodexWaitHintTimer() {
    if (!codexWaitHintTimer) return;
    clearTimeout(codexWaitHintTimer);
    codexWaitHintTimer = null;
    codexWaitStartedAt = 0;
    codexLastProgressLabel = '';
  }

  function startCodexWaitHintTimer() {
    clearCodexWaitHintTimer();
    codexWaitStartedAt = Date.now();
    const tick = () => {
      if (!turnBusy) return;
      const elapsed = Math.max(1, Math.round((Date.now() - codexWaitStartedAt) / 1000));
      const label = codexLastProgressLabel ? ` \u00b7 ${codexLastProgressLabel}` : '';
      if (codexLastProgressLabel === '\u7f51\u7edc\u6b63\u5728\u91cd\u8bd5' && elapsed >= 25) {
        setStatus(`Codex \u7f51\u7edc\u8fde\u63a5\u4e0d\u7a33\u5b9a ${elapsed}s \u00b7 \u6b63\u5728\u91cd\u8bd5\uff1b\u53ef\u68c0\u67e5\u4ee3\u7406/\u767b\u5f55\u6001`);
      } else {
        setStatus(`Codex \u6b63\u5728\u601d\u8003 ${elapsed}s${label}`);
      }
      codexWaitHintTimer = setTimeout(tick, elapsed < 8 ? 4000 : 5000);
    };
    codexWaitHintTimer = setTimeout(tick, 4000);
  }

  function rememberCodexProgress(ev) {
    const name = String((ev && ev.name) || '').trim();
    const phase = String((ev && ev.phase) || '').trim();
    if (name === 'codex.network') {
      codexLastProgressLabel = '\u7f51\u7edc\u6b63\u5728\u91cd\u8bd5';
    } else if (name === 'codex.command') {
      codexLastProgressLabel = phase === 'done' ? '\u547d\u4ee4\u5df2\u5b8c\u6210' : '\u6b63\u5728\u8fd0\u884c\u547d\u4ee4';
    } else if (name.startsWith('codex.') && name !== 'codex.turn' && name !== 'codex.thinking') {
      codexLastProgressLabel = phase === 'done' ? '\u5de5\u5177\u5df2\u8fd4\u56de' : '\u6b63\u5728\u8c03\u7528\u5de5\u5177';
    } else if (name === 'codex.thinking' || name === 'codex.turn') {
      codexLastProgressLabel = '\u7b49\u5f85 Codex \u8fd4\u56de\u6587\u672c';
    }
  }

  function formatCodexSetupChecks(result) {
    const checks = Array.isArray(result && result.setupChecks) ? result.setupChecks : [];
    if (!checks.length) return '';
    return checks
      .map((check) => {
        const mark = check && check.ok ? '\u5df2\u901a\u8fc7' : '\u672a\u901a\u8fc7';
        const label = String((check && check.label) || (check && check.id) || '').trim();
        const next = check && !check.ok ? String(check.nextAction || '').trim() : '';
        return [mark, label, next ? '\u5efa\u8bae\uff1a' + next : ''].filter(Boolean).join(' ');
      })
      .join(' / ');
  }

  function openCopilotSettings() {
    if (typeof shell.setShellView === 'function') void shell.setShellView('settings');
    if (typeof window.__acApplyShellViewFromMain === 'function') {
      void window.__acApplyShellViewFromMain('settings');
    }
  }

  function fillPrompt(text) {
    inputEl.value = text || '';
    resizeComposer();
    inputEl.focus();
  }

  function fillAndSend(text) {
    fillPrompt(text);
    void sendMessage();
  }

  function startCopilotWorkTask(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return;
    pendingTaskThreadPrompt = text;
    appendTaskThreadCard(text, { source: 'quick_task' });
    emitCopilotTimelineEvent({ source: 'user', title: '启动任务：' + text, status: 'running' });
    fillAndSend(text);
  }

  function switchToWorkbench() {
    if (typeof shell.setShellView === 'function') void shell.setShellView('workbench');
    if (typeof window.__acApplyShellViewFromMain === 'function') {
      void window.__acApplyShellViewFromMain('workbench');
    }
  }

  function switchToConnections() {
    if (typeof shell.setShellView === 'function') void shell.setShellView('connections');
    if (typeof window.__acApplyShellViewFromMain === 'function') {
      void window.__acApplyShellViewFromMain('connections');
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  async function loadTeamAccountStatus() {
    if (typeof shell.accountStatus !== 'function') return null;
    try {
      const status = await shell.accountStatus();
      lastAccountSnapshot = status && typeof status === 'object' ? status : null;
    } catch {
      lastAccountSnapshot = null;
    }
    return lastAccountSnapshot;
  }

  function workbenchEntranceFromSettings(response) {
    const entrance =
      response &&
      response.mcpEntranceStatus &&
      response.mcpEntranceStatus.workbenchEntrance &&
      typeof response.mcpEntranceStatus.workbenchEntrance === 'object'
        ? response.mcpEntranceStatus.workbenchEntrance
        : null;
    if (entrance) lastWorkbenchEntranceSnapshot = entrance;
    return entrance || lastWorkbenchEntranceSnapshot;
  }

  function workbenchAcceptanceFromSettings(response) {
    const acceptance =
      response &&
      response.mcpEntranceStatus &&
      response.mcpEntranceStatus.workbenchE2eAcceptance &&
      typeof response.mcpEntranceStatus.workbenchE2eAcceptance === 'object'
        ? response.mcpEntranceStatus.workbenchE2eAcceptance
        : null;
    if (acceptance) lastWorkbenchAcceptanceSnapshot = acceptance;
    return acceptance || lastWorkbenchAcceptanceSnapshot;
  }

  function blockersFromSettings(response) {
    return response &&
      response.mcpEntranceStatus &&
      Array.isArray(response.mcpEntranceStatus.blockers)
      ? response.mcpEntranceStatus.blockers
      : [];
  }

  function formatBlockerActions(blocker, limit = 3) {
    const actions = Array.isArray(blocker && blocker.actions) ? blocker.actions : [];
    return actions
      .map((action) => String((action && (action.tool || action.command || action.id)) || '').trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  function blockerActionKey(action) {
    return String((action && (action.tool || action.command || action.id)) || '').trim();
  }

  function formatRequiredInputs(action) {
    const inputs = Array.isArray(action && action.requiredInputs) ? action.requiredInputs : [];
    const names = inputs
      .map((input) => String((input && (input.name || input.label)) || '').trim())
      .filter(Boolean);
    return names.length ? `inputs=${names.join(',')}` : '';
  }

  function formatTeamAccountDiagnostics(account) {
    const status = account && typeof account === 'object' ? account : {};
    return [
      `loggedIn=${Boolean(status.loggedIn)}`,
      `cookies=${Number(status.cookieCount) || 0}`,
      `authCookie=${status.hasAuthCookie ? 'present' : 'missing'}`,
      status.partition ? `partition=${status.partition}` : '',
      status.authOrigin ? `authOrigin=${status.authOrigin}` : '',
      status.siteOrigin ? `siteOrigin=${status.siteOrigin}` : '',
      Number.isFinite(Number(status.statusCode)) ? `status=${Number(status.statusCode)}` : '',
      status.error ? `error=${status.error}` : '',
    ].filter(Boolean).join(' / ');
  }

  async function loadWorkbenchContextSnapshot() {
    if (!agent || typeof agent.workbenchContext !== 'function') return null;
    try {
      const r = await agent.workbenchContext();
      const structured = r && r.structured && typeof r.structured === 'object' ? r.structured : null;
      if (structured) lastWorkbenchContextSnapshot = structured;
      if (r && Array.isArray(r.executions)) lastToolExecutionsSnapshot = r.executions;
      updateShellCopilotPerceptionBar(lastWorkbenchContextSnapshot, lastToolExecutionsSnapshot, lastExternalConnectionSnapshot);
      return { context: structured, executions: Array.isArray(r && r.executions) ? r.executions : [] };
    } catch {
      return null;
    }
  }

  async function loadProjectMemorySnapshot() {
    if (!agent || typeof agent.projectMemory !== 'function') return null;
    try {
      const r = await agent.projectMemory({ limit: 20, includeDisabled: true });
      if (r && r.ok !== false) {
        lastProjectMemorySnapshot = r;
        return r;
      }
      return null;
    } catch {
      return null;
    }
  }

  function summarizeProjectMemorySnapshot(memory) {
    const m = memory && typeof memory === 'object' ? memory : lastProjectMemorySnapshot || {};
    const summary = m.summary && typeof m.summary === 'object' ? m.summary : {};
    const active = Number(summary.active) || 0;
    const latest = Array.isArray(summary.latest) ? summary.latest : Array.isArray(m.notes) ? m.notes.slice(-3).reverse() : [];
    const projectLabel = String(m.projectName || m.projectId || '').trim();
    const kindSummary = summary.byKind && typeof summary.byKind === 'object'
      ? Object.keys(summary.byKind)
          .filter((key) => Number(summary.byKind[key]) > 0)
          .map((key) => `${key}:${summary.byKind[key]}`)
          .slice(0, 3)
          .join(' / ')
      : '';
    return {
      label: active ? `${active} saved${kindSummary ? ' / ' + kindSummary : ''}` : '\u672a\u5efa\u7acb',
      projectLabel,
      latestText: latest.length ? String(latest[0].text || '').slice(0, 90) : '',
    };
  }

  async function saveProjectMemoryFromCopilot(kind, text, btn) {
    if (!agent || typeof agent.saveProjectMemory !== 'function') {
      appendBubble('tool', 'project memory unavailable', 'copilot-msg-tool');
      return null;
    }
    const value = String(text || '').trim();
    if (!value) {
      appendBubble('tool', 'memory skipped: empty text', 'copilot-msg-tool');
      return null;
    }
    if (btn) btn.disabled = true;
    try {
      const r = await agent.saveProjectMemory({
        kind,
        text: value,
        tags: ['copilot', kind],
        source: 'copilot-result-card',
        contextEnabled: true,
      });
      if (r && r.ok) {
        lastProjectMemorySnapshot = {
          ok: true,
          projectId: r.projectId,
          projectName: r.projectName,
          summary: r.summary,
          notes: r.note ? [r.note] : [],
        };
        appendBubble('tool', `project memory saved: ${kind}`, 'copilot-msg-tool');
        return r;
      }
      appendBubble('tool', `project memory failed: ${(r && (r.error || r.message)) || 'unknown'}`, 'copilot-msg-tool');
      return r;
    } catch (e) {
      appendBubble('tool', `project memory failed: ${e && e.message ? e.message : e}`, 'copilot-msg-tool');
      return null;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function summarizeWorkbenchContext(context, executions) {
    const ctx = context && typeof context === 'object' ? context : lastWorkbenchContextSnapshot || {};
    const activeProject =
      ctx.activeProject && typeof ctx.activeProject === 'object'
        ? ctx.activeProject
        : null;
    const projectName = String(
      ctx.activeProjectName ||
        (activeProject && (activeProject.name || activeProject.title)) ||
        ctx.activeProjectId ||
        '',
    ).trim();
    const projects = Array.isArray(ctx.projects) ? ctx.projects : [];
    const presets = Array.isArray(ctx.capabilityPresets) ? ctx.capabilityPresets : [];
    const directPresets = presets.filter((preset) => preset && preset.directRunSupported === true);
    const activeAssets = activeProject && Array.isArray(activeProject.assets) ? activeProject.assets : [];
    const execs = Array.isArray(executions) && executions.length ? executions : lastToolExecutionsSnapshot;
    const latestTask = Array.isArray(execs) && execs.length
      ? execs
          .slice(0, 3)
          .map((item) => {
            const tool = String((item && (item.tool || item.name)) || '').trim();
            const ok = item && Object.prototype.hasOwnProperty.call(item, 'ok') ? Boolean(item.ok) : null;
            return [tool || 'task', ok === null ? '' : ok ? 'ok' : 'failed'].filter(Boolean).join(' ');
          })
          .join(' / ')
      : '';
    return {
      projectLabel: projectName || (projects.length ? projects.length + ' projects available' : '\u672a\u8bfb\u5230\u9879\u76ee'),
      assetLabel: activeAssets.length ? activeAssets.length + ' assets in current project' : '\u7b49\u5f85\u5217\u53d6\u5f53\u524d\u9879\u76ee\u8d44\u4ea7',
      capabilityLabel: directPresets.length
        ? directPresets.length + ' runnable capabilities'
        : presets.length
          ? presets.length + ' capabilities, direct run unknown'
          : '\u7b49\u5f85\u8bfb\u53d6\u53ef\u8fd0\u884c\u80fd\u529b',
      taskLabel: latestTask || '\u6682\u65e0\u6700\u8fd1\u4efb\u52a1\u8bb0\u5f55',
    };
  }

  function setPerceptionChip(el, text, tone) {
    if (!el) return;
    const value = String(text || '').trim();
    el.textContent = value;
    el.title = value;
    el.className =
      'copilot-perception-chip' +
      (tone === 'active' ? ' is-active' : tone === 'warn' ? ' is-warn' : tone === 'hidden' ? ' is-hidden' : '');
  }

  function summarizeCopilotProductState(runtimeState) {
    const activeTask = runtimeState && runtimeState.activeTask ? runtimeState.activeTask : null;
    const desktop = runtimeState && runtimeState.desktopObservation ? runtimeState.desktopObservation : null;
    const tones = (runtimeState && runtimeState.perceptionTones) || {};
    if (activeTask && activeTask.status === 'failed') {
      return { title: '\u9700\u8981\u4f60\u5904\u7406\u5f53\u524d\u4efb\u52a1', badge: '\u9700\u5904\u7406', top: '\u9700\u5904\u7406', tone: 'warn' };
    }
    if (activeTask && activeTask.status === 'running') {
      return { title: '\u6b63\u5728\u6267\u884c\u5f53\u524d\u4efb\u52a1', badge: '\u8fd0\u884c\u4e2d', top: '\u8fd0\u884c\u4e2d', tone: 'active' };
    }
    if (desktop && desktop.enabled && desktop.permissionGranted && !desktop.paused) {
      return { title: '\u6b63\u5728\u89c2\u5bdf\u5f53\u524d\u5de5\u4f5c', badge: '\u89c2\u5bdf\u4e2d', top: '\u89c2\u5bdf\u4e2d', tone: 'active' };
    }
    if (tones.external === 'warn') {
      return { title: '\u8fde\u63a5\u72b6\u6001\u9700\u8981\u68c0\u67e5', badge: '\u5f85\u8fde\u63a5', top: '\u5f85\u8fde\u63a5', tone: 'warn' };
    }
    return { title: '\u51c6\u5907\u63a5\u7ba1\u5f53\u524d\u5de5\u4f5c', badge: '\u53ef\u5f00\u59cb', top: '\u5f85\u547d', tone: '' };
  }

  function renderCopilotProductState(runtimeState) {
    const state = summarizeCopilotProductState(runtimeState);
    if (contextTitleEl) contextTitleEl.textContent = state.title;
    if (contextBadgeEl) {
      contextBadgeEl.textContent = state.badge;
      contextBadgeEl.className = 'copilot-context-badge' + (state.tone === 'active' ? ' is-active' : state.tone === 'warn' ? ' is-warn' : '');
    }
    if (topStateEl) {
      topStateEl.className = 'copilot-top-state' + (state.tone === 'active' ? ' is-active' : state.tone === 'warn' ? ' is-warn' : '');
    }
    if (topStateTextEl) topStateTextEl.textContent = state.top;
  }

  function formatPerceptionRefreshAge(ts) {
    const value = Number(ts || 0);
    if (!value) return '\u5237\u65b0\uff1a\u7b49\u5f85\u4e2d';
    const ageSeconds = Math.max(0, Math.round((Date.now() - value) / 1000));
    if (ageSeconds < 3) return '\u5237\u65b0\uff1a\u521a\u521a';
    if (ageSeconds < 60) return `\u5237\u65b0\uff1a${ageSeconds}s\u524d`;
    return `\u5237\u65b0\uff1a${Math.round(ageSeconds / 60)}m\u524d`;
  }

  function summarizeDesktopObservationState() {
    if (desktopObservationState.enabled && desktopObservationState.permissionGranted && !desktopObservationState.paused) {
      const scope = desktopObservationScopeLabel(desktopObservationState.scope);
      const foreground =
        desktopObservationState.foregroundApp || desktopObservationState.foregroundWindowTitle
          ? ' / ' + [desktopObservationState.foregroundApp, desktopObservationState.foregroundWindowTitle].filter(Boolean).join('：')
          : '';
      const recent = desktopObservationState.lastSummary ? ' / ' + desktopObservationState.lastSummary : '';
      return {
        label: '\u89c2\u5bdf\u4e2d\uff1a' + scope + foreground + recent,
        tone: 'active',
      };
    }
    if (desktopObservationState.enabled && !desktopObservationState.permissionGranted) {
      return {
        label: '\u5c4f\u5e55\u76d1\u63a7\u5f85\u6388\u6743',
        tone: 'warn',
      };
    }
    if (desktopObservationState.paused) {
      return {
        label: '\u5c4f\u5e55\u76d1\u63a7\u5df2\u6682\u505c',
        tone: 'warn',
      };
    }
    return {
      label: '\u5c4f\u5e55\u76d1\u63a7\u672a\u5f00\u542f',
      tone: 'warn',
    };
  }

  function buildDesktopObservationRuntimeSummary() {
    const summary = summarizeDesktopObservationState();
    return {
      enabled: Boolean(desktopObservationState.enabled),
      paused: Boolean(desktopObservationState.paused),
      permissionGranted: Boolean(desktopObservationState.permissionGranted),
      scope: desktopObservationState.scope,
      foregroundApp: desktopObservationState.foregroundApp || '',
      foregroundWindowTitle: desktopObservationState.foregroundWindowTitle || '',
      lastFrameAt: desktopObservationState.lastFrameAt || 0,
      lastSummary: desktopObservationState.lastSummary || '',
      cacheFrameCount: desktopObservationState.cacheFrameCount || 0,
      cacheFrameLimit: desktopObservationState.cacheFrameLimit || 30,
      summaryText: summary.label,
      tone: summary.tone,
      rawFrameRequiresConfirmation: true,
    };
  }

  function desktopObservationScopeLabel(scope) {
    if (scope === 'app') return '\u6307\u5b9a\u5e94\u7528';
    if (scope === 'desktop') return '\u5168\u684c\u9762';
    return '\u5f53\u524d\u7a97\u53e3';
  }

  function updateDesktopObservationUi() {
    const state = desktopObservationState;
    const scopeLabel = desktopObservationScopeLabel(state.scope);
    if (desktopObservationSummaryEl) {
      desktopObservationSummaryEl.textContent = state.enabled
        ? state.permissionGranted
          ? state.paused
            ? '\u5c4f\u5e55\u89c2\u5bdf\uff1a\u5df2\u6682\u505c'
            : '\u5c4f\u5e55\u89c2\u5bdf\uff1a\u89c2\u5bdf\u4e2d'
          : '\u5c4f\u5e55\u89c2\u5bdf\uff1a\u5f85\u6388\u6743'
        : '\u5c4f\u5e55\u89c2\u5bdf\uff1a\u672a\u5f00\u542f';
    }
    if (desktopObservationScopeEl) desktopObservationScopeEl.textContent = scopeLabel;
    if (desktopObservationStatusEl) {
      const cacheText =
        state.cacheFrameCount > 0
          ? '\u77ed\u671f\u7f13\u5b58\uff1a' + state.cacheFrameCount + '/' + state.cacheFrameLimit + '\uff1b' + (state.lastSummary || '\u5df2\u8bb0\u5f55\u6700\u8fd1\u6458\u8981')
          : '\u77ed\u671f\u7f13\u5b58\uff1a\u6682\u65e0\u5e27\u6458\u8981';
      desktopObservationStatusEl.textContent = state.enabled
        ? state.permissionGranted
          ? state.paused
            ? '\u5df2\u6682\u505c\u89c2\u5bdf\uff0c\u672c\u5730\u4e0d\u91c7\u96c6\u65b0\u753b\u9762\u3002'
            : '\u89c2\u5bdf\u72b6\u6001\u53ef\u89c1\uff1b\u5f53\u524d\u9636\u6bb5\u53ea\u4ea7\u751f\u7ed3\u6784\u5316\u6458\u8981\u3002' + cacheText
          : '\u5df2\u9009\u62e9\u8303\u56f4\uff0c\u4f46\u672a\u6388\u6743\uff1b\u672a\u6388\u6743\u65f6\u4e0d\u91c7\u96c6\u3002'
        : '\u672a\u6388\u6743\u65f6\u4e0d\u91c7\u96c6\u3002\u5f00\u542f\u540e\u4f1a\u5148\u7b49\u5f85\u7cfb\u7edf\u6388\u6743\u3002';
    }
    if (desktopObservationEnableBtn) {
      desktopObservationEnableBtn.textContent = state.enabled && state.permissionGranted && state.paused ? '\u7ee7\u7eed\u89c2\u5bdf' : '\u5f00\u542f\u89c2\u5bdf';
      desktopObservationEnableBtn.disabled = state.enabled && state.permissionGranted && !state.paused;
    }
    if (desktopObservationPauseBtn) desktopObservationPauseBtn.disabled = !state.enabled || !state.permissionGranted || state.paused;
    if (desktopObservationStopBtn) desktopObservationStopBtn.disabled = !state.enabled;
    desktopObservationScopeBtns.forEach((btn) => {
      const scope = btn && btn.getAttribute('data-desktop-observation-scope');
      btn.classList.toggle('is-active', scope === state.scope);
    });
    updateShellCopilotPerceptionBar(lastWorkbenchContextSnapshot, lastToolExecutionsSnapshot, lastExternalConnectionSnapshot);
  }

  function setDesktopObservationState(patch, title) {
    desktopObservationState = { ...desktopObservationState, ...(patch || {}) };
    updateDesktopObservationUi();
    emitCopilotTimelineEvent({
      source: 'desktop',
      title: title || '桌面观察状态更新',
      detail: desktopObservationScopeLabel(desktopObservationState.scope),
      status: desktopObservationState.enabled && desktopObservationState.permissionGranted && !desktopObservationState.paused ? 'running' : 'queued',
    });
  }

  function applyDesktopObservationStatus(status, options) {
    if (!status || status.ok === false) return;
    const state = status.state && typeof status.state === 'object' ? status.state : {};
    const latestFrame = status.latestFrame && typeof status.latestFrame === 'object' ? status.latestFrame : null;
    desktopObservationState = {
      ...desktopObservationState,
      enabled: Boolean(state.enabled),
      paused: Boolean(state.paused),
      permissionGranted: Boolean(state.permissionGranted),
      scope: state.scope || desktopObservationState.scope,
      cacheFrameCount: Number(status.frameCount) || 0,
      cacheFrameLimit: Number(status.frameLimit) || desktopObservationState.cacheFrameLimit,
      foregroundApp: latestFrame && latestFrame.foregroundApp ? latestFrame.foregroundApp : desktopObservationState.foregroundApp,
      foregroundWindowTitle:
        latestFrame && latestFrame.foregroundWindowTitle
          ? latestFrame.foregroundWindowTitle
          : desktopObservationState.foregroundWindowTitle,
      lastFrameAt: latestFrame && latestFrame.ts ? Date.parse(latestFrame.ts) || desktopObservationState.lastFrameAt : desktopObservationState.lastFrameAt,
      lastSummary: latestFrame && latestFrame.summary ? latestFrame.summary : desktopObservationState.lastSummary,
    };
    updateDesktopObservationUi();
    if (options && options.emitLatestFrame && latestFrame && latestFrame.id && latestFrame.id !== lastDesktopObservationFrameId) {
      lastDesktopObservationFrameId = latestFrame.id;
      emitCopilotTimelineEvent({
        source: 'desktop',
        title: 'desktop.observe.frame',
        detail: latestFrame.summary || desktopObservationScopeLabel(desktopObservationState.scope),
        status: 'running',
      });
    }
  }

  async function refreshDesktopObservationStatus(options) {
    if (!shell || typeof shell.desktopObservationStatus !== 'function') return null;
    try {
      const status = await shell.desktopObservationStatus();
      applyDesktopObservationStatus(status, options || {});
      return status;
    } catch {
      return null;
    }
  }

  async function startDesktopObservationRuntime(patch, title) {
    const nextState = { ...desktopObservationState, ...(patch || {}) };
    setDesktopObservationState(patch, title);
    if (!shell || typeof shell.desktopObservationStart !== 'function') return null;
    try {
      const status = await shell.desktopObservationStart({
        enabled: nextState.enabled,
        paused: nextState.paused,
        permissionGranted: nextState.permissionGranted,
        scope: nextState.scope,
      });
      applyDesktopObservationStatus(status, { emitLatestFrame: true });
      return status;
    } catch {
      return null;
    }
  }

  function sanitizeTimelineText(value) {
    let text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    text = text.replace(/(token|cookie|secret|password|authorization)\s*[:=]\s*[^,\s;]+/gi, '$1=[redacted]');
    text = text.replace(/[A-Za-z0-9+/]{160,}={0,2}/g, '[base64 redacted]');
    text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
    return text.slice(0, 180);
  }

  function timelineSourceLabel(source) {
    const s = String(source || '');
    if (s === 'user') return '用户';
    if (s === 'tool') return '工具';
    if (s === 'workflow') return '流程';
    if (s === 'external') return '外部';
    if (s === 'desktop') return '桌面';
    if (s === 'system') return '系统';
    return 'Copilot';
  }

  function formatTimelineTime(ts) {
    const ageSeconds = Math.max(0, Math.round((Date.now() - Number(ts || Date.now())) / 1000));
    if (ageSeconds < 3) return '刚刚';
    if (ageSeconds < 60) return ageSeconds + 's';
    return Math.round(ageSeconds / 60) + 'm';
  }

  function renderCopilotTimeline(openOnFailure) {
    if (!timelineEl || !timelineSummaryEl || !timelineCountEl || !timelineListEl) return;
    const events = copilotTimelineEvents.slice(-COPILOT_TIMELINE_LIMIT);
    const latest = events[events.length - 1];
    timelineSummaryEl.textContent = latest ? '刚才发生：' + latest.title : '刚才发生：暂无记录';
    timelineCountEl.textContent = String(events.length);
    timelineListEl.innerHTML = '';
    events.slice().reverse().forEach((event) => {
      const row = document.createElement('div');
      row.className = 'copilot-timeline-event' + (event.status === 'failed' ? ' is-failed' : '');
      const source = makeCopilotText('copilot-timeline-source', timelineSourceLabel(event.source));
      const title = makeCopilotText('copilot-timeline-title', event.title);
      const time = makeCopilotText('copilot-timeline-time', formatTimelineTime(event.ts));
      row.title = event.detail || event.title;
      row.appendChild(source);
      row.appendChild(title);
      row.appendChild(time);
      timelineListEl.appendChild(row);
    });
    if (openOnFailure && timelineEl.open) timelineEl.open = true;
  }

  function emitCopilotTimelineEvent(event) {
    const input = event && typeof event === 'object' ? event : {};
    const title = sanitizeTimelineText(input.title || input.detail || input.type || '事件');
    if (!title) return null;
    const item = {
      id: String(input.id || 'tl-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
      ts: Number(input.ts || Date.now()),
      source: input.source || 'system',
      title,
      detail: sanitizeTimelineText(input.detail || ''),
      status: input.status || undefined,
      risk: input.risk || undefined,
    };
    copilotTimelineEvents.push(item);
    if (copilotTimelineEvents.length > COPILOT_TIMELINE_LIMIT) {
      copilotTimelineEvents = copilotTimelineEvents.slice(-COPILOT_TIMELINE_LIMIT);
    }
    renderCopilotTimeline(item.status === 'failed');
    return item;
  }

  function summarizeShellExternalConnections(snapshot) {
    const list = Array.isArray(snapshot) ? snapshot : [];
    const software = list.filter((item) => String(item && (item.type || item.capabilityType || '')).trim() === 'software_connection');
    if (!software.length) return { label: '\u5916\u90e8\uff1a\u672a\u8bfb\u5230\u5bbf\u4e3b\u8fde\u63a5', tone: 'warn' };
    const connected = software.filter((item) => {
      const status = String((item && (item.status || item.health || item.connectionStatus)) || '').toLowerCase();
      return item && (item.connected === true || status === 'connected' || status === 'ok' || status === 'ready');
    });
    const first = connected[0] || software[0] || {};
    const name = String(first.name || first.label || first.id || '').trim() || '\u5bbf\u4e3b';
    const unknownSelection =
      first.selectionUnknown === true ||
      String((first.selection && first.selection.kind) || first.selectionKind || '').toLowerCase() === 'unknown';
    if (connected.length) {
      return {
        label: `\u5916\u90e8\uff1a${name}\u5df2\u8fde\u63a5${unknownSelection ? '\uff0c\u9009\u533a\u672a\u77e5' : ''}`,
        tone: unknownSelection ? 'warn' : 'active',
      };
    }
    return { label: `\u5916\u90e8\uff1a${name}\u672a\u8fde\u63a5`, tone: 'warn' };
  }

  async function loadShellExternalConnectionSnapshot() {
    if (!shell || typeof shell.api !== 'function') return null;
    try {
      const responses = await Promise.allSettled([
        shell.api('GET', '/v1/capability-packages/drafts', null),
        shell.api('GET', '/v1/capability-packages/cloud', null),
      ]);
      const rows = [];
      responses.forEach((result) => {
        const json = result && result.status === 'fulfilled' && result.value ? result.value.json : null;
        const candidates = [
          json && json.items,
          json && json.packages,
          json && json.drafts,
          json && json.capabilityPackages,
          Array.isArray(json) ? json : null,
        ];
        candidates.forEach((candidate) => {
          if (Array.isArray(candidate)) rows.push(...candidate);
        });
      });
      lastExternalConnectionSnapshot = rows;
      return rows;
    } catch {
      return null;
    }
  }

  /**
   * @typedef {Object} CopilotRuntimeState
   * @property {1} version
   * @property {number} capturedAt
   * @property {number} freshnessMs
   * @property {{id:string,label:string,ready:boolean,mode:'ask'|'sandbox'|'full'}} brain
   * @property {{workspace:string,object:string,external:string,desktop:string,recent:string,refresh:string,stale:boolean,risks:string[]}} perception
   * @property {{workspace:string,object:string,external:string,desktop:string,recent:string,refresh:string}} perceptionTones
   * @property {{enabled:boolean,paused:boolean,permissionGranted:boolean,scope:string,foregroundApp:string,foregroundWindowTitle:string,lastFrameAt:number,lastSummary:string,cacheFrameCount:number,cacheFrameLimit:number,summaryText:string,tone:string,rawFrameRequiresConfirmation:boolean}} desktopObservation
   * @property {{id:string,goal:string,status:string,currentStep?:string,blocker?:string,recoveryActions:Array<{id:string,label:string}>,updatedAt:number,attempt:number}=} activeTask
   * @property {Array<unknown>} timeline
   */

  function buildActiveTaskState() {
    if (!activeTaskThreadCard || !activeTaskThreadCard.isConnected || !activeTaskThreadEls) return undefined;
    const goalText = activeTaskThreadEls.goal ? String(activeTaskThreadEls.goal.textContent || '') : '';
    const progressText = activeTaskThreadEls.progress ? String(activeTaskThreadEls.progress.textContent || '') : '';
    const recoveryText = activeTaskThreadEls.recovery ? String(activeTaskThreadEls.recovery.textContent || '') : '';
    return {
      id: activeTaskThreadCard.dataset.taskId || activeTaskThreadKey || 'current-task',
      goal: goalText.replace(/^\u76ee\u6807\uff1a/, '') || '\u5f53\u524d\u4efb\u52a1',
      status: activeTaskThreadCard.dataset.taskStatus || 'unknown',
      currentStep: progressText.replace(/^\u8fdb\u5ea6\uff1a/, '') || undefined,
      blocker: activeTaskThreadCard.classList.contains('is-error') ? recoveryText.replace(/^\u6062\u590d\uff1a/, '') : undefined,
      recoveryActions: activeTaskThreadCard.classList.contains('is-error')
        ? [{ id: 'retry', label: '\u91cd\u8bd5' }, { id: 'details', label: '\u67e5\u770b\u8be6\u60c5' }]
        : [],
      updatedAt: Date.now(),
      attempt: Number(activeTaskThreadCard.dataset.taskAttempt || activeTaskThreadAttempt || 1),
    };
  }

  function stripCopilotRowPrefix(value) {
    return String(value || '').replace(/^[^:：]{1,12}[:：]\s*/, '').trim();
  }

  function setCurrentRunDock(phase, detail) {
    if (!currentRunEl) return;
    const safePhase = phase === 'done' || phase === 'error' || phase === 'activity' ? phase : 'running';
    const statusText =
      safePhase === 'done'
        ? '\u5df2\u5b8c\u6210'
        : safePhase === 'error'
          ? '\u9700\u8981\u5904\u7406'
          : safePhase === 'activity'
            ? '\u6d3b\u52a8\u66f4\u65b0'
            : '\u8fd0\u884c\u4e2d';
    const goalText = activeTaskThreadEls && activeTaskThreadEls.goal
      ? stripCopilotRowPrefix(activeTaskThreadEls.goal.textContent)
      : stripCopilotRowPrefix(lastUserPrompt) || '\u5f53\u524d\u4efb\u52a1';
    const progressText = detail
      ? String(detail).trim()
      : activeTaskThreadEls && activeTaskThreadEls.progress
        ? stripCopilotRowPrefix(activeTaskThreadEls.progress.textContent)
        : '\u7b49\u5f85\u6700\u65b0\u8fdb\u5c55';

    currentRunEl.hidden = false;
    currentRunEl.className = 'copilot-current-run is-' + safePhase;
    if (currentRunStateEl) currentRunStateEl.textContent = statusText;
    if (currentRunGoalEl) currentRunGoalEl.textContent = goalText || '\u5f53\u524d\u4efb\u52a1';
    if (currentRunProgressEl) currentRunProgressEl.textContent = progressText || '\u7b49\u5f85\u6700\u65b0\u8fdb\u5c55';
    renderCopilotProductState(buildCopilotRuntimeState(lastWorkbenchContextSnapshot, lastToolExecutionsSnapshot, lastExternalConnectionSnapshot));
  }

  function noteCurrentRunActivity(label, detail, phase) {
    const text = [label, detail].filter(Boolean).join('\uff1a').slice(0, 180);
    if (currentRunActivityEl) currentRunActivityEl.textContent = text ? '\u6700\u8fd1\u6d3b\u52a8\uff1a' + text : '';
    if (!activeTaskThreadEls && text) setCurrentRunDock(phase === 'error' ? 'error' : 'activity', text);
  }

  function clearCurrentRunDock() {
    if (!currentRunEl) return;
    currentRunEl.hidden = true;
    currentRunEl.className = 'copilot-current-run';
    if (currentRunStateEl) currentRunStateEl.textContent = '\u5f85\u547d';
    if (currentRunGoalEl) currentRunGoalEl.textContent = '';
    if (currentRunProgressEl) currentRunProgressEl.textContent = '';
    if (currentRunActivityEl) currentRunActivityEl.textContent = '';
    renderCopilotProductState(buildCopilotRuntimeState(lastWorkbenchContextSnapshot, lastToolExecutionsSnapshot, lastExternalConnectionSnapshot));
  }

  function buildCopilotRuntimeState(context, executions, externalSnapshot) {
    const capturedAt = Date.now();
    const contextSummary = summarizeWorkbenchContext(context, executions);
    const externalSummary = summarizeShellExternalConnections(
      Array.isArray(externalSnapshot) ? externalSnapshot : lastExternalConnectionSnapshot,
    );
    const desktopObservation = buildDesktopObservationRuntimeSummary();
    const desktopSummary = { label: desktopObservation.summaryText, tone: desktopObservation.tone };
    const objectLabel = activeObjectSessionLabel
      ? `\u5bf9\u8c61\uff1a${activeObjectSessionLabel}`
      : '\u5bf9\u8c61\uff1a\u9ed8\u8ba4\u5bf9\u8bdd';
    const stale =
      lastPerceptionRefreshFailed ||
      !lastPerceptionRefreshedAt ||
      capturedAt - lastPerceptionRefreshedAt > 30000;
    const refreshLabel = lastPerceptionRefreshFailed
      ? '\u5237\u65b0\uff1a\u8bfb\u53d6\u5931\u8d25'
      : formatPerceptionRefreshAge(lastPerceptionRefreshedAt);
    const mode = String((lastSettingsSnapshot && lastSettingsSnapshot.codexPermissionMode) || 'ask');
    const safeMode = mode === 'sandbox' || mode === 'full' ? mode : 'ask';
    return {
      version: 1,
      capturedAt,
      freshnessMs: lastPerceptionRefreshedAt ? capturedAt - lastPerceptionRefreshedAt : Number.POSITIVE_INFINITY,
      brain: {
        id: String((lastSettingsSnapshot && lastSettingsSnapshot.defaultBrainId) || (brainLabel && brainLabel.textContent) || 'codex'),
        label: String((brainLabel && brainLabel.textContent) || 'codex'),
        ready: Boolean(brainReady),
        mode: safeMode,
      },
      perception: {
        workspace: `\u5de5\u4f5c\u53f0\uff1a${contextSummary.projectLabel} / ${contextSummary.assetLabel}`,
        object: objectLabel,
        external: externalSummary.label,
        desktop: desktopSummary.label,
        recent: `\u6700\u8fd1\uff1a${contextSummary.taskLabel}`,
        refresh: refreshLabel,
        stale,
        risks: [
          ...(lastWorkbenchContextSnapshot ? [] : ['workspace_unknown']),
          ...(externalSummary.tone === 'warn' ? ['external_attention'] : []),
          ...(desktopSummary.tone === 'warn' ? ['desktop_observation_off'] : []),
          ...(stale ? ['stale'] : []),
        ],
      },
      perceptionTones: {
        workspace: lastWorkbenchContextSnapshot ? 'active' : 'warn',
        object: activeObjectSessionLabel ? 'active' : '',
        external: externalSummary.tone,
        desktop: desktopSummary.tone,
        recent: lastToolExecutionsSnapshot.length ? 'active' : '',
        refresh: stale ? 'warn' : '',
      },
      desktopObservation,
      activeTask: buildActiveTaskState(),
      timeline: copilotTimelineEvents.slice(-COPILOT_TIMELINE_LIMIT),
    };
  }

  function renderShellCopilotPerceptionBar(runtimeState) {
    if (!runtimeState || !runtimeState.perception) return;
    const p = runtimeState.perception;
    const tones = runtimeState.perceptionTones || {};
    setPerceptionChip(perceptionWorkspaceEl, p.workspace, tones.workspace);
    setPerceptionChip(perceptionObjectEl, p.object, tones.object || 'hidden');
    setPerceptionChip(perceptionExternalEl, p.external, tones.external);
    setPerceptionChip(perceptionDesktopEl, p.desktop, tones.desktop);
    setPerceptionChip(perceptionRecentEl, p.recent, tones.recent || 'hidden');
    setPerceptionChip(perceptionRefreshEl, p.refresh, tones.refresh || 'hidden');
    renderCopilotProductState(runtimeState);
  }

  function buildConfirmPerceptionSummary(runtimeState) {
    const state = runtimeState && runtimeState.perception ? runtimeState : buildCopilotRuntimeState(
      lastWorkbenchContextSnapshot,
      lastToolExecutionsSnapshot,
      lastExternalConnectionSnapshot,
    );
    const p = state.perception || {};
    const lines = [
      p.workspace,
      p.object,
      p.external,
      p.desktop,
      p.refresh,
    ].filter(Boolean);
    if (Array.isArray(p.risks) && p.risks.length) {
      lines.push('风险：' + p.risks.join(' / '));
    }
    if (p.stale) {
      lines.push('上下文可能过期，请先确认范围仍然正确。');
    }
    return {
      text: lines.map(sanitizeTimelineText).filter(Boolean).join('\n'),
      stale: Boolean(p.stale),
    };
  }

  function updateShellCopilotPerceptionBar(context, executions, externalSnapshot) {
    if (!perceptionBarEl) return;
    const runtimeState = buildCopilotRuntimeState(context, executions, externalSnapshot);
    renderShellCopilotPerceptionBar(runtimeState);
  }

  async function refreshShellCopilotPerceptionBar() {
    const [workbenchResult, externalResult, desktopResult] = await Promise.allSettled([
      loadWorkbenchContextSnapshot(),
      loadShellExternalConnectionSnapshot(),
      refreshDesktopObservationStatus({ emitLatestFrame: true }),
    ]);
    const workbench = workbenchResult.status === 'fulfilled' ? workbenchResult.value : null;
    const external = externalResult.status === 'fulfilled' ? externalResult.value : null;
    if (desktopResult.status === 'fulfilled' && desktopResult.value) {
      applyDesktopObservationStatus(desktopResult.value, { emitLatestFrame: true });
    }
    lastPerceptionRefreshFailed =
      workbenchResult.status === 'rejected' ||
      externalResult.status === 'rejected' ||
      (!workbench && !external);
    lastPerceptionRefreshedAt = Date.now();
    updateShellCopilotPerceptionBar(
      workbench && workbench.context ? workbench.context : lastWorkbenchContextSnapshot,
      workbench && Array.isArray(workbench.executions) ? workbench.executions : lastToolExecutionsSnapshot,
      Array.isArray(external) ? external : lastExternalConnectionSnapshot,
    );
  }

  async function refreshCopilotObservationAfterAction(reason, status) {
    try {
      await refreshShellCopilotPerceptionBar();
      emitCopilotTimelineEvent({
        source: 'system',
        title: '观察已刷新：' + (reason || '动作后'),
        status: status || 'done',
      });
    } catch {
      lastPerceptionRefreshFailed = true;
      updateShellCopilotPerceptionBar(lastWorkbenchContextSnapshot, lastToolExecutionsSnapshot, lastExternalConnectionSnapshot);
      emitCopilotTimelineEvent({
        source: 'system',
        title: '观察刷新失败：' + (reason || '动作后'),
        status: 'failed',
      });
    }
  }

  function makeCopilotText(className, text) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text || '';
    return el;
  }

  function buildTaskThreadKey(prompt) {
    return String(prompt || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 180);
  }

  function makeCopilotButton(label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className || 'copilot-onboard-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function appendStatusPill(host, label, value, tone) {
    const item = document.createElement('div');
    item.className = 'copilot-work-status-item ' + (tone || 'is-warn');
    item.appendChild(makeCopilotText('copilot-work-status-label', label));
    item.appendChild(makeCopilotText('copilot-work-status-value', value));
    host.appendChild(item);
  }

  function governanceReadyFrom(blockers, teamEntrance) {
    if (teamEntrance && teamEntrance.ready) return true;
    const governanceBlockers = new Set(['workflow_promotion_draft_only', 'usage_governance_local_only']);
    return !Array.isArray(blockers) || !blockers.some((blocker) => governanceBlockers.has(String(blocker && blocker.id ? blocker.id : '')));
  }

  function appendTaskThreadCard(prompt, meta) {
    if (!messagesEl) return null;
    const text = String(prompt || '').trim();
    const source = meta && meta.source ? String(meta.source) : 'composer';
    const nextKey = buildTaskThreadKey(text);
    const canReuse = activeTaskThreadCard && activeTaskThreadCard.isConnected && activeTaskThreadEls;
    const sameTask = canReuse && activeTaskThreadKey && activeTaskThreadKey === nextKey;
    const card = canReuse ? activeTaskThreadCard : document.createElement('div');
    card.className = 'copilot-task-thread-card';
    card.classList.remove('is-done', 'is-error');
    card.dataset.taskSource = source;
    card.dataset.taskId = nextKey || 'current-task';
    card.dataset.taskAttempt = String(sameTask ? activeTaskThreadAttempt + 1 : 1);
    card.dataset.taskStatus = 'running';

    activeTaskThreadKey = nextKey;
    activeTaskThreadAttempt = Number(card.dataset.taskAttempt || 1);

    if (canReuse) {
      if (activeTaskThreadEls.goal) {
        activeTaskThreadEls.goal.textContent = '\u76ee\u6807\uff1a' + (text || '\u7b49\u5f85\u8f93\u5165');
      }
      if (activeTaskThreadEls.attempt) {
        activeTaskThreadEls.attempt.textContent = '\u5c1d\u8bd5\uff1a' + activeTaskThreadAttempt;
      }
      if (activeTaskThreadEls.state) activeTaskThreadEls.state.textContent = '\u8fdb\u884c\u4e2d';
      if (activeTaskThreadEls.progress) activeTaskThreadEls.progress.textContent = '\u8fdb\u5ea6\uff1a\u5df2\u63a5\u5165 Copilot \u6267\u884c';
      if (activeTaskThreadEls.result) activeTaskThreadEls.result.textContent = '\u7ed3\u679c\uff1a\u7b49\u5f85 Agent \u8fd4\u56de';
      if (activeTaskThreadEls.recovery) {
        activeTaskThreadEls.recovery.textContent =
          '\u6062\u590d\uff1a\u5931\u8d25\u65f6\u4f1a\u7ed9\u51fa\u91cd\u8bd5\u3001\u767b\u5f55\u6216\u8bfb\u53d6\u4e0a\u4e0b\u6587\u52a8\u4f5c';
      }
      messagesEl.appendChild(card);
      setCurrentRunDock('running', '\u5df2\u63a5\u5165 Copilot \u6267\u884c');
      scrollMessagesToBottom();
      return card;
    }

    const head = document.createElement('div');
    head.className = 'copilot-task-thread-head';
    head.appendChild(makeCopilotText('copilot-task-thread-kicker', '\u4efb\u52a1\u7ebf\u7a0b'));
    head.appendChild(makeCopilotText('copilot-task-thread-state', '\u8fdb\u884c\u4e2d'));
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'copilot-task-thread-grid';
    const goal = makeCopilotText('copilot-task-thread-row is-goal', '\u76ee\u6807\uff1a' + (text || '\u7b49\u5f85\u8f93\u5165'));
    const attempt = makeCopilotText('copilot-task-thread-row is-attempt', '\u5c1d\u8bd5\uff1a' + activeTaskThreadAttempt);
    const plan = makeCopilotText('copilot-task-thread-row is-plan', '\u8ba1\u5212\uff1a\u8bfb\u53d6\u4e0a\u4e0b\u6587 \u2192 \u6267\u884c\u5fc5\u8981\u52a8\u4f5c \u2192 \u56de\u4f20\u7ed3\u679c');
    const progress = makeCopilotText('copilot-task-thread-row is-progress', '\u8fdb\u5ea6\uff1a\u5df2\u63a5\u5165 Copilot \u6267\u884c');
    const result = makeCopilotText('copilot-task-thread-row is-result', '\u7ed3\u679c\uff1a\u7b49\u5f85 Agent \u8fd4\u56de');
    const recovery = makeCopilotText('copilot-task-thread-row is-recovery', '\u6062\u590d\uff1a\u5931\u8d25\u65f6\u4f1a\u7ed9\u51fa\u91cd\u8bd5\u3001\u767b\u5f55\u6216\u8bfb\u53d6\u4e0a\u4e0b\u6587\u52a8\u4f5c');
    const save = makeCopilotText('copilot-task-thread-row is-save-outlet', '\u4fdd\u5b58\u51fa\u53e3\uff1a\u7ed3\u679c\u5165\u8d44\u4ea7\u5e93\uff0c\u6210\u529f\u6d41\u7a0b\u53ef\u4fdd\u5b58\u4e3a\u5de5\u4f5c\u6d41\u8349\u7a3f');
    [goal, attempt, plan, progress, result, recovery, save].forEach((row) => grid.appendChild(row));
    card.appendChild(grid);

    messagesEl.appendChild(card);
    activeTaskThreadCard = card;
    activeTaskThreadEls = { state: head.querySelector('.copilot-task-thread-state'), goal, attempt, progress, result, recovery };
    setCurrentRunDock('running', '\u5df2\u63a5\u5165 Copilot \u6267\u884c');
    scrollMessagesToBottom();
    return card;
  }

  function updateActiveTaskThread(phase, detail) {
    if (!activeTaskThreadCard || !activeTaskThreadEls) return;
    const text = detail ? String(detail) : '';
    if (phase === 'progress') {
      activeTaskThreadEls.progress.textContent = '\u8fdb\u5ea6\uff1a' + (text || '\u6b63\u5728\u6267\u884c');
      activeTaskThreadEls.state.textContent = '\u8fdb\u884c\u4e2d';
      activeTaskThreadCard.dataset.taskStatus = 'running';
      setCurrentRunDock('running', text || '\u6b63\u5728\u6267\u884c');
      emitCopilotTimelineEvent({ source: 'copilot', title: text || '任务进行中', status: 'running' });
    } else if (phase === 'done') {
      activeTaskThreadEls.result.textContent = '\u7ed3\u679c\uff1a' + (text || '\u5df2\u5b8c\u6210\uff0c\u8bf7\u67e5\u770b\u4e0a\u65b9\u8f93\u51fa');
      activeTaskThreadEls.state.textContent = '\u5df2\u5b8c\u6210';
      activeTaskThreadCard.dataset.taskStatus = 'succeeded';
      activeTaskThreadCard.classList.add('is-done');
      setCurrentRunDock('done', text || '\u5df2\u5b8c\u6210\uff0c\u7ed3\u679c\u5df2\u5199\u5165\u5bf9\u8bdd');
      emitCopilotTimelineEvent({ source: 'copilot', title: text || '任务已完成', status: 'done' });
    } else if (phase === 'error') {
      activeTaskThreadEls.recovery.textContent = '\u6062\u590d\uff1a' + (text || '\u5df2\u751f\u6210\u6062\u590d\u52a8\u4f5c');
      activeTaskThreadEls.state.textContent = '\u9700\u6062\u590d';
      activeTaskThreadCard.dataset.taskStatus = 'failed';
      activeTaskThreadCard.classList.add('is-error');
      setCurrentRunDock('error', text || '\u9700\u8981\u6062\u590d\u52a8\u4f5c');
      emitCopilotTimelineEvent({ source: 'copilot', title: text || '任务需要恢复', status: 'failed' });
    }
  }

  function appendResultCard(detail) {
    if (!messagesEl) return;
    const card = document.createElement('div');
    card.className = 'copilot-result-card';
    card.appendChild(makeCopilotText('copilot-result-title', '\u7ed3\u679c\u5361\u7247'));
    card.appendChild(
      makeCopilotText(
        'copilot-result-desc',
        detail || '\u4efb\u52a1\u5df2\u7ed3\u675f\u3002\u53ef\u7ee7\u7eed\u67e5\u770b\u8d44\u4ea7\u3001\u5904\u7406\u7ed3\u679c\uff0c\u6216\u5c06\u8dd1\u901a\u7684\u6b65\u9aa4\u4fdd\u5b58\u4e3a\u5de5\u4f5c\u6d41\u8349\u7a3f\u3002',
      ),
    );
    const actions = document.createElement('div');
    actions.className = 'copilot-result-actions';
    actions.appendChild(
      makeCopilotButton('\u770b\u8d44\u4ea7', 'copilot-onboard-btn is-primary', () =>
        startCopilotWorkTask('Read the current Workbench project context, list recent assets, and identify which outputs can be processed next.'),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u4fdd\u5b58\u6d41\u7a0b\u8349\u7a3f', 'copilot-onboard-btn', () =>
        startCopilotWorkTask('Summarize the successful steps from the current task and save them as a governed workflow draft when enough information is available.'),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u8bb0\u4f4f\u7ed3\u8bba', 'copilot-onboard-btn', (event) =>
        saveProjectMemoryFromCopilot('decision', detail || 'Task result completed from Copilot result card.', event && event.currentTarget),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u8bb0\u4f4f\u53c2\u6570', 'copilot-onboard-btn', (event) =>
        saveProjectMemoryFromCopilot('parameter', detail || 'Successful parameters should be reused for this project.', event && event.currentTarget),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u7ee7\u7eed\u5904\u7406', 'copilot-onboard-btn', () =>
        fillPrompt('Continue from the latest result. Read the current Workbench context first, then propose the next action.'),
      ),
    );
    card.appendChild(actions);
    messagesEl.appendChild(card);
    scrollMessagesToBottom();
  }

  async function runCopilotBlockerAction(action, btn) {
    const tool = String(action && action.tool ? action.tool : '');
    const command = String(action && action.command ? action.command : '');
    const label = String((action && action.label) || tool || command || (action && action.id) || 'Blocker action');
    const requiredInputLine = formatRequiredInputs(action);
    if (btn) btn.disabled = true;
    appendBubble('tool', `action started: ${label}`, 'copilot-msg-tool');
    try {
      if (command.includes('smoke:agent-mcp:e2e:open-login-wait')) {
        switchToWorkbench();
        const login = await waitForTeamAccountLogin(120000);
        await runWorkbenchEntranceValidation(btn, login && login.loggedIn ? {} : { recoveryWaitMs: 30000 });
        appendBubble(
          'tool',
          `action finished: ${label}\n${formatTeamAccountDiagnostics(login)}\nnext=Workbench E2E status refreshed`,
          'copilot-msg-tool',
        );
        return;
      }
      if (command.includes('smoke:agent-mcp:e2e:wait-login')) {
        await runWorkbenchEntranceValidation(btn, { recoveryWaitMs: 120000 });
        appendBubble('tool', `action finished: ${label}\nnext=Workbench E2E status refreshed`, 'copilot-msg-tool');
        return;
      }
      if (command.includes('smoke:agent-mcp:status')) {
        await refreshOnboardingState();
        appendBubble('tool', `action finished: ${label}\nnext=Entrance status refreshed`, 'copilot-msg-tool');
        return;
      }
      if (tool === 'ac.usage.probe_quota_policy' && typeof agent.usageQuotaPolicyProbe === 'function') {
        setStatus('Checking usage policy...');
        const r = await agent.usageQuotaPolicyProbe();
        await refreshOnboardingState();
        setStatus('Usage policy checked');
        appendBubble(
          'tool',
          `action finished: ${label}\nok=${Boolean(r && r.ok)}${r && r.code ? `\ncode=${r.code}` : ''}${
            r && r.endpoint ? `\nendpoint=${r.endpoint}` : ''
          }`,
          'copilot-msg-tool',
        );
        return;
      }
      if (tool === 'ac.usage.upload_cloud_draft' && typeof agent.usageUploadCloudDraft === 'function') {
        setStatus('Dry-running usage upload...');
        const r = await agent.usageUploadCloudDraft({ days: 1, limit: 5000, dryRun: true });
        await refreshOnboardingState();
        setStatus('Usage upload preflight done');
        appendBubble(
          'tool',
          `action finished: ${label}\nok=${Boolean(r && r.ok)} eventCount=${Number(r && r.eventCount) || 0}${
            r && r.code ? `\ncode=${r.code}` : ''
          }${r && r.noEvents ? '\nnoEvents=true' : ''}`,
          'copilot-msg-tool',
        );
        return;
      }
      if (tool === 'ac.workflow.promote_workbench_preset' || tool === 'ac.workflow.promote_script_hub_tool') {
        setStatus('Open Settings and enter a workflow draft id for promotion preflight.');
        openCopilotSettings();
        appendBubble(
          'tool',
          `action needs input: ${label}${requiredInputLine ? `\n${requiredInputLine}` : ''}\nOpen Settings and enter a workflow draft id for promotion preflight.`,
          'copilot-msg-tool',
        );
        return;
      }
      if (command) {
        fillPrompt(`Run ${command}`);
        appendBubble('tool', `action prepared: ${label}\ncommand copied into composer`, 'copilot-msg-tool');
        return;
      }
      openCopilotSettings();
      appendBubble('tool', `action routed: ${label}\nopened Settings`, 'copilot-msg-tool');
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      setStatus(message);
      appendBubble('tool', `action failed: ${label}\n${message}`, 'copilot-msg-tool');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function appendBlockerActionButtons(host, blockers) {
    if (!host || !Array.isArray(blockers) || !blockers.length) return;
    const seen = new Set();
    const actionItems = [];
    blockers.forEach((blocker) => {
      (Array.isArray(blocker && blocker.actions) ? blocker.actions : []).forEach((action) => {
        const key = blockerActionKey(action);
        if (!key || seen.has(key)) return;
        seen.add(key);
        actionItems.push(action);
      });
    });
    actionItems.slice(0, 4).forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copilot-onboard-btn';
      btn.textContent = String(action.label || action.tool || action.command || action.id || 'Action');
      const inputTitle = formatRequiredInputs(action);
      btn.title = [blockerActionKey(action), inputTitle].filter(Boolean).join(' / ');
      btn.addEventListener('click', () => void runCopilotBlockerAction(action, btn));
      host.appendChild(btn);
    });
  }

  function teamEntranceFromSettings(response) {
    const status = response && response.mcpEntranceStatus && typeof response.mcpEntranceStatus === 'object'
      ? response.mcpEntranceStatus
      : null;
    const teamEntrance = status
      ? {
          ready: Boolean(status.teamEntranceReady),
          phase: status.teamEntrancePhase ? String(status.teamEntrancePhase) : '',
          workbenchUsable: Boolean(status.workbenchUsable),
          blockers: Array.isArray(status.teamEntranceBlockers) ? status.teamEntranceBlockers.map(String) : [],
        }
      : null;
    if (teamEntrance) lastTeamEntranceSnapshot = teamEntrance;
    return teamEntrance || lastTeamEntranceSnapshot;
  }

  function workflowPublicationFromSettings(response) {
    return response &&
      response.mcpEntranceStatus &&
      response.mcpEntranceStatus.workflowPublication &&
      typeof response.mcpEntranceStatus.workflowPublication === 'object'
      ? response.mcpEntranceStatus.workflowPublication
      : null;
  }

  function usageAuditFromSettings(response) {
    return response &&
      response.mcpEntranceStatus &&
      response.mcpEntranceStatus.usageAudit &&
      typeof response.mcpEntranceStatus.usageAudit === 'object'
      ? response.mcpEntranceStatus.usageAudit
      : null;
  }

  async function waitForTeamAccountLogin(timeoutMs = 90000) {
    if (typeof shell.accountStatus !== 'function') return null;
    const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || 90000);
    let account = null;
    while (Date.now() <= deadline) {
      account = await loadTeamAccountStatus();
      if (account && account.loggedIn) return account;
      if (Date.now() >= deadline) break;
      await delay(Math.min(2000, Math.max(250, deadline - Date.now())));
    }
    return account;
  }

  async function setupCodexWithLoginRecovery(options) {
    if (!agent || typeof agent.setupCodex !== 'function') return { ok: false, error: 'setup_unavailable' };
    const opts = options && typeof options === 'object' ? options : {};
    const first = await agent.setupCodex(opts);
    if (!first || !first.cloudAuthLoginRequired) return first;
    setStatus('\u9700\u8981\u767b\u5f55\u5de5\u4f5c\u53f0\uff0c\u5df2\u4e3a\u4f60\u6253\u5f00\u3002');
    switchToWorkbench();
    const login = await waitForTeamAccountLogin(120000);
    if (!login || !login.loggedIn) return first;
    setStatus('\u767b\u5f55\u5b8c\u6210\uff0c\u7ee7\u7eed\u914d\u7f6e Codex...');
    return agent.setupCodex({ ...opts, retryAfterLogin: true });
  }

  async function requestShellUpdateCheckForCodexSetup(setup) {
    const r = setup && typeof setup === 'object' ? setup : {};
    if (!r.cloudAuthRouteMissing) return;
    if (!shell || typeof shell.checkShellUpdate !== 'function') return;
    try {
      setStatus('\u4e91\u7aef\u914d\u7f6e\u8fd8\u672a\u5c31\u7eea\uff0c\u6b63\u5728\u68c0\u67e5\u684c\u9762\u7aef\u66f4\u65b0...');
      await shell.checkShellUpdate();
    } catch {
      /* Update checks are best-effort; keep the Codex setup error visible. */
    }
  }

  async function runWorkbenchEntranceValidation(btn, options) {
    if (!agent || typeof agent.mcpWorkbenchE2e !== 'function') {
      openCopilotSettings();
      return null;
    }
    const opts = options && typeof options === 'object' ? options : {};
    if (btn) btn.disabled = true;
    setStatus('\u5de5\u4f5c\u53f0\u9a8c\u6536\u4e2d...');
    try {
      const r = await agent.mcpWorkbenchE2e(opts);
      if (r && r.mcpEntranceStatus && r.mcpEntranceStatus.workbenchEntrance) {
        lastWorkbenchEntranceSnapshot = r.mcpEntranceStatus.workbenchEntrance;
      }
      if (r && r.shellAccount) lastAccountSnapshot = r.shellAccount;
      await refreshOnboardingState();
      const ok = Boolean(r && r.ok && r.e2e && r.e2e.ok);
      setStatus(ok ? '\u5de5\u4f5c\u53f0\u94fe\u8def\u5df2\u9a8c\u6536' : '\u5de5\u4f5c\u53f0\u9a8c\u6536\u4ecd\u9700\u5904\u7406');
      setTimeout(() => setStatus(''), 3500);
      return r || null;
    } catch (e) {
      setStatus((e && e.message) ? e.message : String(e));
      return null;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderToggleIcon(collapsed) {
    if (!toggleBtn) return;
    toggleBtn.innerHTML = collapsed ? COPILOT_TOGGLE_ICON_COLLAPSED : COPILOT_TOGGLE_ICON_EXPANDED;
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggleBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', collapsed ? '\u5c55\u5f00 Copilot' : '\u6536\u8d77 Copilot');
    toggleBtn.title = collapsed ? '\u5c55\u5f00 Copilot' : '\u6536\u8d77 Copilot';
  }

  function scrollMessagesToBottom() {
    const scroller = bodyEl || messagesEl;
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  }

  function resizeComposer() {
    inputEl.style.height = 'auto';
    const nextHeight = Math.min(142, Math.max(48, inputEl.scrollHeight));
    inputEl.style.height = nextHeight + 'px';
  }

  function compactNumber(value) {
    const n = Number(value) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'm';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(Math.round(n));
  }

  function contextLimitForSettings(settings) {
    const model = String((settings && settings.codexModel) || '').toLowerCase();
    if (model.includes('mini') || model.includes('nano')) return 128000;
    return 256000;
  }

  function usageParts(usage) {
    const input = Number(usage && usage.input_tokens) || 0;
    const cached = Math.min(input, Number(usage && usage.cached_input_tokens) || 0);
    const output = Number(usage && usage.output_tokens) || 0;
    const reasoning = Number(usage && usage.reasoning_output_tokens) || 0;
    const freshInput = Math.max(0, input - cached);
    return { input, cached, freshInput, output, reasoning };
  }

  function updateTokenUsageBar(usage) {
    if (!tokenBarEl || !tokenTotalEl) return;
    if (usage && typeof usage === 'object') lastUsageSnapshot = usage;
    const current = lastUsageSnapshot || {};
    const parts = usageParts(current);
    const limit = contextLimitForSettings(lastSettingsSnapshot);
    const usedForBar = Math.min(limit, parts.freshInput + parts.cached + parts.output + parts.reasoning);
    const pct = limit > 0 ? Math.min(100, Math.max(0, (usedForBar / limit) * 100)) : 0;
    const segPct = (value) => (limit > 0 ? Math.min(100, Math.max(0, (Number(value) || 0) / limit * 100)) : 0);
    tokenTotalEl.textContent = compactNumber(usedForBar) + ' / ' + compactNumber(limit) + ' Tokens';
    if (tokenNewEl) tokenNewEl.style.width = segPct(parts.freshInput) + '%';
    if (tokenCachedEl) tokenCachedEl.style.width = segPct(parts.cached) + '%';
    if (tokenOutputEl) tokenOutputEl.style.width = segPct(parts.output) + '%';
    if (tokenReasoningEl) tokenReasoningEl.style.width = segPct(parts.reasoning) + '%';
    tokenBarEl.title = '上下文已使用 ' + Math.round(pct) + '%';
    if (tokenPopoverEl) {
      tokenPopoverEl.innerHTML = '';
      const head = document.createElement('div');
      head.textContent = '上下文使用率：' + Math.round(pct) + '%';
      tokenPopoverEl.appendChild(head);
      const rows = [
        ['新输入', parts.freshInput],
        ['缓存输入', parts.cached],
        ['输出', parts.output],
        ['推理输出', parts.reasoning],
      ];
      for (const row of rows) {
        const div = document.createElement('div');
        div.className = 'copilot-token-popover-row';
        const label = document.createElement('span');
        label.textContent = row[0];
        const value = document.createElement('span');
        value.textContent = compactNumber(row[1]);
        div.appendChild(label);
        div.appendChild(value);
        tokenPopoverEl.appendChild(div);
      }
      const note = document.createElement('div');
      note.className = 'copilot-token-popover-row';
      note.textContent = 'cached_input_tokens is included in input_tokens.';
      tokenPopoverEl.appendChild(note);
    }
  }

  function permissionModeLabel(mode) {
    if (mode === 'full') return 'Auto';
    if (mode === 'sandbox') return 'Sandbox';
    if (mode === 'ask' || !mode) return 'Ask';
    return 'Ask';
  }

  function normalizePolicyToolList(value) {
    const seen = new Set();
    const out = [];
    (Array.isArray(value) ? value : []).forEach((item) => {
      const name = String(item || '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push(name);
    });
    return out.sort();
  }

  function canRememberLowRiskConfirm(ev) {
    if (!ev || ev.name === 'codex.full_access_turn' || ev.clientId === 'mcp') return false;
    if (ev.risk && ev.risk !== 'confirm') return false;
    return ev.autoConfirmEligible === true || ev.name === 'ac.workbench.run_capability';
  }

  function renderRememberedLowRiskPolicy(policy) {
    const els = ensureBrainStateCard();
    if (!els || !els.rememberedPolicy) return;
    const snapshot = policy && typeof policy === 'object' ? policy : lastAgentPolicySnapshot;
    const remembered = normalizePolicyToolList(snapshot.autoConfirmTools);
    els.rememberedPolicy.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'copilot-policy-title';
    title.textContent = '已记住的低风险授权';
    els.rememberedPolicy.appendChild(title);
    if (!remembered.length) {
      const empty = document.createElement('div');
      empty.className = 'copilot-policy-empty';
      empty.textContent = '暂无。低风险确认卡可单独记住，高风险仍会确认。';
      els.rememberedPolicy.appendChild(empty);
      return;
    }
    remembered.forEach((toolName) => {
      const row = document.createElement('div');
      row.className = 'copilot-policy-row';
      const label = document.createElement('span');
      label.textContent = toolName;
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'copilot-mini-btn';
      revoke.textContent = '撤销';
      revoke.addEventListener('click', () => void revokeRememberedLowRiskTool(toolName));
      row.appendChild(label);
      row.appendChild(revoke);
      els.rememberedPolicy.appendChild(row);
    });
  }

  async function loadAgentPolicySnapshot() {
    if (!agent || typeof agent.loadPolicy !== 'function') {
      renderRememberedLowRiskPolicy(lastAgentPolicySnapshot);
      return lastAgentPolicySnapshot;
    }
    try {
      const r = await agent.loadPolicy();
      if (r && r.ok && r.agentPolicy) {
        lastAgentPolicySnapshot = {
          ...lastAgentPolicySnapshot,
          ...r.agentPolicy,
          autoConfirmTools: normalizePolicyToolList(r.agentPolicy.autoConfirmTools),
          forbiddenTools: normalizePolicyToolList(r.agentPolicy.forbiddenTools),
        };
      }
    } catch {
      /* ignore */
    }
    renderRememberedLowRiskPolicy(lastAgentPolicySnapshot);
    return lastAgentPolicySnapshot;
  }

  async function saveRememberedLowRiskTool(toolName) {
    const name = String(toolName || '').trim();
    if (!name || !agent || typeof agent.savePolicy !== 'function') return false;
    const current = await loadAgentPolicySnapshot();
    const nextAuto = new Set(normalizePolicyToolList(current.autoConfirmTools));
    nextAuto.add(name);
    const r = await agent.savePolicy({
      autoConfirmTools: [...nextAuto].sort(),
    });
    if (r && r.ok && r.agentPolicy) {
      lastAgentPolicySnapshot = {
        ...lastAgentPolicySnapshot,
        ...r.agentPolicy,
        autoConfirmTools: normalizePolicyToolList(r.agentPolicy.autoConfirmTools),
        forbiddenTools: normalizePolicyToolList(r.agentPolicy.forbiddenTools),
      };
      renderRememberedLowRiskPolicy(lastAgentPolicySnapshot);
      return true;
    }
    return false;
  }

  async function revokeRememberedLowRiskTool(toolName) {
    const name = String(toolName || '').trim();
    if (!name || !agent || typeof agent.savePolicy !== 'function') return false;
    const current = await loadAgentPolicySnapshot();
    const nextAuto = normalizePolicyToolList(current.autoConfirmTools).filter((item) => item !== name);
    const r = await agent.savePolicy({
      autoConfirmTools: nextAuto,
    });
    if (r && r.ok && r.agentPolicy) {
      lastAgentPolicySnapshot = {
        ...lastAgentPolicySnapshot,
        ...r.agentPolicy,
        autoConfirmTools: normalizePolicyToolList(r.agentPolicy.autoConfirmTools),
        forbiddenTools: normalizePolicyToolList(r.agentPolicy.forbiddenTools),
      };
      renderRememberedLowRiskPolicy(lastAgentPolicySnapshot);
      emitCopilotTimelineEvent({ source: 'user', title: '已撤销低风险授权：' + name, status: 'done' });
      setStatus('已撤销：' + name);
      setTimeout(() => setStatus(''), 1600);
      return true;
    }
    return false;
  }

  function ensureBrainStateCard() {
    if (brainStateCard && brainStateEls) return brainStateEls;
    const body = root.querySelector('.copilot-body');
    if (!body) return null;
    const card = document.createElement('div');
    card.className = 'copilot-status-card';
    card.hidden = true;

    const top = document.createElement('div');
    top.className = 'copilot-status-row';
    const main = document.createElement('div');
    main.className = 'copilot-status-main';
    const dot = document.createElement('span');
    dot.className = 'copilot-status-dot';
    const title = document.createElement('span');
    title.textContent = 'Brain status';
    main.appendChild(dot);
    main.appendChild(title);
    const mode = document.createElement('span');
    mode.className = 'copilot-status-sub';
    top.appendChild(main);
    top.appendChild(mode);

    const sub = document.createElement('div');
    sub.className = 'copilot-status-sub';

    const actions = document.createElement('div');
    actions.className = 'copilot-status-actions';
    const useCodex = document.createElement('button');
    useCodex.type = 'button';
    useCodex.className = 'copilot-mini-btn';
    useCodex.textContent = '\u4e00\u952e\u914d\u7f6e';
    const testCodex = document.createElement('button');
    testCodex.type = 'button';
    testCodex.className = 'copilot-mini-btn';
    testCodex.textContent = 'Test';
    const openSettings = document.createElement('button');
    openSettings.type = 'button';
    openSettings.className = 'copilot-mini-btn';
    openSettings.textContent = 'Settings';
    useCodex.textContent = '\u4e00\u952e\u914d\u7f6e';
    testCodex.textContent = '\u68c0\u6d4b';
    openSettings.textContent = '\u8bbe\u7f6e';
    actions.appendChild(useCodex);
    actions.appendChild(testCodex);
    actions.appendChild(openSettings);

    const modes = document.createElement('div');
    modes.className = 'copilot-permission-actions';
    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'copilot-mode-btn';
    askBtn.textContent = 'Ask';
    const sandboxBtn = document.createElement('button');
    sandboxBtn.type = 'button';
    sandboxBtn.className = 'copilot-mode-btn';
    sandboxBtn.textContent = 'Sandbox';
    const fullBtn = document.createElement('button');
    fullBtn.type = 'button';
    fullBtn.className = 'copilot-mode-btn';
    fullBtn.textContent = 'Auto';
    askBtn.textContent = 'Ask';
    sandboxBtn.textContent = 'Sandbox';
    fullBtn.textContent = 'Auto';
    modes.appendChild(askBtn);
    modes.appendChild(sandboxBtn);
    modes.appendChild(fullBtn);

    const rememberedPolicy = document.createElement('div');
    rememberedPolicy.className = 'copilot-policy-memory';

    card.appendChild(top);
    card.appendChild(sub);
    card.appendChild(actions);
    card.appendChild(modes);
    card.appendChild(rememberedPolicy);
    body.insertBefore(card, body.firstChild);

    useCodex.addEventListener('click', () => void refreshTeamCodexAndTest(useCodex));
    testCodex.addEventListener('click', () => void refreshBrainStateCard({ forceProbe: true, toast: true }));
    openSettings.addEventListener('click', () => {
      if (typeof shell.setShellView === 'function') void shell.setShellView('settings');
      if (typeof window.__acApplyShellViewFromMain === 'function') {
        void window.__acApplyShellViewFromMain('settings');
      }
    });
    askBtn.addEventListener('click', () => void setPermissionMode('ask'));
    sandboxBtn.addEventListener('click', () => void setPermissionMode('sandbox'));
    fullBtn.addEventListener('click', () => void setPermissionMode('full'));

    brainStateCard = card;
    brainStateEls = { dot, title, mode, sub, useCodex, testCodex, askBtn, sandboxBtn, fullBtn, rememberedPolicy };
    renderRememberedLowRiskPolicy(lastAgentPolicySnapshot);
    return brainStateEls;
  }

  function toggleBrainStateCard(forceOpen) {
    const els = ensureBrainStateCard();
    if (!els || !brainStateCard) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : Boolean(brainStateCard.hidden);
    brainStateCard.hidden = !open;
    if (brainSettingsBtn) brainSettingsBtn.classList.toggle('is-active', open);
    if (open) void refreshBrainStateCard();
  }

  function updatePermissionButtons(mode) {
    const els = ensureBrainStateCard();
    if (!els) return;
    els.askBtn.classList.toggle('is-active', mode === 'ask' || !mode);
    els.sandboxBtn.classList.toggle('is-active', mode === 'sandbox');
    els.fullBtn.classList.toggle('is-active', mode === 'full');
  }

  async function setPermissionMode(mode) {
    if (!agent || typeof agent.saveSettings !== 'function') return;
    setStatus('Saving permission mode...');
    try {
      const r = await agent.saveSettings({ codexPermissionMode: mode });
      if (r && r.ok && typeof agent.savePolicy === 'function') {
        await agent.savePolicy({
          confirmTools: mode !== 'full',
        });
      }
      if (r && r.ok) {
        lastSettingsSnapshot = r.settings || lastSettingsSnapshot;
        updatePermissionButtons(mode);
        await refreshBrainStateCard();
        setStatus('Permission mode: ' + permissionModeLabel(mode));
        setTimeout(() => setStatus(''), 1600);
      }
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
    }
  }

  async function syncPolicyForPermissionMode(mode) {
    if (!agent || typeof agent.savePolicy !== 'function') return;
    const normalized = mode === 'full' ? 'full' : mode === 'sandbox' ? 'sandbox' : 'ask';
    if (permissionPolicySyncedForMode === normalized) return;
    permissionPolicySyncedForMode = normalized;
    try {
      await agent.savePolicy({
        confirmTools: normalized !== 'full',
      });
    } catch {
      permissionPolicySyncedForMode = '';
    }
  }

  async function switchToCodex() {
    if (!agent || typeof agent.saveSettings !== 'function') return;
    setStatus('Switching to Codex...');
    try {
      const r = await agent.saveSettings({ defaultBrainId: 'codex' });
      if (r && r.ok) {
        lastSettingsSnapshot = r.settings || lastSettingsSnapshot;
        await refreshBrainStateCard({ forceProbe: true });
        await refreshBrainLabel();
        await refreshOnboardingState();
        setStatus('Switched to Codex');
        setTimeout(() => setStatus(''), 1800);
      }
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
    }
  }

  async function refreshTeamCodexAndTest(btn) {
    if (!agent || typeof agent.saveSettings !== 'function') return;
    if (btn) btn.disabled = true;
    activeCodexSetupRunId = 'copilot-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    setStatus('\u6b63\u5728\u914d\u7f6e Codex...');
    try {
      let setup = null;
      if (typeof agent.setupCodex === 'function') {
        setup = await setupCodexWithLoginRecovery({
          install: true,
          progressRunId: activeCodexSetupRunId,
          verifyConversation: true,
        });
      } else {
        if (typeof agent.syncCodexAuth === 'function') {
          const sync = await agent.syncCodexAuth();
          if (sync && sync.ok === false && !sync.skipped) {
            setStatus('\u56e2\u961f\u51ed\u636e\u5237\u65b0\u5931\u8d25: ' + (sync.error || 'check settings'));
            return;
          }
        }
        await agent.saveSettings({ defaultBrainId: 'codex' });
      }
      lastProbeSnapshot = null;
      await refreshBrainLabel();
      await refreshBrainStateCard({ forceProbe: true, toast: true });
      await refreshOnboardingState();
      if (setup && setup.ok === false) {
        await requestShellUpdateCheckForCodexSetup(setup);
        setStatus(codexSetupFailureMessage(setup));
        return;
      }
      const checksText = formatCodexSetupChecks(setup);
      setStatus(checksText ? 'Codex \u5df2\u5c31\u7eea \u00b7 ' + checksText : 'Codex \u5df2\u5c31\u7eea');
      setTimeout(() => setStatus(''), 1800);
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function codexSetupFailureMessage(setup) {
    const r = setup && typeof setup === 'object' ? setup : {};
    const checks = Array.isArray(r.setupChecks) ? r.setupChecks : [];
    const failedWithAction = checks.find((check) => check && !check.ok && check.nextAction);
    if (failedWithAction && failedWithAction.nextAction) return String(failedWithAction.nextAction);
    const install = r.install || {};
    const probe = r.probe || {};
    if (install.error === 'npm_missing') return '\u81ea\u52a8\u5b89\u88c5 Node/npm \u672a\u5b8c\u6210\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216\u7cfb\u7edf\u5b89\u88c5\u6743\u9650\u540e\u518d\u70b9\u4e00\u6b21\u3002';
    if (install.error === 'codex_install_failed') return 'Codex CLI \u5b89\u88c5\u5931\u8d25\uff0c\u5df2\u5c1d\u8bd5\u7cfb\u7edf npm \u548c\u4fbf\u643a npm\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216\u4ee3\u7406\u3002';
    if (r.cloudAuthLoginRequired) return '\u8bf7\u5148\u767b\u5f55\u5de5\u4f5c\u53f0\uff0c\u518d\u70b9\u4e00\u6b21\u4e00\u952e\u914d\u7f6e\u3002';
    if (r.cloudAuthRouteMissing) return '\u4e91\u7aef Codex \u8eab\u4efd\u63a5\u53e3\u8fd8\u672a\u4e0a\u7ebf\uff0c\u8bf7\u7ba1\u7406\u5458\u5148\u53d1\u5e03\u65b0\u7248 auth-api\u3002';
    if (r.cloudAuthNotConfigured) return '\u4e91\u7aef\u56e2\u961f Codex \u8eab\u4efd\u8fd8\u672a\u914d\u7f6e\u3002';
    if (r.needsLogin) return 'Codex \u9700\u8981\u767b\u5f55\u3002\u8bf7\u6253\u5f00 Codex \u5b8c\u6210\u767b\u5f55\uff0c\u518d\u70b9\u4e00\u6b21\u3002';
    return probe.detail || r.error || 'Codex \u4ecd\u672a\u5c31\u7eea\u3002';
  }

  function codexLastSetupRecoveryDetail(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const report = s.codexLastSetupReport && typeof s.codexLastSetupReport === 'object' ? s.codexLastSetupReport : null;
    const checks = report && Array.isArray(report.checks) ? report.checks : [];
    const failed = checks.find((check) => check && !check.ok && check.nextAction);
    if (failed && failed.nextAction) return String(failed.nextAction);
    if (report && report.ok === false) return 'Click one-click Codex setup again; it will re-check this machine, install missing pieces, sync team identity, and test the conversation.';
    return '';
  }

  function codexLastSetupReportAllowsSend(settings, runtime) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const report = s.codexLastSetupReport && typeof s.codexLastSetupReport === 'object' ? s.codexLastSetupReport : null;
    const rt = runtime && typeof runtime === 'object' ? runtime : {};
    return Boolean(
      report &&
      report.ok &&
      report.cloudIdentitySynced &&
      report.conversationVerified &&
      rt.readyHint &&
      rt.auth &&
      rt.auth.exists,
    );
  }

  async function ensureCodexReadyBeforeSend() {
    if (!agent || typeof agent.setupCodex !== 'function') return { ok: true, skipped: true };
    const loadRuntime = typeof agent.runtimeStatus === 'function'
      ? agent.runtimeStatus
      : typeof agent.loadSettings === 'function'
        ? agent.loadSettings
        : null;
    if (!loadRuntime) return { ok: true, skipped: true };
    const s = await loadRuntime();
    if (!s || s.ok === false) return { ok: true, skipped: true };
    const desired = (s.settings && s.settings.defaultBrainId) || 'codex';
    const active = s.activeBrainId || desired;
    const codexMeta = Array.isArray(s.brainMetas) ? s.brainMetas.find((b) => b && b.id === 'codex') : null;
    const probeOk = Boolean(codexMeta && codexMeta.lastProbeOk);
    if (desired !== 'codex') return { ok: true, skipped: true };
    if (active === 'codex' && probeOk) return { ok: true, skipped: true };
    if (active === 'codex' && codexLastSetupReportAllowsSend(s.settings, s.codexRuntime)) {
      return { ok: true, skipped: true, trustedSetupReport: true };
    }
    activeCodexSetupRunId = 'send-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    setStatus('\u6b63\u5728\u914d\u7f6e Codex...');
    const setup = await setupCodexWithLoginRecovery({
      install: true,
      progressRunId: activeCodexSetupRunId,
      verifyConversation: false,
    });
    lastProbeSnapshot = null;
    await refreshBrainLabel();
    await refreshBrainStateCard({ forceProbe: true });
    await refreshOnboardingState();
    if (setup && setup.ok) return { ok: true, setup };
    await requestShellUpdateCheckForCodexSetup(setup);
    return { ok: false, setup, error: codexSetupFailureMessage(setup) };
  }

  async function refreshBrainStateCard(options) {
    const els = ensureBrainStateCard();
    if (!els || !agent || typeof agent.loadSettings !== 'function') return;
    try {
      const s = await agent.loadSettings();
      if (!s || !s.ok) return;
      lastSettingsSnapshot = s.settings || {};
      let probeResp = null;
      if ((options && options.forceProbe) || !lastProbeSnapshot || s.activeBrainId !== lastProbeSnapshot.brainId) {
        probeResp = typeof agent.probeBrain === 'function' ? await agent.probeBrain() : null;
        lastProbeSnapshot = probeResp || lastProbeSnapshot;
      } else {
        probeResp = lastProbeSnapshot;
      }
      const desired = (s.settings && s.settings.defaultBrainId) || 'stub';
      const active = s.activeBrainId || desired;
      const probe = probeResp && probeResp.probe ? probeResp.probe : null;
      const ok = Boolean(probe && probe.ok && active === desired);
      els.dot.className = 'copilot-status-dot ' + (ok ? 'is-ok' : probe && probe.ok ? 'is-warn' : 'is-bad');
      els.title.textContent = desired === active ? desired : desired + ' -> ' + active;
      const permissionMode = (s.settings && s.settings.codexPermissionMode) || 'ask';
      void syncPolicyForPermissionMode(permissionMode);
      void loadAgentPolicySnapshot();
      els.mode.textContent = permissionModeLabel(permissionMode);
      const cwd = s.settings && s.settings.codexCwd ? s.settings.codexCwd : '';
      const detail = probe && probe.detail ? probe.detail : 'not detected';
      els.sub.textContent =
        'Codex: ' + detail + (cwd ? '\nCWD: ' + cwd : '') + (desired !== active ? '\nFallback is active. Test or switch back to Codex.' : '');
      updatePermissionButtons(permissionMode);
      if (options && options.toast) {
        setStatus(ok ? 'Codex ready' : detail);
        setTimeout(() => setStatus(''), 2200);
      }
    } catch (e) {
      els.dot.className = 'copilot-status-dot is-bad';
      els.sub.textContent = e && e.message ? e.message : String(e);
    }
  }

  function removeOnboardCard() {
    if (onboardEl && onboardEl.parentNode) {
      onboardEl.parentNode.removeChild(onboardEl);
    }
    onboardEl = null;
  }

  function showExampleChips(show) {
    if (!examplesEl) return;
    examplesEl.innerHTML = '';
    if (!show) {
      examplesEl.hidden = true;
      return;
    }
    examplesEl.hidden = false;
    const phrases = EXAMPLE_PHRASES.slice();
    for (const phrase of phrases) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'copilot-example-chip';
      chip.textContent = phrase;
      chip.addEventListener('click', () => {
        inputEl.value = phrase;
        inputEl.focus();
      });
      examplesEl.appendChild(chip);
    }
  }

  function showOnboardCard(detail, opts) {
    if (!messagesEl) return;
    const options = opts && typeof opts === 'object' ? opts : {};
    const sourceOpts = options; // opts.blockers opts.teamEntrance opts.workflowPublication opts.usageAudit
    const ready = detail === undefined || detail === null || detail === '';
    const account = sourceOpts.account && typeof sourceOpts.account === 'object' ? sourceOpts.account : lastAccountSnapshot;
    const accountReady = Boolean(account && account.loggedIn);
    const entrance = sourceOpts.workbenchEntrance && typeof sourceOpts.workbenchEntrance === 'object'
      ? sourceOpts.workbenchEntrance
      : lastWorkbenchEntranceSnapshot;
    const acceptance = sourceOpts.workbenchAcceptance && typeof sourceOpts.workbenchAcceptance === 'object'
      ? sourceOpts.workbenchAcceptance
      : lastWorkbenchAcceptanceSnapshot;
    const teamEntrance = sourceOpts.teamEntrance && typeof sourceOpts.teamEntrance === 'object'
      ? sourceOpts.teamEntrance
      : lastTeamEntranceSnapshot;
    const workflowPublication =
      sourceOpts.workflowPublication && typeof sourceOpts.workflowPublication === 'object' ? sourceOpts.workflowPublication : null;
    const usageAudit = sourceOpts.usageAudit && typeof sourceOpts.usageAudit === 'object' ? sourceOpts.usageAudit : null;
    const blockers = Array.isArray(sourceOpts.blockers) ? sourceOpts.blockers : [];
    const entranceStatus = entrance && entrance.status ? String(entrance.status) : accountReady ? 'ready' : 'login_required';
    const entranceReady = entranceStatus === 'ready';
    const teamEntranceReady = Boolean(teamEntrance && teamEntrance.ready);
    const teamEntrancePhase = teamEntrance && teamEntrance.phase ? String(teamEntrance.phase) : '';
    const entranceLabels = {
      ready: 'Copilot \u5df2\u5c31\u7eea',
      login_required: '\u5de5\u4f5c\u53f0\u5f85\u767b\u5f55',
      e2e_missing: '\u5de5\u4f5c\u53f0\u9a8c\u6536\u7f3a\u5931',
      e2e_stale: '\u5de5\u4f5c\u53f0\u9a8c\u6536\u5df2\u8fc7\u671f',
      e2e_failed: '\u5de5\u4f5c\u53f0\u9a8c\u6536\u5931\u8d25',
      e2e_invalid: '\u5de5\u4f5c\u53f0\u9a8c\u6536\u65e0\u6548',
      mcp_unavailable: 'MCP \u672a\u8fde\u63a5',
    };
    if (onboardEl && onboardEl.parentNode) onboardEl.remove();
    const card = document.createElement('div');
    card.className = 'copilot-onboard';
    onboardEl = card;
    const title = document.createElement('div');
    title.className = 'copilot-onboard-title';
    title.textContent = ready ? (accountReady ? 'Copilot \u5df2\u5c31\u7eea' : '\u5de5\u4f5c\u53f0\u767b\u5f55\u5f85\u5b8c\u6210') : '\u9700\u8981\u914d\u7f6e';
    const desc = document.createElement('div');
    desc.className = 'copilot-onboard-desc';
    desc.textContent = ready
      ? accountReady
        ? '\u53ef\u4ee5\u76f4\u63a5\u8ba9 Copilot \u68c0\u67e5\u9879\u76ee\u3001\u542f\u52a8\u5de5\u4f5c\u53f0\u3001\u4fee\u590d\u62a5\u9519\u6216\u6574\u7406\u5f53\u524d\u9879\u76ee\u3002'
        : 'Copilot \u5927\u8111\u5df2\u5c31\u7eea\uff0c\u4f46\u5de5\u4f5c\u53f0\u5171\u4eab\u767b\u5f55\u6001\u8fd8\u4e0d\u53ef\u7528\u3002'
      : String(detail || 'Codex is not ready yet. Refresh team credentials and test the connection.');
    if (ready) {
      const teamEntranceLabels = {
        ready: 'Copilot \u5df2\u5c31\u7eea',
        workbench_blocked: '\u5de5\u4f5c\u53f0\u5165\u53e3\u5f85\u6536\u53e3',
        governance_blocked: '\u56e2\u961f\u6cbb\u7406\u5f85\u6536\u53e3',
      };
      title.textContent = teamEntranceLabels[teamEntrancePhase] || entranceLabels[entranceStatus] || '\u5de5\u4f5c\u53f0\u5165\u53e3\u5f85\u786e\u8ba4';
      desc.textContent = teamEntranceReady
        ? '\u53ef\u4ee5\u76f4\u63a5\u8ba9 Copilot \u68c0\u67e5\u9879\u76ee\u3001\u542f\u52a8\u5de5\u4f5c\u53f0\u3001\u4fee\u590d\u62a5\u9519\u6216\u6574\u7406\u5f53\u524d\u9879\u76ee\u3002'
        : teamEntrancePhase === 'governance_blocked'
          ? '\u5de5\u4f5c\u53f0\u94fe\u8def\u53ef\u7528\uff0c\u4f46\u56e2\u961f\u53d1\u5e03\u6cbb\u7406\u3001\u989d\u5ea6\u6216\u4e91\u7aef\u5ba1\u8ba1\u4ecd\u9700\u7ba1\u7406\u5458\u6536\u53e3\u3002'
          : entrance && entrance.nextStep
            ? String(entrance.nextStep)
            : 'Copilot \u5927\u8111\u5df2\u5c31\u7eea\uff0c\u4f46\u5de5\u4f5c\u53f0\u5165\u53e3\u8fd8\u9700\u8981\u5b8c\u6210\u767b\u5f55\u6216\u9a8c\u6536\u3002';
    }
    card.appendChild(title);
    card.appendChild(desc);

    if (ready) {
      const blockerList = document.createElement('div');
      blockerList.className = 'copilot-onboard-desc';
      const blockerLabels = {
        workbench_login_required: '\u5de5\u4f5c\u53f0\u767b\u5f55\u672a\u5b8c\u6210',
        workbench_e2e_failed: '\u5de5\u4f5c\u53f0\u94fe\u8def\u9a8c\u6536\u5931\u8d25',
        workbench_e2e_missing: '\u5de5\u4f5c\u53f0\u94fe\u8def\u5f85\u9a8c\u6536',
        workbench_e2e_stale: '\u5de5\u4f5c\u53f0\u94fe\u8def\u9a8c\u6536\u5df2\u8fc7\u671f',
        workflow_promotion_draft_only: 'Workflow \u4ecd\u662f\u8349\u7a3f\u9636\u6bb5',
        usage_governance_local_only: '\u7528\u91cf\u6cbb\u7406\u4ecd\u662f\u672c\u5730\u4fe1\u53f7',
        codex_runtime_not_ready: 'Codex \u8fd0\u884c\u73af\u5883\u5f85\u786e\u8ba4',
        mcp_unavailable: 'MCP \u672a\u8fde\u63a5',
      };
      const blockerText = blockers
        .slice(0, 3)
        .map((blocker) => blockerLabels[String(blocker && blocker.id ? blocker.id : '')] || String(blocker && blocker.id ? blocker.id : 'unknown'))
        .join(' / ');
      const lines = [];
      if (blockerText) lines.push(blockerText);
      const blockerActions = blockers.flatMap((blocker) => formatBlockerActions(blocker, 2)).slice(0, 4);
      if (blockerActions.length) lines.push('Actions: ' + blockerActions.join(', '));
      const workflowBlocker = blockers.find((blocker) => blocker && blocker.id === 'workflow_promotion_draft_only');
      const workflowMissing = Array.isArray(workflowBlocker && workflowBlocker.missingGates)
        ? workflowBlocker.missingGates
            .map((gate) => {
              const id = String(gate || '');
              if (id === 'workbench_login_e2e_ready') return 'Workbench E2E';
              if (id === 'admin_confirmation') return 'admin approval';
              return id;
            })
            .filter(Boolean)
            .slice(0, 2)
        : [];
      if (workflowMissing.length) lines.push('Workflow gates: ' + workflowMissing.join(', '));
      const promotionEvidence = workflowPublication && workflowPublication.promotionPreflightEvidence
        ? workflowPublication.promotionPreflightEvidence
        : null;
      const latestPromotionEvidence = promotionEvidence && promotionEvidence.latest ? promotionEvidence.latest : null;
      if (latestPromotionEvidence) {
        const missing = Array.isArray(latestPromotionEvidence.missingGates)
          ? latestPromotionEvidence.missingGates.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2)
          : [];
        lines.push(
          'Workflow evidence: ' +
            (latestPromotionEvidence.tool || 'promotion') +
            (latestPromotionEvidence.skillExists === false ? ' deleted draft' : '') +
            (latestPromotionEvidence.evidenceCurrent === false ? ' stale ' + (latestPromotionEvidence.staleReason || 'not_current') : '') +
            (missing.length ? ' missing ' + missing.join(', ') : ''),
        );
      }
      const usageBlocker = blockers.find((blocker) => blocker && blocker.id === 'usage_governance_local_only');
      if (usageBlocker && usageBlocker.cloudDraft) {
        const usageUploadTool = usageBlocker.cloudDraft.uploadPlan && usageBlocker.cloudDraft.uploadPlan.tool
          ? String(usageBlocker.cloudDraft.uploadPlan.tool)
          : 'ac.usage.upload_cloud_draft';
        lines.push('Usage upload: ' + usageUploadTool);
        const usageQuotaPolicy = usageBlocker.cloudDraft.quotaPolicy && typeof usageBlocker.cloudDraft.quotaPolicy === 'object'
          ? usageBlocker.cloudDraft.quotaPolicy
          : null;
        if (usageQuotaPolicy) lines.push('Usage quota: ' + (usageQuotaPolicy.cloudQuotaEnforced ? 'enforced' : 'not enforced'));
        if (usageQuotaPolicy && usageQuotaPolicy.probeTool) lines.push('Usage policy probe: ' + usageQuotaPolicy.probeTool);
        const usageBlockedBy = Array.isArray(usageBlocker.cloudDraft.blockedBy)
          ? usageBlocker.cloudDraft.blockedBy.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2)
          : [];
        if (usageBlockedBy.length) lines.push('Usage blockers: ' + usageBlockedBy.join(', '));
      }
      const usageEvidence = usageAudit && usageAudit.governanceEvidence ? usageAudit.governanceEvidence : null;
      const latestUsageEvidence = usageEvidence && usageEvidence.latest ? usageEvidence.latest : null;
      if (latestUsageEvidence) {
        const usageRemaining = Array.isArray(latestUsageEvidence.remainingGates)
          ? latestUsageEvidence.remainingGates.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2)
          : [];
        lines.push(
          'Usage evidence: ' +
            (latestUsageEvidence.code || (latestUsageEvidence.ok ? 'ok' : 'not_ok')) +
            (latestUsageEvidence.exitReady ? ' exit ready' : '') +
            (usageRemaining.length ? ' remaining ' + usageRemaining.join(', ') : ''),
        );
      }
      if (acceptance) lines.push('Workbench acceptance: ' + (acceptance.passed ? 'accepted' : 'not accepted'));
      if (account) lines.push('Account: ' + formatTeamAccountDiagnostics(account));
      if (lines.length) {
        blockerList.textContent = lines.join(' / ');
        card.appendChild(blockerList);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'copilot-onboard-actions';
    if (!accountReady) {
      const loginBtn = document.createElement('button');
      loginBtn.type = 'button';
      loginBtn.className = 'copilot-onboard-btn is-primary';
      loginBtn.textContent = '\u6253\u5f00\u5de5\u4f5c\u53f0\u767b\u5f55';
      loginBtn.addEventListener('click', () => {
        switchToWorkbench();
        void (async () => {
          loginBtn.disabled = true;
          const login = await waitForTeamAccountLogin(120000);
          loginBtn.disabled = false;
          if (login && login.loggedIn) setStatus('\u767b\u5f55\u540e\u9a8c\u6536 ' + formatTeamAccountDiagnostics(login));
          await refreshOnboardingState();
        })();
      });
      actions.appendChild(loginBtn);
    }
    const validateBtn = document.createElement('button');
    validateBtn.type = 'button';
    validateBtn.className = accountReady ? 'copilot-onboard-btn is-primary' : 'copilot-onboard-btn';
    validateBtn.textContent = accountReady
      ? '\u8fd0\u884c\u5de5\u4f5c\u53f0\u9a8c\u6536'
      : entranceStatus !== 'login_required'
        ? '\u6253\u5f00\u8bbe\u7f6e\u9a8c\u6536'
        : '\u767b\u5f55\u540e\u9a8c\u6536';
    validateBtn.addEventListener('click', () => {
      void (async () => {
        validateBtn.disabled = true;
        if (!accountReady) {
          switchToWorkbench();
          const login = await waitForTeamAccountLogin(120000);
          await runWorkbenchEntranceValidation(validateBtn, login && login.loggedIn ? {} : { recoveryWaitMs: 30000 });
        } else {
          await runWorkbenchEntranceValidation(validateBtn, {});
        }
        validateBtn.disabled = false;
      })();
    });
    actions.appendChild(validateBtn);
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'copilot-onboard-btn';
    settingsBtn.textContent = '\u6253\u5f00\u8bbe\u7f6e';
    settingsBtn.addEventListener('click', openCopilotSettings);
    actions.appendChild(settingsBtn);
    card.appendChild(actions);
    if (ready && blockers.length) appendBlockerActionButtons(actions, blockers);
    messagesEl.appendChild(card);
    scrollMessagesToBottom();
  }

  function showMemberOnboardCard(detail, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    if (options.ready === false) {
      showOnboardCard(detail, options);
      return;
    }
    showLongWorkHomeCard(detail, options);
  }

  function showLongWorkHomeCard(detail, opts) {
    if (!messagesEl) return;
    const options = opts && typeof opts === 'object' ? opts : {};
    const account = options.account && typeof options.account === 'object' ? options.account : lastAccountSnapshot;
    const accountReady = Boolean(account && account.loggedIn);
    const entrance = options.workbenchEntrance && typeof options.workbenchEntrance === 'object'
      ? options.workbenchEntrance
      : lastWorkbenchEntranceSnapshot;
    const acceptance = options.workbenchAcceptance && typeof options.workbenchAcceptance === 'object'
      ? options.workbenchAcceptance
      : lastWorkbenchAcceptanceSnapshot;
    const teamEntrance = options.teamEntrance && typeof options.teamEntrance === 'object' ? options.teamEntrance : lastTeamEntranceSnapshot;
    const blockers = Array.isArray(options.blockers) ? options.blockers : [];
    const workbenchContext = options.workbenchContext && typeof options.workbenchContext === 'object'
      ? options.workbenchContext
      : lastWorkbenchContextSnapshot;
    const recentExecutions = Array.isArray(options.recentExecutions) ? options.recentExecutions : lastToolExecutionsSnapshot;
    const projectMemory = options.projectMemory && typeof options.projectMemory === 'object'
      ? options.projectMemory
      : lastProjectMemorySnapshot;
    const contextSummary = summarizeWorkbenchContext(workbenchContext, recentExecutions);
    const memorySummary = summarizeProjectMemorySnapshot(projectMemory);
    const entranceStatus = entrance && entrance.status ? String(entrance.status) : accountReady ? 'ready' : 'login_required';
    const entranceReady = entranceStatus === 'ready' || Boolean(acceptance && acceptance.passed);
    const agentReady = detail === undefined || detail === null || detail === '';
    const governanceReady = governanceReadyFrom(blockers, teamEntrance);

    if (onboardEl && onboardEl.parentNode) onboardEl.remove();
    const card = document.createElement('div');
    card.className = 'copilot-onboard copilot-work-home';
    onboardEl = card;

    const header = document.createElement('div');
    header.className = 'copilot-work-home-header';
    header.appendChild(makeCopilotText('copilot-work-home-title', 'Copilot \u5de5\u4f5c\u5165\u53e3'));
    header.appendChild(
      makeCopilotText(
        'copilot-work-home-subtitle',
        '\u56e2\u961f\u4ece\u8fd9\u91cc\u8fdb\u5165\u5de5\u4f5c\u53f0\uff0c\u8ba9 Agent \u590d\u7528\u9879\u76ee\u3001\u8d44\u4ea7\u3001\u6743\u9650\u548c\u7528\u91cf\u6cbb\u7406\u3002',
      ),
    );
    card.appendChild(header);

    const statusGrid = document.createElement('div');
    statusGrid.className = 'copilot-work-status-grid';
    appendStatusPill(statusGrid, '\u8d26\u53f7', accountReady ? '\u5df2\u767b\u5f55' : '\u5f85\u767b\u5f55', accountReady ? 'is-ok' : 'is-warn');
    appendStatusPill(
      statusGrid,
      '\u5de5\u4f5c\u53f0',
      entranceReady ? '\u53ef\u7528' : '\u5f85\u9a8c\u6536',
      entranceReady ? 'is-ok' : 'is-warn',
    );
    appendStatusPill(statusGrid, 'Agent', agentReady ? '\u5df2\u63a5\u5165' : '\u5f85\u914d\u7f6e', agentReady ? 'is-ok' : 'is-bad');
    appendStatusPill(
      statusGrid,
      '\u6cbb\u7406',
      governanceReady ? '\u53ef\u8ffd\u8e2a' : '\u5f85\u6536\u53e3',
      governanceReady ? 'is-ok' : 'is-warn',
    );
    card.appendChild(statusGrid);

    const context = document.createElement('div');
    context.className = 'copilot-work-context';
    context.appendChild(makeCopilotText('copilot-work-section-title', '\u5f53\u524d\u4e0a\u4e0b\u6587'));
    const contextGrid = document.createElement('div');
    contextGrid.className = 'copilot-work-context-grid';
    contextGrid.appendChild(makeCopilotText('copilot-work-context-item', '\u9879\u76ee\uff1a' + contextSummary.projectLabel));
    contextGrid.appendChild(makeCopilotText('copilot-work-context-item', '\u8d44\u4ea7\uff1a' + contextSummary.assetLabel));
    contextGrid.appendChild(makeCopilotText('copilot-work-context-item', '\u80fd\u529b\uff1a' + contextSummary.capabilityLabel));
    contextGrid.appendChild(makeCopilotText('copilot-work-context-item', '\u6700\u8fd1\u4efb\u52a1\uff1a' + contextSummary.taskLabel));
    contextGrid.appendChild(makeCopilotText('copilot-work-context-item is-memory', '\u9879\u76ee\u8bb0\u5fc6\uff1a' + memorySummary.label));
    if (memorySummary.latestText) {
      contextGrid.appendChild(makeCopilotText('copilot-work-context-item is-memory-latest', '\u6700\u8fd1\u6c89\u6dc0\uff1a' + memorySummary.latestText));
    }
    context.appendChild(contextGrid);
    card.appendChild(context);

    const actions = document.createElement('div');
    actions.className = 'copilot-work-actions';
    actions.appendChild(
      makeCopilotButton(
        accountReady ? '\u6253\u5f00\u5de5\u4f5c\u53f0' : '\u767b\u5f55\u5de5\u4f5c\u53f0',
        'copilot-onboard-btn is-primary',
        () => {
          switchToWorkbench();
          if (!accountReady) {
            void (async () => {
              await waitForTeamAccountLogin(120000);
              await refreshOnboardingState();
            })();
          }
        },
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u521b\u5efa\u9879\u76ee', 'copilot-onboard-btn', () =>
        startCopilotWorkTask('Prepare Workbench, create a new project, then return the project status and next required inputs.'),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u8fd0\u884c\u80fd\u529b', 'copilot-onboard-btn', () =>
        startCopilotWorkTask(
          'Prepare Workbench, choose one directly runnable capability, explain required inputs, and stop before running if anything is missing.',
        ),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u770b\u8d44\u4ea7', 'copilot-onboard-btn', () =>
        startCopilotWorkTask('Read the current Workbench project context and list recent assets.'),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u8dd1\u901a\u94fe\u8def', 'copilot-onboard-btn', () =>
        startCopilotWorkTask(
          'Use ac.workbench.ensure_ready with requireProject=true and createIfMissing=true, then get Workbench context, list assets, and return a concise result card with next actions.',
        ),
      ),
    );
    actions.appendChild(
      makeCopilotButton('\u9a8c\u6536\u94fe\u8def', 'copilot-onboard-btn', () => {
        void runWorkbenchEntranceValidation(null, accountReady ? {} : { recoveryWaitMs: 30000 });
      }),
    );
    actions.appendChild(makeCopilotButton('\u8bbe\u7f6e', 'copilot-onboard-btn', openCopilotSettings));
    card.appendChild(actions);

    const saveOutlet = document.createElement('div');
    saveOutlet.className = 'copilot-work-save-outlet';
    saveOutlet.appendChild(
      makeCopilotText(
        'copilot-work-save-copy',
        '\u4fdd\u5b58\u51fa\u53e3\uff1a\u7ed3\u679c\u5199\u56de\u8d44\u4ea7\u5e93\uff1b\u51b3\u7b56\u3001\u53c2\u6570\u548c\u8dd1\u901a\u6d41\u7a0b\u6c89\u6dc0\u5230\u5f53\u524d\u9879\u76ee\u3002',
      ),
    );
    const saveCurrent = makeCopilotButton('\u8bb0\u5f55\u5f53\u524d\u72b6\u6001', 'copilot-onboard-btn', (event) =>
      saveProjectMemoryFromCopilot(
        'project_note',
        [
          'Project: ' + contextSummary.projectLabel,
          'Assets: ' + contextSummary.assetLabel,
          'Capabilities: ' + contextSummary.capabilityLabel,
          'Recent task: ' + contextSummary.taskLabel,
        ].join('\n'),
        event && event.currentTarget,
      ),
    );
    saveOutlet.appendChild(saveCurrent);
    card.appendChild(saveOutlet);

    if (blockers.length) appendBlockerActionButtons(actions, blockers);
    messagesEl.appendChild(card);
    scrollMessagesToBottom();
  }

  async function refreshOnboardingState() {
    try {
      let activeId = 'stub';
      let probeResp = null;
      if (typeof agent.probeBrain === 'function') {
        probeResp = await agent.probeBrain();
        if (probeResp && probeResp.ok !== false) activeId = probeResp.brainId || activeId;
      }
      brainReady = Boolean(probeResp && probeResp.ok !== false && probeResp.probe && probeResp.probe.ok);
      let settingsResp = null;
      if (typeof agent.loadSettings === 'function') {
        settingsResp = await agent.loadSettings();
      }
      const workbenchEntrance = workbenchEntranceFromSettings(settingsResp);
      const workbenchAcceptance = workbenchAcceptanceFromSettings(settingsResp);
      const teamEntrance = teamEntranceFromSettings(settingsResp);
      const workflowPublication = workflowPublicationFromSettings(settingsResp);
      const usageAudit = usageAuditFromSettings(settingsResp);
      const blockers = blockersFromSettings(settingsResp);
      const account = await loadTeamAccountStatus();
      const workbenchContextInfo = await loadWorkbenchContextSnapshot();
      const projectMemory = await loadProjectMemorySnapshot();
      const hasMessages = messagesEl.querySelectorAll('.copilot-msg').length > 0;
      if (brainReady) {
        removeOnboardCard();
        if (!hasMessages && !turnBusy) {
          showMemberOnboardCard('', {
            ready: true,
            account,
            workbenchEntrance,
            workbenchAcceptance,
            teamEntrance,
            workflowPublication,
            usageAudit,
            blockers,
            workbenchContext: workbenchContextInfo && workbenchContextInfo.context,
            recentExecutions: workbenchContextInfo && workbenchContextInfo.executions,
            projectMemory,
          });
        }
        else if (hasMessages) showExampleChips(false);
      } else {
        showExampleChips(false);
        let detail;
        if (settingsResp) {
          const s = settingsResp;
          const oneClickRecovery = codexLastSetupRecoveryDetail(s.settings);
          const wantCodex = s && s.settings && s.settings.defaultBrainId === 'codex';
          const authExists = s && s.codexAuth && s.codexAuth.exists;
          const sharedEnabled = s && s.settings && s.settings.codexSharedAuthEnabled;
          if (oneClickRecovery) {
            detail = oneClickRecovery;
          } else if (!wantCodex) {
            detail = 'Click one-click Codex setup to switch to the team-recommended Codex brain and finish setup.';
          } else if (sharedEnabled && !authExists) {
            detail = 'Click one-click Codex setup to sync team credentials to this machine.';
          } else if (!authExists) {
            detail = 'Click one-click Codex setup to pull team identity, or complete Codex login once.';
          } else if (wantCodex) {
            detail = 'Click one-click Codex setup; it will repair the Codex command path or install missing pieces.';
          }
        }
        showMemberOnboardCard(detail, { ready: false });
      }
      await refreshBrainLabel();
      await refreshBrainStateCard();
    } catch {
      /* ignore */
    }
  }

  window.__acCopilotRefreshOnboarding = () => void refreshOnboardingState();

  function registerCopilotShellListeners() {
    if (typeof shell.onCopilotOnboardingFocus === 'function') {
      shell.onCopilotOnboardingFocus(() => {
        document.body.classList.remove('shell-copilot-collapsed');
        void persistCopilotCollapsed(false);
        void refreshOnboardingState();
      });
    }
    if (typeof shell.onCopilotRefreshOnboarding === 'function') {
      shell.onCopilotRefreshOnboarding(() => {
        void refreshOnboardingState();
      });
    }
    if (typeof shell.onCopilotLayout === 'function') {
      shell.onCopilotLayout((payload) => {
        const collapsed = Boolean(payload && payload.collapsed);
        const widthPx = collapsed
          ? COPILOT_COLLAPSED_WIDTH
          : Math.max(Number(payload && payload.widthPx) || 0, COPILOT_EXPANDED_MIN_WIDTH);
        applyCopilotWidthPx(widthPx, collapsed);
        document.body.classList.toggle('shell-copilot-collapsed', collapsed);
        renderToggleIcon(collapsed);
      });
    }
  }

  /** Soft-format assistant text so Chinese walls and label lines are readable. */
  function formatCopilotAssistantText(text) {
    let t = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Break before common result labels when model forgot newlines.
    t = t.replace(/([^\n])(\s*)(资产\s*ID|类型|内容|项目\s*ID|验证|结果|下一步)\s*[：:]/g, '$1\n$3：');
    // Soft-break after Chinese sentence terminators when the next char continues the wall.
    t = t.replace(/([。！？；])(?=[^\n\s「」『』》）\]\}])/g, '$1\n');
    // Collapse 3+ blank lines.
    t = t.replace(/\n{3,}/g, '\n\n');
    return t.trimEnd();
  }

  function appendInlineMarkdown(parent, text) {
    const source = String(text || '');
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^) \n]+\))/g;
    let cursor = 0;
    let match = null;
    while ((match = pattern.exec(source))) {
      if (match.index > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith('`')) {
        const code = document.createElement('code');
        code.className = 'copilot-inline-code';
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      } else if (token.startsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else {
        const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const a = document.createElement('a');
          a.textContent = link[1];
          a.href = link[2];
          a.target = '_blank';
          a.rel = 'noreferrer noopener';
          parent.appendChild(a);
        } else {
          parent.appendChild(document.createTextNode(token));
        }
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)));
  }

  function appendInlineMarkdownWithBreaks(parent, text) {
    String(text || '').split('\n').forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      appendInlineMarkdown(parent, line);
    });
  }

  function appendCodeBlockMarkdown(parent, lang, codeText) {
    const block = document.createElement('div');
    block.className = 'copilot-code-block';
    const head = document.createElement('div');
    head.className = 'copilot-code-head';
    const label = document.createElement('span');
    label.textContent = String(lang || '').trim() || 'code';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copilot-code-copy';
    copy.textContent = '复制';
    copy.addEventListener('click', async () => {
      try {
        if (shell && typeof shell.copyText === 'function') {
          shell.copyText(codeText);
        } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(codeText);
        }
        copy.textContent = '已复制';
        setTimeout(() => {
          copy.textContent = '复制';
        }, 1400);
      } catch {
        copy.textContent = '复制失败';
        setTimeout(() => {
          copy.textContent = '复制';
        }, 1600);
      }
    });
    head.appendChild(label);
    head.appendChild(copy);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = String(codeText || '').replace(/\n$/, '');
    pre.appendChild(code);
    block.appendChild(head);
    block.appendChild(pre);
    parent.appendChild(block);
  }

  function appendMarkdownFlow(parent, text) {
    const lines = String(text || '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length + 2;
        const h = document.createElement('h' + level);
        appendInlineMarkdown(h, heading[2]);
        parent.appendChild(h);
        i += 1;
        continue;
      }
      if (/^\s*[-*_]{3,}\s*$/.test(line)) {
        parent.appendChild(document.createElement('hr'));
        i += 1;
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        const quote = document.createElement('blockquote');
        appendInlineMarkdownWithBreaks(quote, quoteLines.join('\n'));
        parent.appendChild(quote);
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const ul = document.createElement('ul');
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const li = document.createElement('li');
          appendInlineMarkdown(li, lines[i].replace(/^\s*[-*]\s+/, ''));
          ul.appendChild(li);
          i += 1;
        }
        parent.appendChild(ul);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const ol = document.createElement('ol');
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          const li = document.createElement('li');
          appendInlineMarkdown(li, lines[i].replace(/^\s*\d+\.\s+/, ''));
          ol.appendChild(li);
          i += 1;
        }
        parent.appendChild(ol);
        continue;
      }
      const paragraph = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^```/.test(lines[i]) &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^\s*[-*_]{3,}\s*$/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i])
      ) {
        paragraph.push(lines[i]);
        i += 1;
      }
      const p = document.createElement('p');
      appendInlineMarkdownWithBreaks(p, paragraph.join('\n'));
      parent.appendChild(p);
    }
  }

  function renderCopilotMarkdown(el, text) {
    el.textContent = '';
    el.classList.add('copilot-markdown');
    const formatted = formatCopilotAssistantText(text);
    const lines = formatted.split('\n');
    let flow = [];
    for (let i = 0; i < lines.length; i += 1) {
      const fence = lines[i].match(/^```\s*([A-Za-z0-9_+.-]*)\s*$/);
      if (!fence) {
        flow.push(lines[i]);
        continue;
      }
      if (flow.length) {
        appendMarkdownFlow(el, flow.join('\n'));
        flow = [];
      }
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      appendCodeBlockMarkdown(el, fence[1], codeLines.join('\n'));
    }
    if (flow.length) appendMarkdownFlow(el, flow.join('\n'));
    if (!el.childNodes.length) el.textContent = formatted;
  }

  function setBubbleText(el, role, text) {
    if (!el) return;
    const raw = text == null ? '' : String(text);
    el.classList.toggle('copilot-markdown', role === 'assistant');
    if (role === 'assistant') {
      renderCopilotMarkdown(el, raw);
    } else {
      el.textContent = raw;
    }
  }

  function appendBubble(role, text, extraClass) {
    const div = document.createElement('div');
    div.className = 'copilot-msg copilot-msg-' + role + (extraClass ? ' ' + extraClass : '');
    setBubbleText(div, role, text);
    messagesEl.appendChild(div);
    scrollMessagesToBottom();
    return div;
  }

  let streamBubble = null;

  function ensureStreamBubble() {
    if (!streamBubble) {
      streamBubble = appendBubble('assistant', '', 'copilot-msg-streaming');
    }
    return streamBubble;
  }

  function finishStream() {
    streamBubble = null;
    streamingText = '';
  }

  function showConfirmCard(ev) {
    const card = document.createElement('div');
    card.className = 'copilot-confirm-card';
    if (ev && ev.confirmId) card.dataset.confirmId = ev.confirmId;
    const isCodexFullAccess = ev && ev.name === 'codex.full_access_turn';
    const isExternalMcp = ev && ev.clientId === 'mcp';
    const title = document.createElement('div');
    title.className = 'copilot-confirm-title';
    title.textContent = (isExternalMcp ? '\u5916\u90e8 Agent \u8bf7\u6c42\uff1a' : '\u786e\u8ba4\u5de5\u5177\uff1a') + (ev.name || 'tool');
    const argsEl = document.createElement('div');
    if (isCodexFullAccess) title.textContent = '\u6388\u6743 Codex \u672c\u8f6e\u5168\u6743\u8bbf\u95ee';
    argsEl.className = 'copilot-confirm-args';
    try {
      argsEl.textContent = JSON.stringify(ev.arguments || {}, null, 2);
    } catch {
      argsEl.textContent = String(ev.arguments || '');
    }
    if (isCodexFullAccess) {
      argsEl.textContent = '\u6279\u51c6\u540e\uff0c\u672c\u8f6e Codex \u53ef\u8bfb\u5199\u5de5\u4f5c\u533a\u5e76\u8fd0\u884c\u672c\u673a\u547d\u4ee4\u3002';
    }
    const perceptionSummary = buildConfirmPerceptionSummary();
    const perceptionEl = document.createElement('div');
    perceptionEl.className = 'copilot-confirm-perception' + (perceptionSummary.stale ? ' is-stale' : '');
    perceptionEl.textContent = '当前范围\n' + perceptionSummary.text;
    const actions = document.createElement('div');
    actions.className = 'copilot-confirm-actions';
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'copilot-confirm-approve';
    approveBtn.textContent = '\u5141\u8bb8';
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'copilot-confirm-reject';
    rejectBtn.textContent = '\u62d2\u7edd';
    const rememberBtn = document.createElement('button');
    rememberBtn.type = 'button';
    rememberBtn.className = 'copilot-confirm-remember';
    rememberBtn.textContent = '允许并记住';
    const rememberEligible = canRememberLowRiskConfirm(ev);
    actions.appendChild(approveBtn);
    if (rememberEligible) actions.appendChild(rememberBtn);
    actions.appendChild(rejectBtn);
    const status = document.createElement('div');
    status.className = 'copilot-confirm-status';
    status.textContent = perceptionSummary.stale ? '上下文可能过期，请确认范围后再继续' : '\u7b49\u5f85\u4f60\u7684\u786e\u8ba4';
    card.appendChild(title);
    card.appendChild(perceptionEl);
    card.appendChild(argsEl);
    card.appendChild(actions);
    card.appendChild(status);
    messagesEl.appendChild(card);
    scrollMessagesToBottom();

    let settled = false;
    const settle = async (approved, rememberLowRisk) => {
      if (settled) return;
      settled = true;
      card.classList.remove('is-error');
      card.classList.add('is-submitting');
      status.textContent = approved
        ? rememberLowRisk
          ? '\u6b63\u5728\u63d0\u4ea4\u6279\u51c6\u5e76\u8bb0\u4f4f\u2026'
          : '\u6b63\u5728\u63d0\u4ea4\u6279\u51c6\u2026'
        : '\u6b63\u5728\u63d0\u4ea4\u62d2\u7edd\u2026';
      approveBtn.disabled = true;
      rememberBtn.disabled = true;
      rejectBtn.disabled = true;
      try {
        if (typeof agent.confirm === 'function') {
          const r = await agent.confirm(ev.confirmId, approved);
          if (!r || r.ok === false) throw new Error((r && r.error) || 'confirm_failed');
        }
        if (approved && rememberLowRisk) {
          const saved = await saveRememberedLowRiskTool(ev.name);
          if (!saved) throw new Error('remember_low_risk_failed');
        }
        card.classList.remove('is-submitting');
        emitCopilotTimelineEvent({
          source: 'user',
          title: approved ? (rememberLowRisk ? '已批准并记住低风险授权' : '已批准确认') : '已拒绝确认',
          detail: rememberLowRisk ? ev.name || '' : '',
          status: approved ? 'done' : 'cancelled',
        });
        setStatus(approved ? (rememberLowRisk ? '\u5df2\u6279\u51c6\u5e76\u8bb0\u4f4f' : '\u5df2\u6279\u51c6\uff0c\u7ee7\u7eed\u4e2d\u2026') : '\u5df2\u62d2\u7edd');
        if (card.parentNode) card.parentNode.removeChild(card);
      } catch (e) {
        settled = false;
        approveBtn.disabled = false;
        rememberBtn.disabled = false;
        rejectBtn.disabled = false;
        card.classList.remove('is-submitting');
        card.classList.add('is-error');
        emitCopilotTimelineEvent({
          source: 'system',
          title: '确认提交失败',
          detail: e && e.message ? e.message : String(e),
          status: 'failed',
        });
        status.textContent = '\u63d0\u4ea4\u5931\u8d25\uff1a' + (e && e.message ? e.message : String(e));
        setStatus(status.textContent);
      }
    };
    approveBtn.addEventListener('click', () => void settle(true));
    rememberBtn.addEventListener('click', () => void settle(true, true));
    rejectBtn.addEventListener('click', () => void settle(false));
    setTimeout(() => setStatus(isCodexFullAccess ? '\u7b49\u5f85\u6388\u6743\u2026' : '\u7b49\u5f85\u786e\u8ba4\u2026'), 0);
    setStatus('\u7b49\u5f85\u786e\u8ba4\u2026');
  }

  function activityDisplayName(ev) {
    const name = String((ev && ev.name) || 'activity');
    if (name === 'codex.command') return '\u547d\u4ee4';
    return name;
  }

  /** L1: routine start/done stay in status bar; only failures become chat cards. */
  function shouldMuteActivityInChat(ev) {
    if (!ev) return true;
    if (ev.phase === 'error') return false;
    return ev.phase === 'start' || ev.phase === 'done';
  }

  function noteActivityProgress(ev) {
    const label = activityDisplayName(ev);
    if (ev.phase === 'start') {
      setStatus('\u6b63\u5728\u6267\u884c\uff1a' + label);
      updateActiveTaskThread('progress', label + ' \u5df2\u5f00\u59cb');
      return;
    }
    if (ev.phase === 'done') {
      setStatus('\u5df2\u5b8c\u6210\uff1a' + label);
      updateActiveTaskThread('progress', label + ' \u5df2\u5b8c\u6210');
      return;
    }
    if (ev.phase === 'error') {
      setStatus('\u6267\u884c\u5931\u8d25\uff1a' + label);
      updateActiveTaskThread('error', (ev.detail && String(ev.detail).slice(0, 120)) || label + ' \u5931\u8d25');
    }
  }

  function appendActivityCard(ev) {
    if (!ev || !messagesEl) return;
    const card = document.createElement('div');
    card.className = 'copilot-activity-card';
    if (ev.phase === 'error') card.classList.add('is-error');
    if (ev.phase === 'done') card.classList.add('is-done');
    const phaseText =
      ev.phase === 'start' ? '\u5f00\u59cb' : ev.phase === 'done' ? '\u5b8c\u6210' : '\u5931\u8d25';
    const nameText = activityDisplayName(ev);
    noteCurrentRunActivity(phaseText + ' · ' + nameText, ev.detail || '', ev.phase);
    const summary = document.createElement('div');
    summary.className = 'copilot-activity-summary';
    const title = document.createElement('span');
    title.className = 'copilot-activity-title';
    title.textContent = phaseText + ' \u00b7 ' + nameText;
    const toggle = document.createElement('span');
    toggle.className = 'copilot-activity-toggle';
    toggle.textContent = '\u8be6\u60c5';
    summary.appendChild(title);
    summary.appendChild(toggle);
    card.appendChild(summary);
    if (ev.detail) {
      const detail = document.createElement('div');
      detail.className = 'copilot-activity-detail';
      detail.textContent = ev.detail;
      card.appendChild(detail);
      card.addEventListener('click', () => {
        const expanded = !card.classList.contains('is-expanded');
        card.classList.toggle('is-expanded', expanded);
        toggle.textContent = expanded ? '\u6536\u8d77' : '\u8be6\u60c5';
      });
    } else {
      toggle.textContent = '';
    }
    messagesEl.appendChild(card);
    scrollMessagesToBottom();
  }

  function formatUsageValue(value) {
    if (value == null) return '';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function appendUsageCard(usage) {
    updateTokenUsageBar(usage);
  }

  function formatRecoveryDetail(message, meta, info) {
    const lines = [];
    const safePush = (label, value) => {
      const text = String(value || '').trim();
      if (text) lines.push(label + ': ' + text.slice(0, 800));
    };
    safePush('原因类型', info && info.kind);
    safePush('用户提示', message);
    if (meta && typeof meta === 'object') {
      safePush('工具', meta.tool);
      safePush('错误码', meta.errorCode || meta.code);
      safePush('下一步', meta.nextStep);
      const server = meta.server && typeof meta.server === 'object' ? meta.server : null;
      if (server) safePush('服务状态', server.status || server.code);
      try {
        const compact = JSON.stringify(meta, (key, value) => {
          if (/token|cookie|secret|password|authorization/i.test(key)) return '[redacted]';
          if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '...';
          return value;
        });
        safePush('底层摘要', compact);
      } catch {
        /* ignore */
      }
    }
    return lines.join('\n') || '没有更多底层详情。';
  }

  function normalizeRecoveryInfo(message, meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    const server = m.server && typeof m.server === 'object' ? m.server : {};
    const details = m.details && typeof m.details === 'object' ? m.details : {};
    const authDiagnostics =
      (m.authDiagnostics && typeof m.authDiagnostics === 'object' ? m.authDiagnostics : null) ||
      (details.authDiagnostics && typeof details.authDiagnostics === 'object' ? details.authDiagnostics : null);
    const msg = String(message || m.nextStep || '').trim();
    const code = String(m.errorCode || m.code || '').trim();
    const isWorkbench = m.view === 'workbench' || /^ac\.workbench\./.test(String(m.tool || ''));
    const connectionText = [msg, code, m.tool, m.kind, m.type, m.connectionStatus, m.host, m.appId]
      .map((item) => String(item || '').toLowerCase())
      .join(' ');
    const hostDisconnected =
      /maya|blender|photoshop|connector|host|software_connection|external/.test(connectionText) &&
      /not connected|disconnected|disconnect|unavailable|missing|未连接|断开|宿主/.test(connectionText);
    if (hostDisconnected) {
      return {
        kind: 'host-disconnected',
        title: '宿主软件未连接',
        description: msg || '当前任务需要连接外部软件。先打开连接页修复连接，或让 Copilot 只生成操作方案。',
      };
    }
    if (code === 'AGENT_CREDITS_REQUIRED') {
      return {
        kind: 'credits-required',
        title: '\u989d\u5ea6\u4e0d\u8db3',
        description: msg || '\u5de5\u4f5c\u53f0\u94fe\u8def\u5df2\u8fde\u4e0a\uff0c\u4f46\u8fd0\u884c\u80fd\u529b\u9700\u8981\u5148\u8865\u8db3\u56e2\u961f\u989d\u5ea6\u6216\u5207\u6362\u5230\u53ef\u7528\u7684\u8ba1\u8d39\u7b56\u7565\u3002',
      };
    }
    if (m.authRequired || code === 'AGENT_AUTH_REQUIRED') {
      const session = authDiagnostics && authDiagnostics.session && typeof authDiagnostics.session === 'object'
        ? authDiagnostics.session
        : null;
      const diagnosticLine = authDiagnostics
        ? ' API: ' + (authDiagnostics.apiOrigin || '-') +
          ', Workbench: ' + (authDiagnostics.siteOrigin || '-') +
          ', cookies: ' + (session ? String(session.cookieCount || 0) : 'unknown') + '.'
        : '';
      return {
        kind: 'workbench-auth',
        title: 'Workbench login required',
        description: (msg || 'Copilot can reach Workbench, but the embedded Workbench session is not logged in. Open Workbench, finish login, then retry.') + diagnosticLine,
      };
    }
    if (m.forbidden || code === 'AGENT_FORBIDDEN' || server.status === 403) {
      return {
        kind: 'forbidden',
        title: 'Current account has no permission',
        description: msg || 'Workbench rejected this action. Switch to an authorized account or ask an admin to adjust permissions.',
      };
    }
    if (m.requiresFrontendAuthorization) {
      return {
        kind: 'frontend-auth',
        title: 'Authorization required in Copilot',
        description: msg || 'This action requires frontend confirmation before it can continue. Keep Copilot open and handle the authorization card.',
      };
    }
    if (m.projectRequired || code === 'AGENT_PROJECT_REQUIRED') {
      return {
        kind: 'project-required',
        title: 'A workspace project is required',
        description: msg || 'Create or open a Workbench project before continuing this action.',
      };
    }
    if (m.projectNotFound || code === 'AGENT_PROJECT_NOT_FOUND') {
      return {
        kind: 'project-not-found',
        title: 'Project not found',
        description: msg || 'Read the Workbench context, choose an available project, then continue.',
      };
    }
    if (m.assetNotFound || code === 'AGENT_ASSET_NOT_FOUND') {
      return {
        kind: 'asset-not-found',
        title: 'Asset not found',
        description: msg || 'List the current project assets, choose a valid assetId, then continue.',
      };
    }
    if (m.presetNotFound || code === 'AGENT_PRESET_NOT_FOUND') {
      return {
        kind: 'preset-not-found',
        title: 'Capability not found',
        description: msg || 'Read Workbench context and choose a valid capability preset before running.',
      };
    }
    if (m.presetNotRunnable || code === 'AGENT_PRESET_NOT_DIRECT_RUNNABLE') {
      return {
        kind: 'preset-not-runnable',
        title: 'Capability is not directly runnable by Agent',
        description: msg || 'Use a directRunSupported capability or run this interaction manually in Workbench.',
      };
    }
    if (isWorkbench && m.retryable) {
      return {
        kind: 'workbench-retry',
        title: 'Workbench is not ready yet',
        description: msg || 'Confirm the site is reachable and the Workbench page is fully loaded, then retry.',
      };
    }
    return {
      kind: 'generic',
      title: 'Needs attention',
      description: msg || 'The last task did not complete. Ask Copilot to inspect it or refresh credentials and try again.',
    };
  }

  function appendRecoveryCard(message, meta) {
    if (!messagesEl) return;
    const info = normalizeRecoveryInfo(message, meta);
    emitCopilotTimelineEvent({
      source: 'system',
      title: '生成恢复动作：' + info.title,
      detail: message,
      status: 'failed',
    });
    const card = document.createElement('div');
    card.className = 'copilot-onboard copilot-recovery-card';
    const title = document.createElement('div');
    title.className = 'copilot-onboard-title';
    title.textContent = info.title;
    const desc = document.createElement('div');
    desc.className = 'copilot-onboard-desc';
    desc.textContent = info.description;
    const actions = document.createElement('div');
    actions.className = 'copilot-onboard-actions';

    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'copilot-onboard-btn';
    retryBtn.textContent = '重试';
    retryBtn.addEventListener('click', () => fillAndSend(lastUserPrompt || 'Retry the last Workbench action.'));

    if (info.kind === 'host-disconnected') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '打开连接页';
      fixBtn.addEventListener('click', switchToConnections);
      const planOnlyBtn = document.createElement('button');
      planOnlyBtn.type = 'button';
      planOnlyBtn.className = 'copilot-onboard-btn';
      planOnlyBtn.textContent = '只生成方案';
      planOnlyBtn.addEventListener('click', () =>
        fillAndSend('The external host is not connected. Do not execute host commands; generate a step-by-step operation plan and note what connection is required.'),
      );
      actions.appendChild(fixBtn);
      actions.appendChild(planOnlyBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'workbench-auth' || info.kind === 'workbench-retry') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = info.kind === 'workbench-auth' ? 'Open Workbench login' : 'Open Workbench';
      fixBtn.addEventListener('click', () => {
        switchToWorkbench();
        if (info.kind === 'workbench-retry' && typeof shell.workbenchReload === 'function') {
          void shell.workbenchReload();
        }
        if (info.kind === 'workbench-auth') {
          void (async () => {
            fixBtn.disabled = true;
            await waitForTeamAccountLogin(120000);
            fixBtn.disabled = false;
            await refreshOnboardingState();
          })();
        }
      });
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
      if (typeof shell.workbenchOpenExternal === 'function') {
        const externalBtn = document.createElement('button');
        externalBtn.type = 'button';
        externalBtn.className = 'copilot-onboard-btn';
        externalBtn.textContent = 'Open in browser';
        externalBtn.addEventListener('click', () => void shell.workbenchOpenExternal());
        actions.appendChild(externalBtn);
      }
    } else if (info.kind === 'forbidden') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = 'Switch to Workbench';
      fixBtn.addEventListener('click', switchToWorkbench);
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'frontend-auth') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '查看授权';
      fixBtn.addEventListener('click', scrollMessagesToBottom);
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'credits-required') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '\u6253\u5f00\u8bbe\u7f6e';
      fixBtn.addEventListener('click', openCopilotSettings);
      const inspectBtn = document.createElement('button');
      inspectBtn.type = 'button';
      inspectBtn.className = 'copilot-onboard-btn';
      inspectBtn.textContent = '\u68c0\u67e5\u989d\u5ea6';
      inspectBtn.addEventListener('click', () =>
        startCopilotWorkTask('Inspect the latest AGENT_CREDITS_REQUIRED Workbench failure, check usage and quota settings, then recommend the shortest recovery path.'),
      );
      actions.appendChild(fixBtn);
      actions.appendChild(inspectBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'project-required') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = 'Create project and continue';
      fixBtn.addEventListener('click', () => fillAndSend('Create a Workbench project first, then continue the previous task.'));
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'project-not-found' || info.kind === 'preset-not-found' || info.kind === 'preset-not-runnable') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '读取工作台上下文';
      fixBtn.addEventListener('click', () => fillAndSend('Read Workbench context, confirm the current project and capabilities, then continue.'));
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'asset-not-found') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '列出当前资产';
      fixBtn.addEventListener('click', () => fillAndSend('List the current Workbench project assets and confirm the correct assetId.'));
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = 'Ask Copilot to inspect';
      fixBtn.addEventListener('click', () => fillAndSend('The last task failed. Inspect the cause and propose a fix.'));
      const authBtn = document.createElement('button');
      authBtn.type = 'button';
      authBtn.className = 'copilot-onboard-btn';
      authBtn.textContent = 'Refresh credentials and test';
      authBtn.addEventListener('click', () => void refreshTeamCodexAndTest(authBtn));
      actions.appendChild(fixBtn);
      actions.appendChild(authBtn);
    }

    const detailText = formatRecoveryDetail(message, meta, info);
    const detailEl = document.createElement('pre');
    detailEl.className = 'copilot-recovery-detail';
    detailEl.hidden = true;
    detailEl.textContent = detailText;
    const detailBtn = document.createElement('button');
    detailBtn.type = 'button';
    detailBtn.className = 'copilot-onboard-btn';
    detailBtn.textContent = '查看详情';
    detailBtn.addEventListener('click', () => {
      detailEl.hidden = !detailEl.hidden;
      detailBtn.textContent = detailEl.hidden ? '查看详情' : '收起详情';
      scrollMessagesToBottom();
    });
    if (!actions.contains(retryBtn)) actions.appendChild(retryBtn);
    actions.appendChild(detailBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'copilot-onboard-btn';
    settingsBtn.textContent = '打开设置';
    settingsBtn.addEventListener('click', openCopilotSettings);
    actions.appendChild(settingsBtn);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(actions);
    card.appendChild(detailEl);
    messagesEl.appendChild(card);
    scrollMessagesToBottom();
  }

  function dismissPendingConfirmCards(confirmId) {
    const cards = confirmId
      ? messagesEl.querySelectorAll('.copilot-confirm-card[data-confirm-id="' + confirmId + '"]')
      : messagesEl.querySelectorAll('.copilot-confirm-card');
    cards.forEach((card) => {
      if (card.parentNode) card.parentNode.removeChild(card);
    });
  }

  function applyCopilotWidthPx(widthPx, collapsed) {
    const w = collapsed
      ? COPILOT_COLLAPSED_WIDTH
      : Math.min(
          COPILOT_EXPANDED_MAX_WIDTH,
          Math.max(COPILOT_EXPANDED_MIN_WIDTH, Number(widthPx) || COPILOT_EXPANDED_DEFAULT_WIDTH),
        );
    document.documentElement.style.setProperty('--copilot-width', w + 'px');
  }

  async function loadHistory() {
    try {
      const r = await agent.listMessages(currentSessionId());
      if (!r || !r.ok || !Array.isArray(r.messages)) return;
      messagesEl.innerHTML = '';
      onboardEl = null;
      for (const m of r.messages) {
        if (m.role === 'user' || m.role === 'assistant') {
          appendBubble(m.role, m.content || '');
        }
        // Skip historical tool rows in the chat stream (activity/recovery remain for live turns).
      }
      scrollMessagesToBottom();
    } catch {
      /* ignore */
    }
  }

  async function refreshBrainLabel() {
    if (!brainLabel) return;
    try {
      if (typeof agent.loadSettings === 'function') {
        const s = await agent.loadSettings();
        if (s && s.ok) {
          const desired = (s.settings && s.settings.defaultBrainId) || 'stub';
          const active = s.activeBrainId || desired;
          brainLabel.textContent = active === desired ? desired : desired + ' -> ' + active;
          brainLabel.title = 'Codex';
          return;
        }
      }
      const r = await agent.probeBrain();
      if (r && r.ok) {
        brainLabel.textContent = r.brainId || 'stub';
      }
    } catch {
      brainLabel.textContent = 'stub';
    }
  }

  if (brainLabel) {
    brainLabel.style.cursor = 'default';
    brainLabel.title = 'Codex';
  }

  if (brainSettingsBtn) {
    brainSettingsBtn.setAttribute('aria-label', '打开设置');
    brainSettingsBtn.title = '打开设置';
    brainSettingsBtn.addEventListener('click', openCopilotSettings);
  }

  desktopObservationScopeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.getAttribute('data-desktop-observation-scope') || 'current_window';
      void startDesktopObservationRuntime({ scope }, '桌面观察范围：' + desktopObservationScopeLabel(scope));
    });
  });
  if (desktopObservationEnableBtn) {
    desktopObservationEnableBtn.addEventListener('click', () => {
      if (desktopObservationState.enabled && desktopObservationState.permissionGranted && desktopObservationState.paused) {
        void startDesktopObservationRuntime({ paused: false, recordingIndicatorVisible: true }, '继续桌面观察');
        return;
      }
      if (desktopObservationEl) desktopObservationEl.open = true;
      void startDesktopObservationRuntime(
        {
          enabled: true,
          paused: false,
          permissionGranted: false,
          recordingIndicatorVisible: false,
          lastFrameAt: 0,
          lastSummary: '',
        },
        '请求桌面观察授权',
      );
    });
  }
  if (desktopObservationPauseBtn) {
    desktopObservationPauseBtn.addEventListener('click', () => {
      void startDesktopObservationRuntime({ paused: true, recordingIndicatorVisible: false }, '暂停桌面观察');
    });
  }
  if (desktopObservationStopBtn) {
    desktopObservationStopBtn.addEventListener('click', async () => {
      if (shell && typeof shell.desktopObservationStop === 'function') {
        try {
          const status = await shell.desktopObservationStop();
          applyDesktopObservationStatus(status);
        } catch {
          /* ignore */
        }
      }
      setDesktopObservationState({
        enabled: false,
        paused: false,
        permissionGranted: false,
        recordingIndicatorVisible: false,
        lastFrameAt: 0,
        lastSummary: '',
        cacheFrameCount: 0,
      }, '停止桌面观察');
    });
  }

  async function clearCopilotHistory() {
    if (turnBusy) {
      const stopOk = window.confirm('\u5f53\u524d\u4efb\u52a1\u8fd8\u5728\u8fd0\u884c\u3002\u662f\u5426\u505c\u6b62\u5e76\u6e05\u7a7a\u5bf9\u8bdd\u5386\u53f2\uff1f');
      if (!stopOk) return;
    } else {
      const ok = window.confirm('\u6e05\u7a7a\u5f53\u524d Copilot \u5bf9\u8bdd\u5386\u53f2\uff0c\u5e76\u5f00\u59cb\u65b0\u5bf9\u8bdd\uff1f\n\uff08\u672c\u5730\u5ba1\u8ba1\u4e0e\u7528\u91cf\u8bb0\u5f55\u4e0d\u4f1a\u5220\u9664\uff09');
      if (!ok) return;
    }
    setStatus('\u6b63\u5728\u6e05\u7a7a\u5bf9\u8bdd\u2026');
    try {
      if (typeof agent.clearHistory !== 'function') {
        throw new Error('clear_history_unavailable');
      }
      const r = await agent.clearHistory(currentSessionId());
      if (!r || r.ok === false) {
        throw new Error((r && r.error) || 'clear_failed');
      }
      finishStream();
      streamingText = '';
      turnBusy = false;
      root.classList.remove('is-busy');
      if (sendBtn) sendBtn.disabled = false;
      if (abortBtn) abortBtn.disabled = true;
      pendingTaskThreadPrompt = '';
      activeTaskThreadCard = null;
      activeTaskThreadEls = null;
      activeTaskThreadKey = '';
      activeTaskThreadAttempt = 0;
      clearCurrentRunDock();
      copilotTimelineEvents = [];
      renderCopilotTimeline(false);
      lastUsageSnapshot = null;
      updateTokenUsageBar({});
      if (tokenPopoverEl) tokenPopoverEl.hidden = true;
      removeOnboardCard();
      messagesEl.innerHTML = '';
      showExampleChips(false);
      await refreshOnboardingState();
      setStatus('\u5df2\u5f00\u59cb\u65b0\u5bf9\u8bdd');
      setTimeout(() => setStatus(''), 2000);
    } catch (e) {
      setStatus('\u6e05\u7a7a\u5931\u8d25\uff1a' + (e && e.message ? e.message : String(e)));
    }
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => void clearCopilotHistory());
  }

  if (tokenBarEl && tokenPopoverEl) {
    tokenBarEl.addEventListener('click', () => {
      tokenPopoverEl.hidden = !tokenPopoverEl.hidden;
    });
  }

  async function applyCopilotLayoutFromMain() {
    if (typeof shell.getCopilotLayout !== 'function') return;
    try {
      const r = await shell.getCopilotLayout();
      if (!r || !r.ok) return;
      const collapsed = Boolean(r.collapsed);
      const widthPx = collapsed ? COPILOT_COLLAPSED_WIDTH : Math.max(Number(r.widthPx) || 0, COPILOT_EXPANDED_MIN_WIDTH);
      applyCopilotWidthPx(widthPx, collapsed);
      document.body.classList.toggle('shell-copilot-collapsed', collapsed);
      renderToggleIcon(collapsed);
    } catch {
      /* ignore */
    }
  }

  async function persistCopilotCollapsed(collapsed) {
    document.body.classList.toggle('shell-copilot-collapsed', collapsed);
    applyCopilotWidthPx(collapsed ? COPILOT_COLLAPSED_WIDTH : COPILOT_EXPANDED_DEFAULT_WIDTH, collapsed);
    renderToggleIcon(collapsed);
    if (typeof shell.setCopilotLayout === 'function') {
      try {
        await shell.setCopilotLayout({
          collapsed,
          widthPx: collapsed ? undefined : COPILOT_EXPANDED_DEFAULT_WIDTH,
        });
      } catch {
        /* ignore */
      }
    }
    renderToggleIcon(collapsed);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const next = !document.body.classList.contains('shell-copilot-collapsed');
      void persistCopilotCollapsed(next);
    });
  }

  function parseToolResultContent(result) {
    if (!result || typeof result !== 'object') return null;
    if (result.structured && typeof result.structured === 'object') return result.structured;
    const content = typeof result.content === 'string' ? result.content.trim() : '';
    if (!content || content[0] !== '{') return null;
    try {
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function capabilityCreatedFromToolResult(ev) {
    const name = String((ev && ev.name) || '').trim();
    if (name !== 'ac.capability.create_draft' && name !== 'ac.capability.draft_create') return null;
    const result = ev && ev.result && typeof ev.result === 'object' ? ev.result : null;
    if (!result || result.ok === false) return null;
    const payload = parseToolResultContent(result);
    if (!payload) return null;
    const draft = payload.draft && typeof payload.draft === 'object' ? payload.draft : null;
    const context = payload.context && typeof payload.context === 'object' ? payload.context : null;
    const session = context && context.session && typeof context.session === 'object' ? context.session : null;
    const type = String(payload.type || (draft && draft.type) || '').trim();
    const id = String(payload.id || (draft && draft.id) || '').trim();
    if (type !== 'software_connection' && type !== 'tool') return null;
    if (!id) return null;
    return {
      type,
      id,
      name: String(payload.name || (draft && draft.name) || id).trim(),
      sessionId: String((session && session.sessionId) || (draft && draft.conversation && draft.conversation.sessionId) || '').trim(),
      sourceTool: name,
    };
  }

  function notifyCapabilityCreated(ev) {
    const detail = capabilityCreatedFromToolResult(ev);
    if (!detail) return;
    window.dispatchEvent(new CustomEvent('assetcutter:capability-created', { detail }));
  }

  if (typeof agent.onEvent === 'function') {
    agent.onEvent((ev) => {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'text_delta') {
        clearCodexWaitHintTimer();
        streamingText += ev.text || '';
        const bubble = ensureStreamBubble();
        setBubbleText(bubble, 'assistant', streamingText);
        scrollMessagesToBottom();
      } else if (ev.type === 'tool_call') {
        // L1: progress on task-thread only; do not dump "> tool" bubbles into the chat.
        updateActiveTaskThread('progress', (ev.name || 'tool') + ' \u5df2\u5f00\u59cb');
      } else if (ev.type === 'confirm_required') {
        const confirmPerception = buildConfirmPerceptionSummary();
        emitCopilotTimelineEvent({
          source: 'system',
          title: '等待确认：' + (ev.title || ev.tool || ev.confirmId || '高风险动作'),
          detail: confirmPerception.text,
          status: 'queued',
          risk: ev.risk,
        });
        showConfirmCard(ev);
      } else if (ev.type === 'confirm_cancelled') {
        dismissPendingConfirmCards(ev.confirmId);
        emitCopilotTimelineEvent({
          source: 'system',
          title: ev.reason === 'timeout' ? '确认超时' : '确认已取消',
          status: 'cancelled',
        });
        if (ev.reason === 'timeout') {
          setStatus('\u786e\u8ba4\u5df2\u8d85\u65f6');
          setTimeout(() => setStatus(''), 2500);
        }
      } else if (ev.type === 'tool_status') {
        if (ev.phase === 'error') {
          const structured = ev.structured && typeof ev.structured === 'object' ? ev.structured : {};
          updateActiveTaskThread('error', ev.detail || structured.nextStep || '\u5de5\u5177\u6267\u884c\u5931\u8d25\uff0c\u5df2\u751f\u6210\u6062\u590d\u52a8\u4f5c');
          appendRecoveryCard(ev.detail || structured.nextStep || 'Tool execution failed. Inspect details or ask Copilot to check it.', {
            ...structured,
            tool: ev.name,
            errorCode: ev.errorCode,
          });
        } else if (ev.phase) {
          updateActiveTaskThread('progress', (ev.name || 'tool') + ' ' + ev.phase);
        }
        emitCopilotTimelineEvent({
          source: 'tool',
          title: (ev.name || 'tool') + ' ' + (ev.phase || 'status'),
          detail: ev.detail || ev.errorCode || '',
          status: ev.phase === 'error' ? 'failed' : ev.phase === 'done' ? 'done' : 'running',
        });
        if (ev.phase === 'error' || ev.phase === 'done') {
          void refreshCopilotObservationAfterAction(ev.name || 'tool_status', ev.phase === 'error' ? 'failed' : 'done');
        }
      } else if (ev.type === 'tool_result') {
        notifyCapabilityCreated(ev);
        emitCopilotTimelineEvent({ source: 'tool', title: (ev.name || 'tool') + ' 已返回', status: 'done' });
        void refreshCopilotObservationAfterAction(ev.name || 'tool_result', 'done');
      } else if (ev.type === 'activity') {
        rememberCodexProgress(ev);
        noteActivityProgress(ev);
        noteCurrentRunActivity(activityDisplayName(ev) + ' ' + (ev.phase || 'activity'), ev.detail || '', ev.phase);
        emitCopilotTimelineEvent({
          source: 'copilot',
          title: activityDisplayName(ev) + ' ' + (ev.phase || 'activity'),
          detail: ev.detail || '',
          status: ev.phase === 'error' ? 'failed' : ev.phase === 'done' ? 'done' : 'running',
        });
        if (!shouldMuteActivityInChat(ev)) {
          appendActivityCard(ev);
        }
      } else if (ev.type === 'usage') {
        appendUsageCard(ev.usage);
        emitCopilotTimelineEvent({ source: 'system', title: '更新用量', status: 'done' });
        void refreshBrainStateCard();
      } else if (ev.type === 'done') {
        clearCodexWaitHintTimer();
        finishStream();
        dismissPendingConfirmCards();
        if (ev.stopReason === 'aborted') {
          updateActiveTaskThread('error', '\u5df2\u505c\u6b62\uff0c\u53ef\u4ece\u539f\u76ee\u6807\u91cd\u8bd5');
          emitCopilotTimelineEvent({ source: 'copilot', title: '任务已停止', status: 'cancelled' });
          setStatus('\u5df2\u505c\u6b62');
          void refreshCopilotObservationAfterAction('任务停止', 'cancelled');
        } else {
          const doneText = '\u5df2\u5b8c\u6210\uff0c\u7ed3\u679c\u53ef\u7ee7\u7eed\u5199\u56de\u8d44\u4ea7\u5e93\u6216\u4fdd\u5b58\u4e3a\u6d41\u7a0b\u8349\u7a3f';
          updateActiveTaskThread('done', doneText);
          emitCopilotTimelineEvent({ source: 'copilot', title: '本轮已完成', status: 'done' });
          // Result card only for explicit work tasks (active task-thread), not casual chat.
          if (activeTaskThreadEls) {
            appendResultCard(doneText);
          }
          void refreshCopilotObservationAfterAction('任务完成', 'done');
          setStatus('');
        }
      } else if (ev.type === 'error') {
        clearCodexWaitHintTimer();
        finishStream();
        emitCopilotTimelineEvent({ source: 'copilot', title: ev.message || '任务失败', status: 'failed' });
        updateActiveTaskThread('error', ev.message || '\u4efb\u52a1\u5931\u8d25\uff0c\u5df2\u751f\u6210\u6062\u590d\u52a8\u4f5c');
        appendRecoveryCard(ev.message || 'Task failed. Refresh credentials, open settings, or ask Copilot to inspect it.');
        setStatus(ev.message || '出错');
        void refreshCopilotObservationAfterAction('任务失败', 'failed');
      }
    });
  }

  if (typeof shell.onShellViewSync === 'function') {
    shell.onShellViewSync((payload) => {
      const v = payload && payload.view;
      if (!v || typeof window.__acApplyShellViewFromMain !== 'function') return;
      void window.__acApplyShellViewFromMain(v, { syncOnly: true });
    });
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || turnBusy) return;
    turnBusy = true;
    root.classList.add('is-busy');
    lastUserPrompt = text;
    if (sendBtn) sendBtn.disabled = true;
    if (abortBtn) abortBtn.disabled = false;
    // Casual composer chat: no task-thread card. Quick tasks set pendingTaskThreadPrompt first.
    if (pendingTaskThreadPrompt === text) {
      pendingTaskThreadPrompt = '';
    }
    emitCopilotTimelineEvent({ source: 'user', title: '发送消息：' + text, status: 'queued' });
    appendBubble('user', text);
    inputEl.value = '';
    resizeComposer();
    showExampleChips(false);
    setStatus('Codex \u6b63\u5728\u601d\u8003...');
    finishStream();
    try {
      await refreshShellCopilotPerceptionBar();
      const setupReady = await ensureCodexReadyBeforeSend();
      if (!setupReady.ok) {
        const message = setupReady.error || 'Codex \u4ecd\u672a\u5c31\u7eea\u3002';
        setStatus(message);
        updateActiveTaskThread('error', message);
        appendRecoveryCard(message);
        return;
      }
      setStatus('Codex \u6b63\u5728\u601d\u8003...');
      startCodexWaitHintTimer();
      const outboundText = activeObjectContextPrompt
        ? activeObjectContextPrompt + '\n\n\u7528\u6237\u8fd9\u6b21\u8bf4\uff1a\n' + text
        : text;
      const r = await agent.send(outboundText, currentSessionId());
      if (r && !r.ok && r.error) {
        setStatus(String(r.error));
        updateActiveTaskThread('error', String(r.error));
        appendRecoveryCard(String(r.error));
      }
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
      updateActiveTaskThread('error', e && e.message ? e.message : String(e));
      appendRecoveryCard(e && e.message ? e.message : String(e));
    } finally {
      clearCodexWaitHintTimer();
      turnBusy = false;
      root.classList.remove('is-busy');
      if (sendBtn) sendBtn.disabled = false;
      if (abortBtn) abortBtn.disabled = true;
    }
  }

  sendBtn.addEventListener('click', () => void sendMessage());
  inputEl.addEventListener('input', resizeComposer);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  });

  if (abortBtn) {
    abortBtn.disabled = true;
    abortBtn.addEventListener('click', () => {
      void agent.abort();
    });
  }

  if (typeof agent.onCodexSetupProgress === 'function') {
    agent.onCodexSetupProgress((payload) => {
      if (!payload) return;
      const runId = String(payload.runId || '');
      const isLaunchSetup = runId.startsWith('launch-');
      if (isLaunchSetup && !activeCodexSetupRunId) {
        activeCodexSetupRunId = runId;
        turnBusy = true;
        root.classList.add('is-busy');
        if (sendBtn) sendBtn.disabled = true;
      }
      if (runId !== activeCodexSetupRunId) return;
      const message = payload.message ? String(payload.message) : '';
      if (message) setStatus(message);
      if (payload.id === 'launch_complete' || payload.id === 'launch_failed') {
        activeCodexSetupRunId = '';
        turnBusy = false;
        root.classList.remove('is-busy');
        if (sendBtn) sendBtn.disabled = false;
        void refreshBrainStateCard({ forceProbe: true });
        void refreshOnboardingState();
      }
    });
  }

  registerCopilotShellListeners();

  void (async () => {
    await applyCopilotLayoutFromMain();
    updateTokenUsageBar();
    resizeComposer();
    await loadHistory();
    await refreshDesktopObservationStatus({ emitLatestFrame: true });
    updateDesktopObservationUi();
    await refreshShellCopilotPerceptionBar();
    ensureBrainStateCard();
    await refreshBrainStateCard({ forceProbe: true });
    await refreshOnboardingState();
    setInterval(() => void refreshShellCopilotPerceptionBar(), 15000);
  })();
})();
