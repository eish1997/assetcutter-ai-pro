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

  if (!root || !messagesEl || !inputEl || !sendBtn) return;

  let streamingText = '';
  let turnBusy = false;
  let brainReady = false;
  let onboardEl = null;
  let brainStateCard = null;
  let brainStateEls = null;
  let lastSettingsSnapshot = null;
  let lastProbeSnapshot = null;
  let lastUsageSnapshot = null;
  let lastUserPrompt = '';
  let permissionPolicySyncedForMode = '';
  const COPILOT_EXPANDED_MIN_WIDTH = 360;
  const COPILOT_EXPANDED_DEFAULT_WIDTH = 380;
  const COPILOT_EXPANDED_MAX_WIDTH = 720;
  const COPILOT_COLLAPSED_WIDTH = 48;

  const EXAMPLE_PHRASES = ['打开脚本页', '伴侣运行状态怎么样？', '切换到设置页'];

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
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

  function switchToWorkbench() {
    if (typeof shell.setShellView === 'function') void shell.setShellView('workbench');
    if (typeof window.__acApplyShellViewFromMain === 'function') {
      void window.__acApplyShellViewFromMain('workbench');
    }
  }

  function renderToggleIcon(collapsed) {
    if (!toggleBtn) return;
    toggleBtn.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>';
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggleBtn.title = collapsed ? '展开 Copilot' : '收起 Copilot';
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
    tokenBarEl.title = '上下文用量 ' + Math.round(pct) + '%，点击展开';
    if (tokenPopoverEl) {
      tokenPopoverEl.innerHTML = '';
      const head = document.createElement('div');
      head.textContent = '上下文用量 · 已用 ' + Math.round(pct) + '%';
      tokenPopoverEl.appendChild(head);
      const rows = [
        ['新增输入', parts.freshInput],
        ['缓存命中', parts.cached],
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
      note.textContent = 'cached_input_tokens 已包含在 input_tokens 内';
      tokenPopoverEl.appendChild(note);
    }
  }

  function permissionModeLabel(mode) {
    if (mode === 'full') return '自动执行';
    if (mode === 'sandbox') return '安全模式';
    if (mode === 'ask' || !mode) return '需要时询问';
    if (mode === 'full') return '管理员全权限';
    if (mode === 'sandbox') return '普通沙箱';
    return '每轮询问';
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
    title.textContent = '大脑状态';
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
    useCodex.textContent = '使用 Codex';
    const testCodex = document.createElement('button');
    testCodex.type = 'button';
    testCodex.className = 'copilot-mini-btn';
    testCodex.textContent = '测试';
    const openSettings = document.createElement('button');
    openSettings.type = 'button';
    openSettings.className = 'copilot-mini-btn';
    openSettings.textContent = '设置';
    useCodex.textContent = '使用 Codex';
    testCodex.textContent = '测试';
    openSettings.textContent = '设置';
    actions.appendChild(useCodex);
    actions.appendChild(testCodex);
    actions.appendChild(openSettings);

    const modes = document.createElement('div');
    modes.className = 'copilot-permission-actions';
    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'copilot-mode-btn';
    askBtn.textContent = '每轮询问';
    const sandboxBtn = document.createElement('button');
    sandboxBtn.type = 'button';
    sandboxBtn.className = 'copilot-mode-btn';
    sandboxBtn.textContent = '沙箱';
    const fullBtn = document.createElement('button');
    fullBtn.type = 'button';
    fullBtn.className = 'copilot-mode-btn';
    fullBtn.textContent = '全权限';
    askBtn.textContent = '需要时询问';
    sandboxBtn.textContent = '安全模式';
    fullBtn.textContent = '自动执行';
    modes.appendChild(askBtn);
    modes.appendChild(sandboxBtn);
    modes.appendChild(fullBtn);

    card.appendChild(top);
    card.appendChild(sub);
    card.appendChild(actions);
    card.appendChild(modes);
    body.insertBefore(card, body.firstChild);

    useCodex.addEventListener('click', () => void switchToCodex());
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
    brainStateEls = { dot, title, mode, sub, askBtn, sandboxBtn, fullBtn };
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
    setStatus('保存权限模式...');
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
        setStatus('权限模式：' + permissionModeLabel(mode));
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
    setStatus('切换到 Codex...');
    try {
      const r = await agent.saveSettings({ defaultBrainId: 'codex' });
      if (r && r.ok) {
        lastSettingsSnapshot = r.settings || lastSettingsSnapshot;
        await refreshBrainStateCard({ forceProbe: true });
        await refreshBrainLabel();
        await refreshOnboardingState();
        setStatus('已切换到 Codex');
        setTimeout(() => setStatus(''), 1800);
      }
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
    }
  }

  async function refreshTeamCodexAndTest(btn) {
    if (!agent || typeof agent.saveSettings !== 'function') return;
    if (btn) btn.disabled = true;
    setStatus('正在准备 Copilot...');
    try {
      if (typeof agent.syncCodexAuth === 'function') {
        const sync = await agent.syncCodexAuth();
        if (sync && sync.ok === false && !sync.skipped) {
          setStatus('团队凭据刷新失败：' + (sync.error || '请检查设置'));
          return;
        }
      }
      await agent.saveSettings({ defaultBrainId: 'codex' });
      lastProbeSnapshot = null;
      await refreshBrainLabel();
      await refreshBrainStateCard({ forceProbe: true, toast: true });
      await refreshOnboardingState();
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
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
      els.mode.textContent = permissionModeLabel(permissionMode);
      const cwd = s.settings && s.settings.codexCwd ? s.settings.codexCwd : '';
      const detail = probe && probe.detail ? probe.detail : '未检测';
      els.sub.textContent =
        'Codex: ' + detail + (cwd ? '\n目录: ' + cwd : '') + (desired !== active ? '\n当前已回退，请测试或切回 Codex。' : '');
      updatePermissionButtons(permissionMode);
      if (options && options.toast) {
        setStatus(ok ? 'Codex 可用' : detail);
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
    const phrases = ['帮我检查当前项目状态', '帮我启动工作台', '帮我修复刚才的报错', '帮我整理这个项目能做什么'];
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

  function showOnboardCard(detail) {
    removeOnboardCard();
    showExampleChips(false);
    const card = document.createElement('div');
    card.className = 'copilot-onboard';
    const title = document.createElement('div');
    title.className = 'copilot-onboard-title';
    title.textContent = '配置 AI 大脑';
    const desc = document.createElement('div');
    desc.className = 'copilot-onboard-desc';
    desc.textContent =
      detail ||
      'Copilot 需要 Hermes Gateway。点击下方一键配置，或在设置 → AI 大脑 中手动填写 Gateway URL。';
    const actions = document.createElement('div');
    actions.className = 'copilot-onboard-actions';
    const setupBtn = document.createElement('button');
    setupBtn.type = 'button';
    setupBtn.className = 'copilot-onboard-btn';
    setupBtn.textContent = '一键安装并启动 Hermes';
    setupBtn.addEventListener('click', () => void runHermesSetup(setupBtn));
    const connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.className = 'copilot-onboard-btn';
    connectBtn.textContent = '连接已有 Hermes';
    connectBtn.addEventListener('click', () => void runHermesConnect(connectBtn));
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'copilot-onboard-btn';
    settingsBtn.textContent = '打开设置';
    settingsBtn.addEventListener('click', () => {
      if (typeof shell.setShellView === 'function') {
        void shell.setShellView('settings');
      }
      if (typeof window.__acApplyShellViewFromMain === 'function') {
        void window.__acApplyShellViewFromMain('settings');
      }
    });
    actions.appendChild(setupBtn);
    actions.appendChild(connectBtn);
    actions.appendChild(settingsBtn);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(actions);
    messagesEl.insertBefore(card, messagesEl.firstChild);
    onboardEl = card;
  }

  function showMemberOnboardCard(detail, options) {
    removeOnboardCard();
    showExampleChips(false);
    const opts = options && typeof options === 'object' ? options : {};
    const ready = Boolean(opts.ready);
    const card = document.createElement('div');
    card.className = 'copilot-onboard';
    const title = document.createElement('div');
    title.className = 'copilot-onboard-title';
    title.textContent = ready ? 'Copilot 已就绪' : '还差一步';
    const desc = document.createElement('div');
    desc.className = 'copilot-onboard-desc';
    desc.textContent = ready
      ? '可以直接让 Copilot 检查项目、启动工作台、修复报错或整理当前项目。'
      : detail || '没有检测到可用的 Codex。可以先刷新团队凭据并测试连接。';
    const actions = document.createElement('div');
    actions.className = 'copilot-onboard-actions';

    if (ready) {
      const rows = [
        ['检查当前项目', '帮我检查当前项目状态'],
        ['启动工作台', '帮我启动工作台'],
        ['修复刚才的报错', '帮我修复刚才的报错'],
        ['整理项目能力', '帮我整理这个项目能做什么'],
      ];
      rows.forEach((row, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = idx === 0 ? 'copilot-onboard-btn is-primary' : 'copilot-onboard-btn';
        btn.textContent = row[0];
        btn.addEventListener('click', () => fillPrompt(row[1]));
        actions.appendChild(btn);
      });
    } else {
      const fixBtn = document.createElement('button');
      fixBtn.type = 'button';
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '刷新团队凭据并测试';
      fixBtn.addEventListener('click', () => void refreshTeamCodexAndTest(fixBtn));
      const codexBtn = document.createElement('button');
      codexBtn.type = 'button';
      codexBtn.className = 'copilot-onboard-btn';
      codexBtn.textContent = '切换到 Codex';
      codexBtn.addEventListener('click', () => void switchToCodex());
      const settingsBtn = document.createElement('button');
      settingsBtn.type = 'button';
      settingsBtn.className = 'copilot-onboard-btn';
      settingsBtn.textContent = '打开设置';
      settingsBtn.addEventListener('click', openCopilotSettings);
      actions.appendChild(fixBtn);
      actions.appendChild(codexBtn);
      actions.appendChild(settingsBtn);
    }

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(actions);
    messagesEl.insertBefore(card, messagesEl.firstChild);
    onboardEl = card;
  }

  async function runHermesConnect(btn) {
    if (typeof agent.companionConnect !== 'function') return;
    if (btn) btn.disabled = true;
    setStatus('正在连接已有 Hermes…');
    try {
      const r = await agent.companionConnect({ mode: 'all', detect: true, writeMcp: true });
      if (r && r.ok) {
        brainReady = true;
        removeOnboardCard();
        await refreshBrainLabel();
        const hasHistory = messagesEl.querySelectorAll('.copilot-msg').length > 0;
        if (!hasHistory) showExampleChips(true);
        setStatus('已连接 Hermes');
        setTimeout(() => setStatus(''), 2500);
      } else {
        showOnboardCard('未检测到 Gateway：' + ((r && r.error) || '请在设置中填写 URL'));
        setStatus('');
      }
    } catch (e) {
      showOnboardCard(e && e.message ? e.message : String(e));
      setStatus('');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function runHermesSetup(btn) {
    if (typeof agent.hermesGatewaySetup !== 'function') return;
    if (btn) btn.disabled = true;
    setStatus('正在配置 Hermes Gateway…');
    try {
      const r = await agent.hermesGatewaySetup({ useDevStub: false });
      if (r && r.ok) {
        brainReady = true;
        removeOnboardCard();
        await refreshBrainLabel();
        const hasHistory = messagesEl.querySelectorAll('.copilot-msg').length > 0;
        if (!hasHistory) showExampleChips(true);
        setStatus('Hermes 已就绪');
        setTimeout(() => setStatus(''), 2500);
      } else {
        showOnboardCard('Gateway 未就绪：' + ((r && r.error) || (r && r.probe && r.probe.detail) || '请重试'));
        setStatus('');
      }
    } catch (e) {
      showOnboardCard(e && e.message ? e.message : String(e));
      setStatus('');
    } finally {
      if (btn) btn.disabled = false;
    }
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
      const hasMessages = messagesEl.querySelectorAll('.copilot-msg').length > 0;
      if (brainReady) {
        removeOnboardCard();
        if (!hasMessages && !turnBusy) showMemberOnboardCard('', { ready: true });
        else if (hasMessages) showExampleChips(false);
      } else {
        showExampleChips(false);
        let detail;
        if (typeof agent.loadSettings === 'function') {
          const s = await agent.loadSettings();
          const wantHermes = s && s.settings && s.settings.defaultBrainId === 'hermes';
          const gwOk = s && s.hermesGateway && s.hermesGateway.probe && s.hermesGateway.probe.ok;
          const wantCodex = s && s.settings && s.settings.defaultBrainId === 'codex';
          const authExists = s && s.codexAuth && s.codexAuth.exists;
          const sharedEnabled = s && s.settings && s.settings.codexSharedAuthEnabled;
          if (wantHermes && !gwOk) {
            detail = '已选择 Hermes，但 Gateway 未响应。请一键启动或检查 URL。';
          } else if (s && s.settings && s.settings.defaultBrainId === 'codex') {
            detail = '已选择 Codex CLI，但未检测到可用的 codex 命令。请先安装/登录 Codex CLI，或在设置中切换大脑。';
          }
          if (!wantCodex) {
            detail = '当前还没有切到团队推荐的 Codex。点击“切换到 Codex”即可。';
          } else if (sharedEnabled && !authExists) {
            detail = '团队凭据还没有写入本机。点击“刷新团队凭据并测试”。';
          } else if (!authExists) {
            detail = '本机还没有 Codex 登录态。可以刷新团队凭据，或在设置里配置凭据同步。';
          } else if (wantCodex) {
            detail = 'Codex 命令暂时不可用。请确认已安装 Codex CLI，或打开设置检查命令路径。';
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
  }

  function appendBubble(role, text, extraClass) {
    const div = document.createElement('div');
    div.className = 'copilot-msg copilot-msg-' + role + (extraClass ? ' ' + extraClass : '');
    div.textContent = text;
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
    title.textContent = (isExternalMcp ? '外部 Agent 请求执行：' : '确认执行：') + (ev.name || 'tool');
    const argsEl = document.createElement('div');
    if (isCodexFullAccess) title.textContent = '授权 Codex 本轮全权限';
    argsEl.className = 'copilot-confirm-args';
    try {
      argsEl.textContent = JSON.stringify(ev.arguments || {}, null, 2);
    } catch {
      argsEl.textContent = String(ev.arguments || '');
    }
    if (isCodexFullAccess) {
      argsEl.textContent = '允许后，本轮 Codex 可以读写工作目录并执行本机命令。拒绝则继续使用普通沙箱。';
    }
    const actions = document.createElement('div');
    actions.className = 'copilot-confirm-actions';
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'copilot-confirm-approve';
    approveBtn.textContent = '允许';
    const rejectBtn = document.createElement('button');
    approveBtn.textContent = '允许';
    rejectBtn.type = 'button';
    rejectBtn.className = 'copilot-confirm-reject';
    rejectBtn.textContent = '拒绝';
    actions.appendChild(approveBtn);
    rejectBtn.textContent = '拒绝';
    actions.appendChild(rejectBtn);
    const status = document.createElement('div');
    status.className = 'copilot-confirm-status';
    status.textContent = '等待你确认';
    card.appendChild(title);
    card.appendChild(argsEl);
    card.appendChild(actions);
    card.appendChild(status);
    messagesEl.appendChild(card);
    scrollMessagesToBottom();

    let settled = false;
    const settle = async (approved) => {
      if (settled) return;
      settled = true;
      card.classList.remove('is-error');
      card.classList.add('is-submitting');
      status.textContent = approved ? '已点击允许，正在继续...' : '已点击拒绝，正在取消...';
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      try {
        if (typeof agent.confirm === 'function') {
          const r = await agent.confirm(ev.confirmId, approved);
          if (!r || r.ok === false) throw new Error((r && r.error) || 'confirm_failed');
        }
        card.classList.remove('is-submitting');
        card.classList.add('copilot-confirm-settled');
        status.textContent = approved ? '已允许，Copilot 正在继续' : '已拒绝';
        setStatus(approved ? '已允许，正在继续...' : '已拒绝');
      } catch (e) {
        settled = false;
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
        card.classList.remove('is-submitting');
        card.classList.add('is-error');
        status.textContent = '提交失败：' + (e && e.message ? e.message : String(e));
        setStatus(status.textContent);
      }
    };
    approveBtn.addEventListener('click', () => void settle(true));
    rejectBtn.addEventListener('click', () => void settle(false));
    setTimeout(() => setStatus(isCodexFullAccess ? '等待授权...' : '等待确认...'), 0);
    setStatus('等待确认…');
  }

  function appendActivityCard(ev) {
    if (!ev || !messagesEl) return;
    const card = document.createElement('div');
    card.className = 'copilot-activity-card';
    if (ev.phase === 'error') card.classList.add('is-error');
    if (ev.phase === 'done') card.classList.add('is-done');
    const phaseText = ev.phase === 'start' ? '开始' : ev.phase === 'done' ? '完成' : '失败';
    const nameText = ev.name === 'codex.command' ? 'Codex 执行命令' : ev.name || '执行事件';
    const summary = document.createElement('div');
    summary.className = 'copilot-activity-summary';
    const title = document.createElement('span');
    title.className = 'copilot-activity-title';
    title.textContent = phaseText + ' · ' + nameText;
    const toggle = document.createElement('span');
    toggle.className = 'copilot-activity-toggle';
    toggle.textContent = '详情';
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
        toggle.textContent = expanded ? '收起' : '详情';
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
    if (m.authRequired || code === 'AGENT_AUTH_REQUIRED') {
      const session = authDiagnostics && authDiagnostics.session && typeof authDiagnostics.session === 'object'
        ? authDiagnostics.session
        : null;
      const diagnosticLine = authDiagnostics
        ? ' 当前 API：' + (authDiagnostics.apiOrigin || '-') +
          '，工作台：' + (authDiagnostics.siteOrigin || '-') +
          '，会话 Cookie：' + (session ? String(session.cookieCount || 0) : '未知') + '。'
        : '';
      return {
        kind: 'workbench-auth',
        title: '需要先登录工作台',
        description: (msg || 'Copilot 已经连到工作台接口，但当前工作台会话还没有登录。打开工作台完成登录后，可以直接重试。') + diagnosticLine,
      };
    }
    if (m.forbidden || code === 'AGENT_FORBIDDEN' || server.status === 403) {
      return {
        kind: 'forbidden',
        title: '当前账号没有权限',
        description: msg || '这次操作被工作台拒绝了。请切换到有权限的账号，或让管理员调整项目/能力权限后再试。',
      };
    }
    if (m.requiresFrontendAuthorization) {
      return {
        kind: 'frontend-auth',
        title: '需要在 Copilot 里授权',
        description: msg || '这个动作需要你在前端确认后才会继续执行，请保持 Copilot 打开并处理授权卡片。',
      };
    }
    if (m.projectRequired || code === 'AGENT_PROJECT_REQUIRED') {
      return {
        kind: 'project-required',
        title: '需要先有一个工作区项目',
        description: msg || '这次操作需要一个项目来承载结果。可以让 Copilot 先创建项目，再继续执行刚才的能力。',
      };
    }
    if (m.projectNotFound || code === 'AGENT_PROJECT_NOT_FOUND') {
      return {
        kind: 'project-not-found',
        title: '找不到这个项目',
        description: msg || '指定的项目不在当前工作台上下文里。先读取工作台上下文，确认可用项目后再继续。',
      };
    }
    if (m.assetNotFound || code === 'AGENT_ASSET_NOT_FOUND') {
      return {
        kind: 'asset-not-found',
        title: '找不到这个资产',
        description: msg || '指定的资产不在当前项目里。先列出当前项目资产，选择正确的 assetId 后再继续。',
      };
    }
    if (m.presetNotFound || code === 'AGENT_PRESET_NOT_FOUND') {
      return {
        kind: 'preset-not-found',
        title: '找不到这个能力',
        description: msg || '指定的能力预设不存在。先读取工作台上下文，确认 capabilityPresets 后再执行。',
      };
    }
    if (m.presetNotRunnable || code === 'AGENT_PRESET_NOT_DIRECT_RUNNABLE') {
      return {
        kind: 'preset-not-runnable',
        title: '这个能力不能直接由 Agent 执行',
        description: msg || '该能力需要工作台交互。请换用 directRunSupported=true 的能力，或在工作台里手动操作。',
      };
    }
    if (isWorkbench && m.retryable) {
      return {
        kind: 'workbench-retry',
        title: '工作台还没准备好',
        description: msg || '请确认主站服务可访问、工作台页面已经加载完成，然后重试。',
      };
    }
    return {
      kind: 'generic',
      title: '需要处理一下',
      description: msg || '刚才的任务没有顺利完成，可以让 Copilot 自己检查，或刷新团队凭据后再试。',
    };
  }

  function appendRecoveryCard(message, meta) {
    if (!messagesEl) return;
    const info = normalizeRecoveryInfo(message, meta);
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
    retryBtn.addEventListener('click', () => fillAndSend(lastUserPrompt || '请重试刚才的工作台操作。'));

    if (info.kind === 'workbench-auth' || info.kind === 'workbench-retry') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = info.kind === 'workbench-auth' ? '打开工作台登录' : '打开工作台';
      fixBtn.addEventListener('click', () => {
        switchToWorkbench();
        if (info.kind === 'workbench-retry' && typeof shell.workbenchReload === 'function') {
          void shell.workbenchReload();
        }
      });
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
      if (typeof shell.workbenchOpenExternal === 'function') {
        const externalBtn = document.createElement('button');
        externalBtn.type = 'button';
        externalBtn.className = 'copilot-onboard-btn';
        externalBtn.textContent = '浏览器打开';
        externalBtn.addEventListener('click', () => void shell.workbenchOpenExternal());
        actions.appendChild(externalBtn);
      }
    } else if (info.kind === 'forbidden') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '切到工作台';
      fixBtn.addEventListener('click', switchToWorkbench);
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'frontend-auth') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '查看授权';
      fixBtn.addEventListener('click', scrollMessagesToBottom);
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'project-required') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '创建项目并继续';
      fixBtn.addEventListener('click', () => fillAndSend('请先创建一个工作台项目，然后继续刚才的任务。'));
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'project-not-found' || info.kind === 'preset-not-found' || info.kind === 'preset-not-runnable') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '读取工作台上下文';
      fixBtn.addEventListener('click', () => fillAndSend('请读取工作台上下文，确认当前项目和可用能力，然后继续。'));
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else if (info.kind === 'asset-not-found') {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '列出当前资产';
      fixBtn.addEventListener('click', () => fillAndSend('请列出当前工作台项目的资产，确认正确的 assetId。'));
      actions.appendChild(fixBtn);
      actions.appendChild(retryBtn);
    } else {
      fixBtn.className = 'copilot-onboard-btn is-primary';
      fixBtn.textContent = '让 Copilot 自己检查';
      fixBtn.addEventListener('click', () => fillAndSend('刚才的任务失败了，请检查原因并给我一个修复方案。'));
      const authBtn = document.createElement('button');
      authBtn.type = 'button';
      authBtn.className = 'copilot-onboard-btn';
      authBtn.textContent = '刷新凭据并测试';
      authBtn.addEventListener('click', () => void refreshTeamCodexAndTest(authBtn));
      actions.appendChild(fixBtn);
      actions.appendChild(authBtn);
    }

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'copilot-onboard-btn';
    settingsBtn.textContent = '打开设置';
    settingsBtn.addEventListener('click', openCopilotSettings);
    actions.appendChild(settingsBtn);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(actions);
    messagesEl.appendChild(card);
    scrollMessagesToBottom();
  }

  function dismissPendingConfirmCards(confirmId) {
    const cards = confirmId
      ? messagesEl.querySelectorAll('.copilot-confirm-card[data-confirm-id="' + confirmId + '"]')
      : messagesEl.querySelectorAll('.copilot-confirm-card');
    cards.forEach((card) => {
      card.querySelectorAll('button').forEach((btn) => {
        btn.disabled = true;
      });
      const status = card.querySelector('.copilot-confirm-status');
      if (status) status.textContent = '已处理';
      card.classList.add('copilot-confirm-settled');
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
      const r = await agent.listMessages();
      if (!r || !r.ok || !Array.isArray(r.messages)) return;
      messagesEl.innerHTML = '';
      onboardEl = null;
      for (const m of r.messages) {
        if (m.role === 'user' || m.role === 'assistant') {
          appendBubble(m.role, m.content || '');
        } else if (m.role === 'tool') {
          appendBubble('tool', (m.name || 'tool') + '\n' + (m.content || ''), 'copilot-msg-tool');
        }
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
          brainLabel.title = '点击切换大脑（L2 跨脑，会话共用 messages.jsonl）';
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

  async function cycleBrain() {
    if (turnBusy || typeof agent.loadSettings !== 'function' || typeof agent.saveSettings !== 'function') return;
    try {
      const s = await agent.loadSettings();
      if (!s || !s.ok || !Array.isArray(s.brains) || !s.brains.length) return;
      const ids = s.brains.map((b) => b.id);
      const cur = (s.settings && s.settings.defaultBrainId) || s.activeBrainId || ids[0];
      const idx = Math.max(0, ids.indexOf(cur));
      const next = cur !== 'codex' && ids.includes('codex') ? 'codex' : ids[(idx + 1) % ids.length];
      setStatus('切换大脑…');
      const r = await agent.saveSettings({ defaultBrainId: next });
      if (r && r.ok) {
        await refreshBrainLabel();
        await refreshBrainStateCard({ forceProbe: true });
        await refreshOnboardingState();
        setStatus('已切换至 ' + next);
        setTimeout(() => setStatus(''), 2000);
      } else {
        setStatus('切换失败');
      }
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
    }
  }

  if (brainLabel) {
    brainLabel.style.cursor = 'pointer';
    brainLabel.addEventListener('click', () => void cycleBrain());
  }

  if (brainSettingsBtn) {
    brainSettingsBtn.setAttribute('aria-label', '大脑状态和权限');
    brainSettingsBtn.title = '大脑状态和权限';
    brainSettingsBtn.addEventListener('click', () => toggleBrainStateCard());
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

  if (typeof agent.onEvent === 'function') {
    agent.onEvent((ev) => {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'text_delta') {
        streamingText += ev.text || '';
        const bubble = ensureStreamBubble();
        bubble.textContent = streamingText;
        scrollMessagesToBottom();
      } else if (ev.type === 'tool_call') {
        appendBubble('tool', '▶ ' + (ev.name || 'tool'), 'copilot-msg-tool-call');
      } else if (ev.type === 'confirm_required') {
        showConfirmCard(ev);
      } else if (ev.type === 'confirm_cancelled') {
        dismissPendingConfirmCards(ev.confirmId);
        if (ev.reason === 'timeout') {
          setStatus('确认已超时');
          setTimeout(() => setStatus(''), 2500);
        }
      } else if (ev.type === 'tool_status') {
        if (ev.phase === 'error') {
          const structured = ev.structured && typeof ev.structured === 'object' ? ev.structured : {};
          appendRecoveryCard(ev.detail || structured.nextStep || '工具执行失败，可以查看详情或让 Copilot 自己检查。', {
            ...structured,
            tool: ev.name,
            errorCode: ev.errorCode,
          });
          appendBubble('tool', '✗ ' + (ev.name || '') + (ev.detail ? ': ' + ev.detail : ''), 'copilot-msg-tool');
        }
      } else if (ev.type === 'activity') {
        appendActivityCard(ev);
      } else if (ev.type === 'usage') {
        appendUsageCard(ev.usage);
        void refreshBrainStateCard();
      } else if (ev.type === 'done') {
        finishStream();
        dismissPendingConfirmCards();
        if (ev.stopReason === 'aborted') {
          setStatus('已停止');
        } else {
          setStatus('');
        }
      } else if (ev.type === 'error') {
        finishStream();
        appendRecoveryCard(ev.message || '任务失败了，可以刷新凭据、打开设置，或让 Copilot 自己检查。');
        setStatus(ev.message || '出错');
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
    appendBubble('user', text);
    inputEl.value = '';
    resizeComposer();
    showExampleChips(false);
    setStatus('思考中…');
    finishStream();
    try {
      const r = await agent.send(text);
      if (r && !r.ok && r.error) {
        setStatus(String(r.error));
        appendRecoveryCard(String(r.error));
      }
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
      appendRecoveryCard(e && e.message ? e.message : String(e));
    } finally {
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

  registerCopilotShellListeners();

  void (async () => {
    await applyCopilotLayoutFromMain();
    updateTokenUsageBar();
    resizeComposer();
    await loadHistory();
    ensureBrainStateCard();
    await refreshBrainStateCard({ forceProbe: true });
    await refreshOnboardingState();
  })();
})();
