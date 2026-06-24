/**
 * Tools page: unified local + cloud list, search, filters, tags.
 */
(function () {
  'use strict';

  const EXAMPLE_TOOL_ID = 'image-format-converter';
  const INSTALL_TIMEOUT_MS = 600000;
  const ICON_LOCAL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>';
  const ICON_CLOUD =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';

  const ERROR_MESSAGES = {
    tool_not_found: '未找到该工具（可能已卸载）',
    tool_invalid_manifest: '工具包清单无效，请重新安装',
    install_checksum_mismatch: '下载校验失败（sha256 或大小不符）',
    install_staging_failed: '安装未完成，已保留旧版本',
    install_failed: '安装失败',
    example_tool_unavailable: '当前环境未找到内置示例包',
  };

  function semverGreater(a, b) {
    const pa = String(a || '')
      .split('.')
      .map((x) => parseInt(String(x).replace(/\D/g, ''), 10) || 0);
    const pb = String(b || '')
      .split('.')
      .map((x) => parseInt(String(x).replace(/\D/g, ''), 10) || 0);
    const n = Math.max(pa.length, pb.length, 3);
    for (let i = 0; i < n; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s || '').replace(/</g, '&lt;');
  }

  function formatShellToolError(code, message) {
    const c = String(code || '').trim();
    const base = ERROR_MESSAGES[c] || c || '未知错误';
    const detail = message && String(message).trim() && String(message).trim() !== c ? String(message).trim() : '';
    return detail ? base + '：' + detail : base;
  }

  function parseCatalogNotes(notes) {
    const n = String(notes || '').trim();
    let tags = [];
    let description = '';
    let toolId = '';
    const toolIdMatch = n.match(/#toolId:([a-z][a-z0-9-]{1,63})/i);
    if (toolIdMatch) toolId = toolIdMatch[1];
    const tagMatch = n.match(/#tags:([^\n#]+)/i);
    if (tagMatch) {
      tags = tagMatch[1]
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      description = n.replace(/#tags:[^\n#]+/i, '').replace(/#toolId:[^\n#]+/i, '').trim();
    } else if (n && !n.startsWith('#')) {
      description = n.replace(/#toolId:[^\n#]+/i, '').trim();
    }
    return { tags, description, toolId };
  }

  function catalogToolKey(b) {
    const meta = parseCatalogNotes(b && b.notes);
    if (meta.toolId) return meta.toolId;
    const label = String(b && b.label ? b.label : '').trim();
    if (/^[a-z][a-z0-9-]{1,63}$/.test(label)) return label;
    const fn = String(b && b.fileName ? b.fileName : '')
      .replace(/\.zip$/i, '')
      .trim();
    const m = fn.match(/^([a-z][a-z0-9-]{1,63})-\d+\.\d+/);
    if (m) return m[1];
    return label || String(b && b.id ? b.id : '').trim();
  }

  function pickLatestCatalogBundles(catalog) {
    const bundles = (catalog || []).filter((a) => a && a.kind === 'shell_tool_bundle' && a.sha256);
    const byKey = new Map();
    for (const b of bundles) {
      const key = catalogToolKey(b);
      const prev = byKey.get(key);
      if (!prev || semverGreater(b.semver, prev.semver)) byKey.set(key, b);
    }
    return byKey;
  }

  function mergeTags(...lists) {
    const out = [];
    for (const list of lists) {
      for (const t of list || []) {
        const s = String(t || '').trim();
        if (s && !out.includes(s)) out.push(s);
      }
    }
    return out;
  }

  function buildUnifiedEntries(installed, catalogByKey, exampleMeta) {
    /** @type {Map<string, object>} */
    const map = new Map();

    for (const t of installed || []) {
      if (!t || !t.id) continue;
      map.set(t.id, {
        id: t.id,
        name: t.name || t.id,
        description: t.description || '',
        tags: Array.isArray(t.tags) ? [...t.tags] : [],
        local: t,
        cloud: null,
        builtin: false,
        semverLocal: t.semver,
        semverCloud: null,
      });
    }

    for (const [id, bundle] of catalogByKey.entries()) {
      const meta = parseCatalogNotes(bundle.notes);
      const cur = map.get(id) || {
        id,
        name: bundle.label || id,
        description: meta.description,
        tags: [],
        local: null,
        cloud: null,
        builtin: false,
        semverLocal: null,
        semverCloud: null,
      };
      cur.cloud = bundle;
      cur.semverCloud = bundle.semver;
      if (!cur.local) {
        cur.name = bundle.label || cur.name || id;
        if (meta.description) cur.description = meta.description;
      }
      cur.tags = mergeTags(cur.tags, meta.tags);
      map.set(id, cur);
    }

    if (exampleMeta && exampleMeta.available && !map.has(exampleMeta.toolId || EXAMPLE_TOOL_ID)) {
      const id = exampleMeta.toolId || EXAMPLE_TOOL_ID;
      map.set(id, {
        id,
        name: exampleMeta.name || '图片格式转换',
        description: exampleMeta.description || '为指定文件夹内图片批量转换格式（内置示例包）',
        tags: mergeTags(exampleMeta.tags, ['示例']),
        local: null,
        cloud: null,
        builtin: true,
        semverLocal: null,
        semverCloud: exampleMeta.semver || '1.0.0',
      });
    }

    return Array.from(map.values()).map((e) => {
      const hasLocal = Boolean(e.local);
      const hasCloud = Boolean(e.cloud) || Boolean(e.builtin);
      const needsUpgrade = hasLocal && hasCloud && semverGreater(e.semverCloud, e.semverLocal);
      const canDownload = (!hasLocal && hasCloud) || needsUpgrade;
      return {
        ...e,
        hasLocal,
        hasCloud,
        needsUpgrade,
        canDownload,
        displaySemver: e.semverLocal || e.semverCloud || '—',
      };
    });
  }

  function countDownloadable(entries) {
    return (entries || []).filter((e) => e.canDownload).length;
  }

  window.ShellToolsPage = {
    mergedEntries: [],
    catalogError: null,
    listError: null,
    filterSource: 'all',
    filterTag: '',
    searchQuery: '',
    pendingUpdateCount: 0,
    _busyIds: new Set(),
    _shell: null,
    _listSignature: '',
    _reloadGen: 0,

    listSignature(entries) {
      return JSON.stringify(
        (entries || []).map((e) => ({
          id: e.id,
          semverLocal: e.semverLocal,
          semverCloud: e.semverCloud,
          hasLocal: e.hasLocal,
          hasCloud: e.hasCloud,
          canDownload: e.canDownload,
          tags: e.tags,
        })),
      );
    },

    async listInstalled(shell) {
      const r = await shell.api('GET', '/v1/shell-tools', null);
      if (!r.ok) {
        return {
          __listError: formatShellToolError(r.json && r.json.error, r.json && (r.json.message || r.error)),
        };
      }
      if (!r.json || !Array.isArray(r.json.tools)) {
        return { __listError: '伴侣返回格式异常' };
      }
      return r.json.tools;
    },

    async fetchCatalog(shell) {
      if (typeof shell.fetchShellToolCatalog === 'function') {
        const r = await shell.fetchShellToolCatalog();
        if (r && r.ok && Array.isArray(r.artifacts)) return r.artifacts;
        if (r && !r.ok && r.error) return { __catalogError: formatShellToolError(r.error, r.error) };
      }
      return [];
    },

    async fetchExampleMeta(shell) {
      if (typeof shell.builtinExampleAvailable === 'function') {
        try {
          const shellR = await shell.builtinExampleAvailable();
          if (shellR && shellR.ok && shellR.available) {
            return {
              available: true,
              toolId: shellR.toolId || EXAMPLE_TOOL_ID,
              name: shellR.name,
              description: shellR.description,
              semver: shellR.semver,
              tags: Array.isArray(shellR.tags) ? shellR.tags : [],
            };
          }
        } catch {
          /* fall through */
        }
      }
      const r = await shell.api('GET', '/v1/shell-tools/example-available', null);
      if (!r.ok || !r.json || !r.json.available) return { available: false };
      return {
        available: true,
        toolId: r.json.toolId || EXAMPLE_TOOL_ID,
        name: r.json.name,
        description: r.json.description,
        semver: r.json.semver,
        tags: Array.isArray(r.json.tags) ? r.json.tags : [],
      };
    },

    updateNavBadge(count) {
      this.pendingUpdateCount = count;
      const badge = $('toolsNavBadge');
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.classList.remove('hidden');
        badge.setAttribute('aria-label', count + ' 个小工具可更新');
      } else {
        badge.textContent = '';
        badge.classList.add('hidden');
        badge.removeAttribute('aria-label');
      }
    },

    setStatusHint(text, isError) {
      const el = $('toolsStatusHint');
      if (!el) return;
      const t = String(text || '').trim();
      if (!t) {
        el.textContent = '';
        el.classList.add('hidden');
        return;
      }
      el.textContent = t;
      el.classList.remove('hidden');
      el.style.color = isError ? '#fca5a5' : '';
    },

    composeStatusHints() {
      const parts = [];
      if (this.listError) parts.push('本地列表：' + this.listError);
      if (this.catalogError) parts.push('发行目录：' + this.catalogError);
      if (parts.length) this.setStatusHint(parts.join('；'), true);
      else this.setStatusHint('');
    },

    async reloadAll(shell) {
      this._shell = shell;
      const gen = ++this._reloadGen;
      const btnRefresh = $('btnToolsRefresh');
      if (btnRefresh) btnRefresh.disabled = true;

      try {
        const installedResult = await this.listInstalled(shell);
        if (gen !== this._reloadGen) return;

        const catalog = await this.fetchCatalog(shell);
        if (gen !== this._reloadGen) return;

        const exampleMeta = await this.fetchExampleMeta(shell);
        if (gen !== this._reloadGen) return;

        let installed = [];
        this.listError = null;
        if (Array.isArray(installedResult)) {
          installed = installedResult;
        } else if (installedResult && installedResult.__listError) {
          this.listError = installedResult.__listError;
        }

        if (catalog && catalog.__catalogError) {
          this.catalogError = catalog.__catalogError;
        } else {
          this.catalogError = null;
        }
        const catalogList = catalog && catalog.__catalogError ? [] : catalog;
        const catalogByKey = pickLatestCatalogBundles(catalogList);
        const nextEntries = buildUnifiedEntries(installed, catalogByKey, exampleMeta);
        const nextSig = this.listSignature(nextEntries);
        const tagsChanged =
          JSON.stringify(this.collectAllTags(this.mergedEntries)) !== JSON.stringify(this.collectAllTags(nextEntries));
        this.mergedEntries = nextEntries;
        this.updateNavBadge(countDownloadable(this.mergedEntries));
        if (nextSig !== this._listSignature || tagsChanged) {
          this._listSignature = nextSig;
          this.renderTagFilters();
          this.renderGrid();
        }
        this.composeStatusHints();
      } finally {
        if (btnRefresh) btnRefresh.disabled = false;
      }
    },

    collectAllTags(entries) {
      const tags = [];
      for (const e of entries || []) {
        for (const t of e.tags || []) {
          if (!tags.includes(t)) tags.push(t);
        }
      }
      return tags.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    },

    getFilteredEntries() {
      const q = this.searchQuery.trim().toLowerCase();
      return this.mergedEntries.filter((e) => {
        if (this.filterSource === 'local' && !e.hasLocal) return false;
        if (this.filterSource === 'cloud' && !e.hasCloud) return false;
        if (this.filterTag && !(e.tags || []).includes(this.filterTag)) return false;
        if (!q) return true;
        const hay = [e.name, e.id, e.description, ...(e.tags || [])].join(' ').toLowerCase();
        return hay.includes(q);
      });
    },

    renderTagFilters() {
      const host = $('toolsTagFilters');
      if (!host) return;
      const tags = [];
      for (const e of this.mergedEntries) {
        for (const t of e.tags || []) {
          if (!tags.includes(t)) tags.push(t);
        }
      }
      tags.sort((a, b) => a.localeCompare(b, 'zh-CN'));
      host.innerHTML = '';
      for (const tag of tags) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tools-filter-chip' + (this.filterTag === tag ? ' active' : '');
        btn.textContent = tag;
        btn.setAttribute('data-filter-tag', tag);
        btn.addEventListener('click', () => {
          this.filterTag = this.filterTag === tag ? '' : tag;
          this.renderTagFilters();
          this.renderGrid();
        });
        host.appendChild(btn);
      }
    },

    renderGrid() {
      const grid = $('toolsGrid');
      if (!grid) return;
      grid.innerHTML = '';
      const entries = this.getFilteredEntries();
      const shell = this._shell;

      if (entries.length === 0) {
        grid.appendChild(
          Object.assign(document.createElement('p'), {
            className: 'tools-empty',
            textContent: this.mergedEntries.length ? '无匹配工具' : '暂无工具，请检查发行目录或安装示例',
          }),
        );
        return;
      }

      for (const e of entries) {
        const wrap = document.createElement('div');
        wrap.className = 'tools-card-wrap';

        const card = document.createElement('div');
        card.className = 'tools-card' + (this._busyIds.has(e.id) ? ' is-busy' : '');
        card.setAttribute('data-tool-id', e.id);

        const subParts = [e.id];
        if (e.semverLocal && e.semverCloud && e.needsUpgrade) {
          subParts.push('v' + e.semverLocal + ' → v' + e.semverCloud);
        } else {
          subParts.push('v' + e.displaySemver);
        }

        const tagsHtml = (e.tags || [])
          .map((t) => '<span class="tools-card-tag">' + esc(t) + '</span>')
          .join('');

        card.innerHTML =
          '<div class="tools-card-top">' +
          '<div class="tools-card-origins">' +
          '<span class="tools-origin local' +
          (e.hasLocal ? ' on' : '') +
          '" title="本地已安装">' +
          ICON_LOCAL +
          '</span>' +
          '<span class="tools-origin cloud' +
          (e.hasCloud ? ' on' : '') +
          '" title="云端可用">' +
          ICON_CLOUD +
          '</span>' +
          '</div>' +
          '<span class="tools-card-badge' +
          (e.canDownload ? '' : ' hidden') +
          '">' +
          (e.needsUpgrade ? '可更新' : '可下载') +
          '</span>' +
          '</div>' +
          '<div class="tools-card-title">' +
          esc(e.name) +
          '</div>' +
          '<div class="tools-card-sub">' +
          esc(subParts.join(' · ')) +
          '</div>' +
          '<div class="tools-card-desc">' +
          esc(e.description) +
          '</div>' +
          (tagsHtml ? '<div class="tools-card-tags">' + tagsHtml + '</div>' : '') +
          '<div class="tools-card-foot">' +
          '<button type="button" class="tools-card-action tools-card-dl' +
          (e.canDownload ? '' : ' hidden') +
          '">' +
          (e.needsUpgrade ? '更新' : '下载') +
          '</button>' +
          '<button type="button" class="tools-card-action tools-card-open' +
          (e.hasLocal ? '' : ' hidden') +
          '">打开</button>' +
          '</div>';

        card.addEventListener('click', (ev) => {
          if (ev.target.closest('.tools-card-action') || ev.target.closest('.tools-card-uninstall')) return;
          if (!e.hasLocal && e.canDownload) void this.installEntry(shell, e);
          else if (e.hasLocal && !e.needsUpgrade) void this.openToolWindow(shell, e.id);
        });

        const dlBtn = card.querySelector('.tools-card-dl');
        if (dlBtn) {
          dlBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.installEntry(shell, e);
          });
        }
        const openBtn = card.querySelector('.tools-card-open');
        if (openBtn) {
          openBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.openToolWindow(shell, e.id);
          });
        }

        if (e.hasLocal) {
          const uninstallBtn = document.createElement('button');
          uninstallBtn.type = 'button';
          uninstallBtn.className = 'tools-card-uninstall';
          uninstallBtn.title = '卸载';
          uninstallBtn.setAttribute('aria-label', '卸载 ' + e.name);
          uninstallBtn.textContent = '×';
          uninstallBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.uninstallTool(shell, e.id, e.name);
          });
          wrap.appendChild(card);
          wrap.appendChild(uninstallBtn);
        } else {
          wrap.appendChild(card);
        }

        grid.appendChild(wrap);
      }
    },

    async installEntry(shell, entry) {
      if (!entry || this._busyIds.has(entry.id)) return false;
      this._busyIds.add(entry.id);
      this.renderGrid();
      let ok = false;
      try {
        if (entry.builtin) {
          const r = await shell.api('POST', '/v1/shell-tools/install-example', null, {
            timeoutMs: INSTALL_TIMEOUT_MS,
          });
          if (!r.ok) {
            window.alert('安装失败：' + formatShellToolError(r.json && r.json.error, r.json && r.json.message));
            return false;
          }
          ok = true;
        } else if (entry.cloud) {
          ok = await this.installBundle(shell, entry.cloud, entry.needsUpgrade ? 'upgrade' : 'install', entry.local);
        }
        if (ok) {
          await this.reloadAll(shell);
          await this.openToolWindow(shell, entry.id);
        }
        return ok;
      } finally {
        this._busyIds.delete(entry.id);
        this.renderGrid();
      }
    },

    async uninstallTool(shell, toolId, toolName) {
      const ok = window.confirm('确定卸载「' + (toolName || toolId) + '」？');
      if (!ok) return false;
      const r = await shell.api('DELETE', '/v1/shell-tools/' + encodeURIComponent(toolId), null);
      if (!r.ok) {
        window.alert('卸载失败：' + formatShellToolError(r.json && r.json.error, r.json && r.json.message));
        return false;
      }
      if (typeof shell.closeToolWindow === 'function') {
        try {
          await shell.closeToolWindow(toolId);
        } catch {
          /* ignore */
        }
      }
      await this.reloadAll(shell);
      return true;
    },

    async openToolWindow(shell, toolId) {
      if (typeof shell.openToolWindow !== 'function') {
        window.alert('当前壳版本不支持独立工具窗口');
        return;
      }
      const r = await shell.openToolWindow(toolId);
      if (!r || !r.ok) window.alert('无法打开工具窗口：' + (r && r.error ? r.error : '未知错误'));
    },

    async installBundle(shell, bundle, kind, installed) {
      if (!bundle.publicInstallUrl && !bundle.builtin) {
        window.alert(
          (bundle.label || bundle.fileName || '小工具包') +
            ' 无 publicInstallUrl，请配置 COMPANION_DIST_PUBLIC_HTTP_BASE 或在主站设置中安装。',
        );
        return false;
      }
      if (!bundle.publicInstallUrl) return false;
      this.setStatusHint((kind === 'upgrade' ? '正在更新 ' : '正在下载 ') + (bundle.semver || '') + '…');
      const ir = await shell.api(
        'POST',
        '/v1/shell-tools/install-from-url',
        {
          url: bundle.publicInstallUrl,
          semver: bundle.semver,
          sha256: bundle.sha256,
          bytes: bundle.bytes,
          label: bundle.label || bundle.fileName,
        },
        { timeoutMs: INSTALL_TIMEOUT_MS },
      );
      this.composeStatusHints();
      if (!ir.ok) {
        const err = ir.json && ir.json.error ? ir.json.error : '';
        window.alert(
          formatShellToolError(err, ir.json && (ir.json.message || ir.json.error)) +
            (kind === 'upgrade' ? '\n旧版本应仍可使用。' : ''),
        );
        return false;
      }
      return true;
    },

    bind(shell) {
      this._shell = shell;
      $('btnToolsRefresh')?.addEventListener('click', () => void this.reloadAll(shell));
      $('toolsSearchInput')?.addEventListener('input', (ev) => {
        this.searchQuery = ev.target && ev.target.value != null ? String(ev.target.value) : '';
        this.renderGrid();
      });
      document.querySelectorAll('[data-filter-source]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const v = btn.getAttribute('data-filter-source') || 'all';
          this.filterSource = v === 'local' || v === 'cloud' ? v : 'all';
          document.querySelectorAll('[data-filter-source]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-filter-source') === this.filterSource);
          });
          this.renderGrid();
        });
      });
    },

    async onViewShown(shell) {
      this._shell = shell;
      await this.reloadAll(shell);
    },
  };
})();
