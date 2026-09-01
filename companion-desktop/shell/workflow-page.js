/**
 * Replay room: list frozen 代工单 cards (description + execute).
 * Code view remains `workflow`. Execute hands off to the butler.
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function compact(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || fallback || '';
  }

  function userSummaryOf(workflow) {
    return workflow && workflow.userSummary && typeof workflow.userSummary === 'object' ? workflow.userSummary : {};
  }

  function replayTitle(workflow) {
    const summary = userSummaryOf(workflow);
    return compact(summary.title || (workflow && workflow.name) || (workflow && workflow.id), '技能');
  }

  function replayDescription(workflow) {
    const summary = userSummaryOf(workflow);
    return [summary.inputSummary, summary.outputSummary].map((part) => compact(part, '')).filter(Boolean).join(' ');
  }

  function replaySlots(workflow) {
    const contract = workflow && workflow.aiContract && typeof workflow.aiContract === 'object' ? workflow.aiContract : {};
    const schema = contract.inputSchema && typeof contract.inputSchema === 'object' ? contract.inputSchema : {};
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    return Object.keys(properties);
  }

  function statusLabel(status) {
    switch (status) {
      case 'succeeded':
        return '成功';
      case 'preflight_failed':
        return '检查未通过';
      case 'failed':
        return '失败';
      case 'running':
        return '运行中';
      default:
        return status ? String(status) : '';
    }
  }

  function lastRunLine(lastRun) {
    if (!lastRun || !lastRun.status) return '';
    return compact(statusLabel(lastRun.status), '');
  }

  function skillMatchesFilters(workflow, opts) {
    const filterSource = opts && opts.filterSource ? String(opts.filterSource) : 'all';
    const q = opts && opts.searchQuery ? String(opts.searchQuery).trim().toLowerCase() : '';
    if (filterSource === 'mine' && workflow.origin !== 'shelf' && workflow.origin !== 'example') return false;
    if (filterSource === 'local' && !workflow.hasLocal) return false;
    if (filterSource === 'cloud' && !workflow.hasCloud) return false;
    if (!q) return true;
    const summary = userSummaryOf(workflow);
    const hay = [
      replayTitle(workflow),
      workflow && workflow.id,
      workflow && workflow.name,
      summary.inputSummary,
      summary.outputSummary,
      workflow && workflow.skillPrompt,
      ...asArray(workflow && workflow.tags),
    ]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return hay.includes(q);
  }

  function renderReplayCardHtml(workflow, lastRun) {
    const title = replayTitle(workflow);
    const description = replayDescription(workflow);
    const recent = lastRunLine(lastRun);
    const actions = ['<button type="button" class="workflow-card-action primary" data-action="execute">执行</button>'];
    if (workflow && workflow.removable) {
      actions.push('<button type="button" class="workflow-card-action" data-action="remove">移除</button>');
    }
    if (workflow && workflow.publishable) {
      actions.push('<button type="button" class="workflow-card-action" data-action="publish">上云</button>');
    }
    if (workflow && workflow.installable) {
      actions.push('<button type="button" class="workflow-card-action" data-action="install">安装</button>');
    }
    return (
      '<div class="workflow-card-head">' +
      '<div class="workflow-card-title">' +
      esc(title) +
      '</div>' +
      '</div>' +
      '<div class="workflow-card-desc">' +
      esc(description) +
      '</div>' +
      (recent ? '<div class="workflow-card-last">' + esc(recent) + '</div>' : '') +
      '<div class="workflow-card-actions">' +
      actions.join('') +
      '</div>'
    );
  }

  function ensureStyles() {
    if (document.getElementById('workflow-page-style')) return;
    const style = document.createElement('style');
    style.id = 'workflow-page-style';
    style.textContent = `
      .workflow-shell {
        min-height: 100%;
        padding: 16px;
        background: #111113;
      }
      .workflow-page-header {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 12px;
        margin-bottom: 12px;
      }
      .workflow-page-header h1 {
        margin: 0;
        flex: 1;
        color: rgba(232, 230, 225, 0.96);
        font-size: 16px;
        line-height: 1.25;
      }
      .workflow-icon-btn {
        width: 30px;
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.045);
        color: rgba(232, 230, 225, 0.9);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .workflow-icon-btn:hover { border-color: rgba(201, 163, 106, 0.48); background: rgba(201, 163, 106, 0.12); }
      .workflow-icon-btn svg { width: 16px; height: 16px; }
      .workflow-inline-status {
        min-height: 18px;
        margin-bottom: 10px;
        color: rgba(139, 139, 147, 0.95);
        font-size: 12px;
      }
      .workflow-empty { padding: 28px 8px; color: rgba(139, 139, 147, 0.95); }
      .workflow-empty-title { color: rgba(232, 230, 225, 0.92); font-size: 14px; margin-bottom: 6px; }
      .workflow-empty-sub { font-size: 12px; }
      .workflow-empty .connections-primary-btn { margin-top: 14px; }
      .workflow-list { display: flex; flex-direction: column; gap: 10px; }
      .workflow-card {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.03);
        padding: 12px;
      }
      .workflow-card-title { color: rgba(232, 230, 225, 0.96); font-size: 13px; font-weight: 600; }
      .workflow-card-desc { margin-top: 6px; color: rgba(139, 139, 147, 0.95); font-size: 12px; line-height: 1.45; }
      .workflow-card-last { margin-top: 8px; color: rgba(139, 139, 147, 0.88); font-size: 11px; }
      .workflow-card-actions { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
      .workflow-card-action {
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(232, 230, 225, 0.9);
        font-size: 12px;
        font-weight: 600;
        padding: 7px 14px;
        cursor: pointer;
      }
      .workflow-card-action:hover { border-color: rgba(201, 163, 106, 0.4); }
      .workflow-card-action.primary {
        border: 0;
        border-radius: 8px;
        background: #c9a36a;
        color: #0b0b0d;
        font-size: 12px;
        font-weight: 600;
        padding: 7px 14px;
        cursor: pointer;
      }
      .workflow-card-action.primary:hover { filter: brightness(1.06); }
      .workflow-card-action.primary:disabled { opacity: 0.52; cursor: wait; }
      .workflow-toolbar { margin-bottom: 10px; }
    `;
    document.head.appendChild(style);
  }

  window.ShellWorkflowPage = {
    workflows: [],
    historyRuns: [],
    runsByWorkflowId: new Map(),
    inlineStatus: '',
    searchQuery: '',
    filterSource: 'all',
    _shell: null,
    _bound: false,
    renderReplayCardHtml: renderReplayCardHtml,
    replayTitle: replayTitle,
    replayDescription: replayDescription,
    replaySlots: replaySlots,
    skillMatchesFilters: skillMatchesFilters,

    getFilteredWorkflows() {
      return asArray(this.workflows).filter(
        (item) => item && item.id && skillMatchesFilters(item, { filterSource: this.filterSource, searchQuery: this.searchQuery }),
      );
    },

    async loadWorkflows() {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return [];
      const r = await shell.api('GET', '/v1/workflows/skills', null);
      if (!r || !r.ok || !r.json || !Array.isArray(r.json.workflows)) {
        throw new Error((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '读取技能失败');
      }
      return r.json.workflows;
    },

    async loadRuns() {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return [];
      const r = await shell.api('GET', '/v1/workflows/runs', null);
      if (!r || !r.ok || !r.json || !Array.isArray(r.json.runs)) return [];
      return r.json.runs;
    },

    indexRuns() {
      const next = new Map();
      for (const run of asArray(this.historyRuns)) {
        if (!run || !run.workflow_id || next.has(run.workflow_id)) continue;
        next.set(run.workflow_id, run);
      }
      this.runsByWorkflowId = next;
    },

    setInline(message) {
      this.inlineStatus = compact(message, '');
      const el = $('workflowInlineStatus');
      if (el) el.textContent = this.inlineStatus;
    },

    buildReplayHandoff(workflow) {
      const title = replayTitle(workflow);
      const slots = replaySlots(workflow);
      const lastRun = this.runsByWorkflowId.get(workflow.id);
      return {
        domain: 'replay',
        kind: 'replay_run',
        replayId: workflow.id,
        label: title,
        surface: 'workflow',
        slots: slots,
        lastDefaults: lastRun && lastRun.normalized_input && typeof lastRun.normalized_input === 'object'
          ? lastRun.normalized_input
          : lastRun && lastRun.input && typeof lastRun.input === 'object'
            ? lastRun.input
            : {},
        contextPrompt: [
          workflow && (workflow.replayKind === 'manual' || workflow.replayKind === 'skill')
            ? '当前是技能卡。本机没有自动执行器。按标题和描述办事（可用 connection_list / connection_probe / host_invoke_primitive）。禁止调用 replay_run。禁止假装已有 Unreal 执行器。'
            : '当前技能已绑执行器。步骤已钉死，只确认变动格，然后调用 replay_run。不要改工序。',
          'replayId=' + (workflow.id || ''),
          'title=' + title,
          'slots=' + (slots.length ? slots.join(',') : '(none)'),
          replayDescription(workflow),
          workflow && workflow.skillPrompt ? String(workflow.skillPrompt) : '',
        ].filter(Boolean).join('\n'),
        suggestedMessage:
          workflow && (workflow.replayKind === 'manual' || workflow.replayKind === 'skill')
            ? '请按这张技能办事：' + title + '。不要调用 replay_run。'
            : '请按这张技能跑：' + title + '。确认变动格后调用 replay_run。',
        composerText:
          workflow && (workflow.replayKind === 'manual' || workflow.replayKind === 'skill')
            ? '请按这张技能办事：' + title + '。不要调用 replay_run。'
            : '请按这张技能跑：' + title + '。确认变动格后调用 replay_run。',
      };
    },

    async executeReplay(workflow) {
      const shell = this._shell;
      if (!shell || typeof shell.openDshHandoff !== 'function') {
        this.setInline('当前壳版本还不支持管家办事入口。');
        return { ok: false };
      }
      const payload = this.buildReplayHandoff(workflow);
      const r = await shell.openDshHandoff(payload);
      if (!r || r.ok === false) {
        this.setInline('管家入口打开失败：' + ((r && r.error) || '未知错误'));
        return r || { ok: false };
      }
      this.setInline('已填入管家输入框，确认后点发送即可。');
      return r;
    },

    async removeSkill(workflow) {
      const shell = this._shell;
      const id = workflow && workflow.id ? String(workflow.id) : '';
      if (!id || !shell || typeof shell.api !== 'function') return { ok: false };
      if (!window.confirm('移除「' + replayTitle(workflow) + '」？本机货架上的技能会被删掉。')) return { ok: false };
      const r = await shell.api('DELETE', '/v1/workflows/skills/' + encodeURIComponent(id), null);
      if (!r || !r.ok) {
        this.setInline('移除失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.error) || '未知错误'));
        return r || { ok: false };
      }
      this.setInline('已移除。');
      await this.reload(shell);
      return r;
    },

    async publishSkill(workflow) {
      const shell = this._shell;
      const id = workflow && workflow.id ? String(workflow.id) : '';
      if (!id || !shell || typeof shell.api !== 'function') return { ok: false };
      if (!window.confirm('将「' + replayTitle(workflow) + '」提交到云端？云端会保留历史版本。')) return { ok: false };
      const versionNote = window.prompt('填写本次云端版本说明', '');
      if (versionNote == null) return { ok: false };
      if (!String(versionNote).trim()) {
        this.setInline('版本说明不能为空。');
        return { ok: false };
      }
      const semver = window.prompt('填写版本号', '1.0.0');
      if (semver == null) return { ok: false };
      const r = await shell.api(
        'POST',
        '/v1/workflows/skills/' + encodeURIComponent(id) + '/cloud',
        {
          semver: String(semver || '').trim(),
          versionNote: String(versionNote || '').trim(),
          isAdmin: true,
          actorRole: 'admin',
        },
        { timeoutMs: 60000 },
      );
      if (!r || !r.ok) {
        this.setInline('上云失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.error) || '未知错误'));
        return r || { ok: false };
      }
      this.setInline('已提交到云端。');
      await this.reload(shell);
      return r;
    },

    async installSkill(workflow) {
      const shell = this._shell;
      const id = workflow && workflow.id ? String(workflow.id) : '';
      if (!id || !shell || typeof shell.api !== 'function') return { ok: false };
      const r = await shell.api('POST', '/v1/workflows/skills/' + encodeURIComponent(id) + '/install-cloud', {});
      if (!r || !r.ok) {
        this.setInline('安装失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.error) || '未知错误'));
        return r || { ok: false };
      }
      this.setInline('已安装到本机货架。');
      await this.reload(shell);
      return r;
    },

    buildReplayCompileHandoff() {
      return {
        domain: 'replay',
        kind: 'replay_compile',
        surface: 'workflow',
        label: '整理成技能',
        contextPrompt: '用户要把刚才那套整理成技能。先看痕迹再 replay_compile。不要凭空编单。写成 SKILL.md 存到技能房间。',
        suggestedMessage: '把刚才那套整理成技能',
        composerText: '把刚才那套整理成技能',
      };
    },

    async compileReplayWithButler() {
      const shell = this._shell;
      if (!shell || typeof shell.openDshHandoff !== 'function') {
        this.setInline('当前壳版本还不支持管家办事入口。');
        return { ok: false };
      }
      const r = await shell.openDshHandoff(this.buildReplayCompileHandoff());
      if (!r || r.ok === false) {
        this.setInline('管家入口打开失败：' + ((r && r.error) || '未知错误'));
        return r || { ok: false };
      }
      this.setInline('已填入管家输入框，确认后点发送即可。');
      return r;
    },

    renderCard(workflow) {
      const card = document.createElement('article');
      card.className = 'workflow-card';
      card.dataset.workflowId = workflow && workflow.id ? workflow.id : '';
      card.innerHTML = renderReplayCardHtml(workflow, this.runsByWorkflowId.get(workflow && workflow.id));
      card.querySelector('[data-action="execute"]')?.addEventListener('click', () => {
        void this.executeReplay(workflow);
      });
      card.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
        void this.removeSkill(workflow);
      });
      card.querySelector('[data-action="publish"]')?.addEventListener('click', () => {
        void this.publishSkill(workflow);
      });
      card.querySelector('[data-action="install"]')?.addEventListener('click', () => {
        void this.installSkill(workflow);
      });
      return card;
    },

    render() {
      ensureStyles();
      const list = $('workflowList');
      const empty = $('workflowEmpty');
      const status = $('workflowInlineStatus');
      if (status) status.textContent = this.inlineStatus;
      if (!list || !empty) return;
      const all = asArray(this.workflows).filter((item) => item && item.id);
      const items = this.getFilteredWorkflows();
      list.innerHTML = '';
      if (!all.length) {
        empty.classList.remove('hidden');
        list.classList.add('hidden');
        return;
      }
      empty.classList.add('hidden');
      list.classList.remove('hidden');
      list.className = 'workflow-list';
      if (!items.length) {
        const none = document.createElement('p');
        none.className = 'tools-empty';
        none.textContent = '无匹配技能';
        list.appendChild(none);
        return;
      }
      for (const workflow of items) {
        list.appendChild(this.renderCard(workflow));
      }
    },

    async reload(shell) {
      if (shell) this._shell = shell;
      try {
        const [workflows, runs] = await Promise.all([this.loadWorkflows(), this.loadRuns()]);
        this.workflows = workflows;
        this.historyRuns = runs;
        this.indexRuns();
        this.render();
      } catch (e) {
        this.setInline(e instanceof Error ? e.message : String(e));
        this.render();
      }
    },

    async onViewShown(shell) {
      this._shell = shell || this._shell;
      await this.reload(this._shell);
    },

    bind(shell) {
      this._shell = shell || this._shell;
      if (this._bound) return;
      this._bound = true;
      ensureStyles();
      $('btnWorkflowRefresh')?.addEventListener('click', () => void this.reload(this._shell));
      $('btnReplayCompileWithButler')?.addEventListener('click', () => void this.compileReplayWithButler());
      $('btnReplayCompileWithButlerEmpty')?.addEventListener('click', () => void this.compileReplayWithButler());
      $('skillSearchInput')?.addEventListener('input', (ev) => {
        this.searchQuery = ev.target && ev.target.value != null ? String(ev.target.value) : '';
        this.render();
      });
      document.querySelectorAll('#skillFilterRow [data-skill-filter-source]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const v = btn.getAttribute('data-skill-filter-source') || 'all';
          this.filterSource = v === 'local' || v === 'cloud' || v === 'mine' ? v : 'all';
          document.querySelectorAll('#skillFilterRow [data-skill-filter-source]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-skill-filter-source') === this.filterSource);
          });
          this.render();
        });
      });
    },
  };
})();
