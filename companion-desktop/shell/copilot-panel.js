(function () {
  'use strict';

  const shell = window.companionShell;
  const agent = shell && shell.agentSession;
  if (!agent) return;

  const root = document.getElementById('shell-copilot');
  const messagesEl = document.getElementById('copilot-messages');
  const inputEl = document.getElementById('copilot-input');
  const sendBtn = document.getElementById('copilot-send');
  const abortBtn = document.getElementById('copilot-abort');
  const toggleBtn = document.getElementById('copilot-toggle');
  const brainLabel = document.getElementById('copilot-brain-label');
  const statusEl = document.getElementById('copilot-status');
  const examplesEl = document.getElementById('copilot-examples');

  if (!root || !messagesEl || !inputEl || !sendBtn) return;

  let streamingText = '';
  let turnBusy = false;
  let brainReady = false;
  let onboardEl = null;

  const EXAMPLE_PHRASES = ['打开脚本页', '伴侣运行状态怎么样？', '切换到设置页'];

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
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
    for (const phrase of EXAMPLE_PHRASES) {
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
      if (typeof agent.probeBrain === 'function') {
        const p = await agent.probeBrain();
        if (p && p.ok !== false) activeId = p.brainId || activeId;
      }
      brainReady = activeId === 'hermes';
      const hasMessages = messagesEl.querySelectorAll('.copilot-msg').length > 0;
      if (brainReady) {
        removeOnboardCard();
        if (!hasMessages && !turnBusy) showExampleChips(true);
        else if (hasMessages) showExampleChips(false);
      } else {
        showExampleChips(false);
        let detail;
        if (typeof agent.loadSettings === 'function') {
          const s = await agent.loadSettings();
          const wantHermes = s && s.settings && s.settings.defaultBrainId === 'hermes';
          const gwOk = s && s.hermesGateway && s.hermesGateway.probe && s.hermesGateway.probe.ok;
          if (wantHermes && !gwOk) {
            detail = '已选择 Hermes，但 Gateway 未响应。请一键启动或检查 URL。';
          }
        }
        showOnboardCard(detail);
      }
      await refreshBrainLabel();
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
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
    const title = document.createElement('div');
    title.className = 'copilot-confirm-title';
    title.textContent = '确认执行：' + (ev.name || 'tool');
    const argsEl = document.createElement('div');
    argsEl.className = 'copilot-confirm-args';
    try {
      argsEl.textContent = JSON.stringify(ev.arguments || {}, null, 2);
    } catch {
      argsEl.textContent = String(ev.arguments || '');
    }
    const actions = document.createElement('div');
    actions.className = 'copilot-confirm-actions';
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'copilot-confirm-approve';
    approveBtn.textContent = '允许';
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'copilot-confirm-reject';
    rejectBtn.textContent = '拒绝';
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    card.appendChild(title);
    card.appendChild(argsEl);
    card.appendChild(actions);
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    let settled = false;
    const settle = (approved) => {
      if (settled) return;
      settled = true;
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      card.classList.add('copilot-confirm-settled');
      if (typeof agent.confirm === 'function') {
        void agent.confirm(ev.confirmId, approved);
      }
    };
    approveBtn.addEventListener('click', () => settle(true));
    rejectBtn.addEventListener('click', () => settle(false));
    setStatus('等待确认…');
  }

  function dismissPendingConfirmCards(confirmId) {
    const cards = confirmId
      ? messagesEl.querySelectorAll('.copilot-confirm-card[data-confirm-id="' + confirmId + '"]')
      : messagesEl.querySelectorAll('.copilot-confirm-card');
    cards.forEach((card) => {
      card.querySelectorAll('button').forEach((btn) => {
        btn.disabled = true;
      });
      card.classList.add('copilot-confirm-settled');
    });
  }

  function applyCopilotWidthPx(widthPx, collapsed) {
    const w = collapsed ? 48 : Math.min(640, Math.max(240, Number(widthPx) || 360));
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
          brainLabel.textContent = s.activeBrainId || (s.settings && s.settings.defaultBrainId) || 'stub';
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
      const cur = s.activeBrainId || (s.settings && s.settings.defaultBrainId) || ids[0];
      const idx = Math.max(0, ids.indexOf(cur));
      const next = ids[(idx + 1) % ids.length];
      setStatus('切换大脑…');
      const r = await agent.saveSettings({ defaultBrainId: next });
      if (r && r.ok) {
        await refreshBrainLabel();
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

  async function applyCopilotLayoutFromMain() {
    if (typeof shell.getCopilotLayout !== 'function') return;
    try {
      const r = await shell.getCopilotLayout();
      if (!r || !r.ok) return;
      applyCopilotWidthPx(r.widthPx, Boolean(r.collapsed));
      document.body.classList.toggle('shell-copilot-collapsed', Boolean(r.collapsed));
      if (toggleBtn) {
        toggleBtn.textContent = r.collapsed ? '▶' : '◀';
        toggleBtn.setAttribute('aria-expanded', r.collapsed ? 'false' : 'true');
        toggleBtn.title = r.collapsed ? '展开 Copilot' : '收起 Copilot';
      }
    } catch {
      /* ignore */
    }
  }

  async function persistCopilotCollapsed(collapsed) {
    document.body.classList.toggle('shell-copilot-collapsed', collapsed);
    if (toggleBtn) {
      toggleBtn.textContent = collapsed ? '▶' : '◀';
    }
    if (typeof shell.setCopilotLayout === 'function') {
      try {
        await shell.setCopilotLayout({ collapsed });
      } catch {
        /* ignore */
      }
    }
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggleBtn.title = collapsed ? '展开 Copilot' : '收起 Copilot';
    }
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
        messagesEl.scrollTop = messagesEl.scrollHeight;
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
          appendBubble('tool', '✗ ' + (ev.name || '') + (ev.detail ? ': ' + ev.detail : ''), 'copilot-msg-tool');
        }
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
    if (sendBtn) sendBtn.disabled = true;
    if (abortBtn) abortBtn.disabled = false;
    appendBubble('user', text);
    inputEl.value = '';
    showExampleChips(false);
    setStatus('思考中…');
    finishStream();
    try {
      const r = await agent.send(text);
      if (r && !r.ok && r.error) {
        setStatus(String(r.error));
      }
    } catch (e) {
      setStatus(e && e.message ? e.message : String(e));
    } finally {
      turnBusy = false;
      if (sendBtn) sendBtn.disabled = false;
      if (abortBtn) abortBtn.disabled = true;
    }
  }

  sendBtn.addEventListener('click', () => void sendMessage());
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
    await loadHistory();
    await refreshOnboardingState();
  })();
})();
