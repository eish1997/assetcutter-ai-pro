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

  function groupCatalogBundles(catalog) {
    const bundles = (catalog || []).filter((a) => a && a.kind === 'shell_tool_bundle' && a.sha256);
    const byKey = new Map();
    for (const b of bundles) {
      const key = catalogToolKey(b);
      if (!key) continue;
      const list = byKey.get(key) || [];
      list.push(b);
      byKey.set(key, list);
    }
    for (const list of byKey.values()) {
      list.sort((a, b) => {
        if (semverGreater(a.semver, b.semver)) return -1;
        if (semverGreater(b.semver, a.semver)) return 1;
        return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
      });
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

  function buildUnifiedEntries(installed, catalogByKey, catalogVersionsByKey, exampleMeta) {
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
        cloudVersions: [],
        builtin: false,
        origin: t.origin || null,
        reviewStatus: t.reviewStatus || null,
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
        cloudVersions: [],
        builtin: false,
        semverLocal: null,
        semverCloud: null,
      };
      cur.cloud = bundle;
      cur.cloudVersions = catalogVersionsByKey.get(id) || [bundle];
      cur.semverCloud = bundle.semver;
      if (!cur.local) {
        cur.name = bundle.label || cur.name || id;
        if (meta.description) cur.description = meta.description;
      }
      cur.tags = mergeTags(cur.tags, meta.tags);
      map.set(id, cur);
    }

    const exampleList =
      exampleMeta && Array.isArray(exampleMeta.examples) && exampleMeta.examples.length
        ? exampleMeta.examples
        : exampleMeta && exampleMeta.available
          ? [
              {
                toolId: exampleMeta.toolId || EXAMPLE_TOOL_ID,
                name: exampleMeta.name,
                description: exampleMeta.description,
                semver: exampleMeta.semver,
                tags: exampleMeta.tags,
              },
            ]
          : [];
    for (const ex of exampleList) {
      if (!ex || !ex.toolId || map.has(ex.toolId)) continue;
      map.set(ex.toolId, {
        id: ex.toolId,
        name: ex.name || ex.toolId,
        description: ex.description || '内置示例包',
        tags: mergeTags(ex.tags, ['示例']),
        local: null,
        cloud: null,
        cloudVersions: [],
        builtin: true,
        semverLocal: null,
        semverCloud: ex.semver || '1.0.0',
      });
    }

    return Array.from(map.values()).map((e) => {
      const hasLocal = Boolean(e.local);
      const hasCloud = Boolean(e.cloud) || Boolean(e.builtin);
      const needsUpgrade = hasLocal && hasCloud && semverGreater(e.semverCloud, e.semverLocal);
      const canDownload = (!hasLocal && hasCloud) || needsUpgrade;
      const hasCloudVersionMismatch = hasLocal && hasCloud && String(e.semverLocal || '') !== String(e.semverCloud || '');
      return {
        ...e,
        hasLocal,
        hasCloud,
        needsUpgrade,
        canDownload,
        hasCloudVersionMismatch,
        displaySemver: e.semverLocal || e.semverCloud || '—',
        origin: e.origin || (e.local && e.local.origin) || null,
        reviewStatus: e.reviewStatus || (e.local && e.local.reviewStatus) || null,
      };
    });
  }

  function mergeCapabilityToolCloudEntries(entries, cloud) {
    const out = Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [];
    const byId = new Map(out.map((entry) => [entry.id, entry]));
    const packages = Array.isArray(cloud && cloud.packages) ? cloud.packages : [];
    const versions = Array.isArray(cloud && cloud.versions) ? cloud.versions : [];
    const versionsByPackage = new Map();
    for (const version of versions) {
      if (!version || version.type !== 'tool' || !version.packageId) continue;
      const id = String(version.packageId);
      if (!versionsByPackage.has(id)) versionsByPackage.set(id, []);
      versionsByPackage.get(id).push({ ...version, capabilityPackageId: id, capabilityVersion: true });
    }
    for (const pkg of packages) {
      if (!pkg || pkg.type !== 'tool') continue;
      const manifest = pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      const toolId = String(manifest.authoredToolId || manifest.toolId || pkg.id || '').trim();
      if (!toolId) continue;
      const capabilityVersions = versionsByPackage.get(pkg.id) || [];
      const entry =
        byId.get(toolId) ||
        {
          id: toolId,
          name: pkg.name || toolId,
          description: pkg.description || '',
          tags: Array.isArray(pkg.tags) ? [...pkg.tags] : [],
          local: null,
          cloud: null,
          cloudVersions: [],
          builtin: false,
          origin: 'capability_cloud',
          reviewStatus: null,
          semverLocal: null,
          semverCloud: null,
          hasLocal: false,
          hasCloud: false,
          needsUpgrade: false,
          canDownload: false,
          hasCloudVersionMismatch: false,
          displaySemver: pkg.version || '—',
        };
      entry.hasCapabilityCloud = true;
      entry.capabilityPackageId = pkg.id;
      entry.capabilityCloudPackage = pkg;
      const hostId = String(manifest.hostId || manifest.softwareId || '').trim();
      if (hostId) {
        const hostTag = 'host:' + hostId;
        entry.tags = Array.isArray(entry.tags) ? entry.tags.slice() : [];
        if (!entry.tags.includes(hostTag)) entry.tags.push(hostTag);
      }
      const dependsOn = Array.isArray(manifest.dependsOn) ? manifest.dependsOn.map(String).filter(Boolean) : [];
      if (dependsOn.length) {
        const hint = '依赖：' + dependsOn.join('、');
        if (!String(entry.description || '').includes(hint)) {
          entry.description = String(entry.description || '').trim();
          entry.description = entry.description ? entry.description + ' · ' + hint : hint;
        }
      }
      entry.hasCloud = true;
      entry.semverCloud = pkg.version || entry.semverCloud;
      entry.displaySemver = entry.semverLocal || entry.semverCloud || entry.displaySemver || '—';
      entry.cloudVersions = capabilityVersions.length
        ? capabilityVersions.concat((entry.cloudVersions || []).filter((item) => !item.capabilityVersion))
        : entry.cloudVersions || [];
      entry.hasCloudVersionMismatch =
        Boolean(entry.hasLocal && entry.semverCloud && String(entry.semverLocal || '') !== String(entry.semverCloud || '')) ||
        Boolean(entry.hasCloudVersionMismatch);
      entry.canDownload = Boolean(entry.canDownload && !entry.hasCapabilityCloud);
      if (!byId.has(toolId)) {
        byId.set(toolId, entry);
        out.push(entry);
      }
    }
    return out;
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
    isAdmin: false,
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
          hasCapabilityCloud: e.hasCapabilityCloud,
          capabilityPackageId: e.capabilityPackageId,
          canDownload: e.canDownload,
          cloudVersions: (e.cloudVersions || []).map((v) => [v.id, v.semver, v.publishedAt]),
          isAdmin: this.isAdmin,
          tags: e.tags,
        })),
      );
    },

    async refreshAdminState(shell) {
      if (typeof shell.accountStatus !== 'function') {
        this.isAdmin = false;
        return;
      }
      try {
        const status = await shell.accountStatus();
        const user = status && status.user && typeof status.user === 'object' ? status.user : {};
        this.isAdmin = Boolean(status && status.loggedIn && String(user.role || '') === 'admin');
      } catch {
        this.isAdmin = false;
      }
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
        if (r && !r.ok && r.error) {
          // Catalog is optional for builtin/local tools; keep message readable.
          return { __catalogError: formatShellToolError(r.error, r.error) };
        }
      }
      return [];
    },

    async fetchExampleMeta(shell) {
      if (typeof shell.builtinExampleAvailable === 'function') {
        try {
          const shellR = await shell.builtinExampleAvailable();
          if (shellR && shellR.ok && shellR.available) {
            const examples = Array.isArray(shellR.examples) ? shellR.examples : [];
            return {
              available: true,
              toolId: shellR.toolId || EXAMPLE_TOOL_ID,
              name: shellR.name,
              description: shellR.description,
              semver: shellR.semver,
              tags: Array.isArray(shellR.tags) ? shellR.tags : [],
              examples:
                examples.length > 0
                  ? examples
                  : [
                      {
                        toolId: shellR.toolId || EXAMPLE_TOOL_ID,
                        name: shellR.name,
                        description: shellR.description,
                        semver: shellR.semver,
                        tags: Array.isArray(shellR.tags) ? shellR.tags : [],
                      },
                    ],
            };
          }
        } catch {
          /* fall through */
        }
      }
      const r = await shell.api('GET', '/v1/shell-tools/example-available', null);
      if (!r.ok || !r.json || !r.json.available) return { available: false, examples: [] };
      return {
        available: true,
        toolId: r.json.toolId || EXAMPLE_TOOL_ID,
        name: r.json.name,
        description: r.json.description,
        semver: r.json.semver,
        tags: Array.isArray(r.json.tags) ? r.json.tags : [],
        examples: Array.isArray(r.json.examples) ? r.json.examples : [],
      };
    },

    async fetchCapabilityToolCloud(shell) {
      if (!shell || typeof shell.api !== 'function') return { packages: [], versions: [] };
      try {
        const r = await shell.api('GET', '/v1/capability-packages/cloud', null);
        if (r && r.ok && r.json) return r.json;
      } catch {
        /* capability cloud is optional while legacy catalog migration continues */
      }
      return { packages: [], versions: [] };
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

        const capabilityCloud = await this.fetchCapabilityToolCloud(shell);
        if (gen !== this._reloadGen) return;

        await this.refreshAdminState(shell);
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
        const catalogVersionsByKey = groupCatalogBundles(catalogList);
        const nextEntries = mergeCapabilityToolCloudEntries(
          buildUnifiedEntries(installed, catalogByKey, catalogVersionsByKey, exampleMeta),
          capabilityCloud,
        );
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
        if (this.filterSource === 'mine' && !(e.origin === 'authored' || e.origin === 'import')) return false;
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
      const hostTags = tags.filter((tag) => String(tag).startsWith('host:'));
      const otherTags = tags.filter((tag) => !String(tag).startsWith('host:'));
      host.innerHTML = '';
      const renderChip = (tag) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tools-filter-chip' + (this.filterTag === tag ? ' active' : '');
        btn.textContent = String(tag).startsWith('host:') ? String(tag).slice(5) : tag;
        btn.setAttribute('data-filter-tag', tag);
        btn.addEventListener('click', () => {
          this.filterTag = this.filterTag === tag ? '' : tag;
          this.renderTagFilters();
          this.renderGrid();
        });
        host.appendChild(btn);
      };
      for (const tag of hostTags) renderChip(tag);
      if (hostTags.length && otherTags.length) {
        const sep = document.createElement('span');
        sep.className = 'tools-filter-sep';
        sep.setAttribute('aria-hidden', 'true');
        host.appendChild(sep);
      }
      for (const tag of otherTags) renderChip(tag);
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
            textContent: this.mergedEntries.length ? '无匹配工具' : '暂无工具。可以找管家看货架并按需要安装。',
          }),
        );
        if (!this.mergedEntries.length) {
          const ask = document.createElement('button');
          ask.type = 'button';
          ask.className = 'connections-primary-btn';
          ask.id = 'btnToolsAskButlerEmpty';
          ask.textContent = '找管家';
          ask.addEventListener('click', () => void this.openToolsWithButler());
          grid.appendChild(ask);
        }
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

        const cloudVersions = Array.isArray(e.cloudVersions) ? e.cloudVersions : [];
        const isMine = e.origin === 'authored' || e.origin === 'import';
        const schema = window.ShellCapabilityCardSchema;
        const packageLike = { ...e, type: 'tool', cloudVersions };
        const view =
          schema && typeof schema.view === 'function'
            ? schema.view(packageLike, { isAdmin: this.isAdmin })
            : {
                title: e.name,
                subtitle: subParts.join(' · '),
                description: e.description,
                tags: e.tags || [],
                actions: ['open', 'export'].concat(cloudVersions.length > 0 ? ['version'] : []).concat(isMine ? ['publish'] : []),
              };
        subParts.length = 0;
        if (view.subtitle) subParts.push(view.subtitle);
        const tagsHtml = (Array.isArray(view.tags) ? view.tags : [])
          .map((t) => '<span class="tools-card-tag">' + esc(t) + '</span>')
          .join('');
        const cardActions = Array.isArray(view.actions)
          ? view.actions
          : ['open', 'export'].concat(cloudVersions.length > 0 ? ['version'] : []).concat(isMine ? ['publish'] : []);
        const hasCardAction = (name) => cardActions.includes(name);
        const canPublishCloud = hasCardAction('publish');
        const hasCloudVersions = hasCardAction('version');
        const canSubmitReview = isMine && !canPublishCloud;

        const originBadge =
          e.origin === 'authored' || e.origin === 'import'
            ? '<span class="tools-card-badge" style="background:rgba(59,130,246,0.2);color:#93c5fd">我的</span>'
            : e.reviewStatus === 'pending'
              ? '<span class="tools-card-badge" style="background:rgba(250,204,21,0.2);color:#fde68a">审批中</span>'
              : '';

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
          originBadge +
          '<span class="tools-card-badge' +
          (e.canDownload ? '' : ' hidden') +
          '">' +
          (e.needsUpgrade ? '可更新' : '可下载') +
          '</span>' +
          '</div>' +
          '<div class="tools-card-title">' +
          esc(view.title) +
          '</div>' +
          '<div class="tools-card-sub">' +
          esc(subParts.join(' · ')) +
          '</div>' +
          '<div class="tools-card-desc">' +
          esc(view.description) +
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
          '<button type="button" class="tools-card-action tools-card-export' +
          (e.origin === 'authored' || e.origin === 'import' ? '' : ' hidden') +
          '">导出</button>' +
          '<button type="button" class="tools-card-action tools-card-version' +
          (hasCloudVersions ? '' : ' hidden') +
          '">\u7248\u672c</button>' +
          '<button type="button" class="tools-card-action tools-card-publish' +
          (canPublishCloud ? '' : ' hidden') +
          '">\u63d0\u4ea4\u4e91\u7aef</button>' +
          '<button type="button" class="tools-card-action tools-card-submit' +
          (canSubmitReview ? '' : ' hidden') +
          '">提交审批</button>' +
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
        const exportBtn = card.querySelector('.tools-card-export');
        if (exportBtn) {
          exportBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.exportAuthored(shell, e.id);
          });
        }
        const submitBtn = card.querySelector('.tools-card-submit');
        if (submitBtn) {
          submitBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.submitAuthored(shell, e.id, e.name);
          });
        }
        const versionBtn = card.querySelector('.tools-card-version');
        if (versionBtn) {
          versionBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.chooseCloudVersion(shell, e);
          });
        }
        const publishBtn = card.querySelector('.tools-card-publish');
        if (publishBtn) {
          publishBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.publishToCloud(shell, e, e.name);
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

    defaultExportFileName(toolId) {
      const entry = (this.mergedEntries || []).find((e) => e && e.id === toolId) || {};
      const semver = String(entry.semverLocal || entry.semver || entry.version || '0.1.0').trim() || '0.1.0';
      return String(toolId || 'tool').replace(/[^a-zA-Z0-9_.-]/g, '-') + '-' + semver + '.zip';
    },

    fallbackToolCapabilityContext(toolId) {
      const entry = (this.mergedEntries || []).find((e) => e && e.id === toolId) || {};
      const capabilityId = entry.capabilityPackageId || toolId;
      const lines = [
        '\u5f53\u524d\u5bf9\u8bdd\u7ed1\u5b9a\u5230\u4e00\u4e2a\u5de5\u5177\u80fd\u529b\u5305\u5bf9\u8c61\u3002',
        'CapabilityPackage ID: ' + capabilityId,
        '\u5de5\u5177 ID: ' + toolId,
        '\u5de5\u5177\u540d\u79f0: ' + (entry.name || toolId),
        '\u672c\u5730\u7248\u672c: ' + (entry.semverLocal || entry.displaySemver || ''),
        '\u4e91\u7aef\u7248\u672c: ' + (entry.semverCloud || ''),
        '\u6765\u6e90: ' + (entry.origin || ''),
        '\u5ba1\u6279\u72b6\u6001: ' + (entry.reviewStatus || ''),
        '\u672c\u5730\u5df2\u5b89\u88c5: ' + (entry.hasLocal ? 'yes' : 'no'),
        '\u4e91\u7aef\u53ef\u7528: ' + (entry.hasCloud ? 'yes' : 'no'),
        '\u9700\u8981\u66f4\u65b0: ' + (entry.needsUpgrade ? 'yes' : 'no'),
        '\u5982\u679c\u7528\u6237\u8981\u4fee\u590d\u3001\u8c03\u6574\u6216\u7ee7\u7eed\u4f18\u5316\u8fd9\u4e2a\u5de5\u5177\uff0c\u8bf7\u56f4\u7ed5\u8fd9\u4e2a CapabilityPackage \u7ee7\u7eed\u4fee\u6539\u3001\u8fd0\u884c\u3001\u8bb0\u5f55\u4e8b\u4ef6\u548c\u590d\u6d4b\u3002',
        '\u4f18\u5148\u4f7f\u7528 ac.capability.lifecycle_run \u548c ac.capability.event_append\uff1b\u9700\u8981\u6539\u672c\u673a\u5de5\u5177\u8349\u7a3f\u65f6\u518d\u4f7f\u7528 ac.shell_tool.authored_upsert\u3002',
      ];
      const versions = Array.isArray(entry.cloudVersions) ? entry.cloudVersions : [];
      if (versions.length) {
        lines.push(
          '\u4e91\u7aef\u5386\u53f2\u7248\u672c: ' +
            versions
              .slice(0, 8)
              .map((v) => String(v.semver || v.id || '').trim())
              .filter(Boolean)
              .join(', '),
        );
      }
      return lines.filter((x) => String(x || '').trim()).join('\n');
    },

    async fetchToolCapabilityContext(shell, entry, toolId) {
      if (!shell || typeof shell.api !== 'function') return null;
      const capabilityId = String((entry && entry.capabilityPackageId) || toolId || '').trim();
      if (!capabilityId) return null;
      const r = await shell.api('GET', '/v1/capability-packages/' + encodeURIComponent(capabilityId) + '/context', null);
      if (!r || !r.ok || !r.json || !r.json.ok) return null;
      return r.json;
    },

    async exportAuthored(shell, toolId) {
      let destZipPath = '';
      if (typeof shell.savePath === 'function') {
        const picked = await shell.savePath({
          title: 'Export Tool ZIP',
          defaultPath: this.defaultExportFileName(toolId),
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (!picked || picked.canceled) return;
        if (!picked.ok || !picked.path) {
          window.alert('No export location selected');
          return;
        }
        destZipPath = String(picked.path || '').trim();
        if (destZipPath && !/\.zip$/i.test(destZipPath)) destZipPath += '.zip';
      }

      const r = await shell.api(
        'POST',
        '/v1/shell-tools/authored/' + encodeURIComponent(toolId) + '/pack',
        destZipPath ? { destZipPath } : {},
      );
      if (!r.ok) {
        window.alert('Export failed: ' + formatShellToolError(r.json && r.json.error, r.json && r.json.message));
        return;
      }
      const zipPath = r.json && r.json.zipPath;
      window.alert('Exported:\n' + (zipPath || ''));
      if (zipPath && typeof shell.openFolderPath === 'function') {
        try {
          await shell.openFolderPath(zipPath);
        } catch {
          /* ignore */
        }
      }
    },

    async submitAuthored(shell, toolId, toolName) {
      if (!window.confirm('将「' + (toolName || toolId) + '」提交管理员审批？通过后全员可下载。')) return;
      if (typeof shell.submitShellToolForReview !== 'function') {
        window.alert('当前壳版本尚不支持提交审批，请更新本地伴侣。');
        return;
      }
      const r = await shell.submitShellToolForReview(toolId);
      if (!r || !r.ok) {
        window.alert('提交失败：' + (r && (r.error || r.message) ? r.error || r.message : '未知错误'));
        return;
      }
      window.alert('已提交审批' + (r.submissionId ? '：' + r.submissionId : ''));
      await this.reloadAll(shell);
    },

    async publishToCloud(shell, entryOrId, toolName) {
      const entry = entryOrId && typeof entryOrId === 'object' ? entryOrId : { id: entryOrId, name: toolName };
      const toolId = String(entry && entry.id ? entry.id : '').trim();
      const ok = window.confirm(
        '\u5c06\u300c' +
          (toolName || toolId) +
          '\u300d\u5f53\u524d\u672c\u5730\u7248\u672c\u63d0\u4ea4\u5230\u4e91\u7aef\uff1f\n\u4e91\u7aef\u4f1a\u4fdd\u7559\u5386\u53f2\u7248\u672c\u3002',
      );
      if (!ok) return;
      const versionNote = window.prompt('填写本次云端版本说明', '');
      if (versionNote == null) return;
      if (!String(versionNote).trim()) {
        window.alert('版本说明不能为空。');
        return;
      }
      const semver = window.prompt('填写版本号', entry.semverLocal || entry.displaySemver || '1.0.0');
      if (semver == null) return;
      this._busyIds.add(toolId);
      this.renderGrid();
      try {
        let r = null;
        if (shell && typeof shell.api === 'function') {
          r = await shell.api(
            'POST',
            '/v1/capability-packages/' + encodeURIComponent(entry.capabilityPackageId || toolId) + '/cloud-versions',
            {
              semver: String(semver || '').trim(),
              versionNote: String(versionNote || '').trim(),
              isAdmin: true,
              actorRole: 'admin',
            },
            { timeoutMs: 60000 },
          );
          if (r && r.ok) {
            const version = r.json && r.json.version;
            window.alert('已提交到云端：v' + (version && version.semver ? version.semver : ''));
            await this.reloadAll(shell);
            return;
          }
          const capabilityErr = String((r && r.json && (r.json.error || r.json.code)) || '');
          if (capabilityErr && capabilityErr !== 'capability_not_found') {
            window.alert('提交云端失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
            return;
          }
        }
        if (typeof shell.publishShellToolToCloud !== 'function') {
          window.alert('\u5f53\u524d\u7248\u672c\u4e0d\u652f\u6301\u76f4\u63a5\u63d0\u4ea4\u4e91\u7aef');
          return;
        }
        r = await shell.publishShellToolToCloud(toolId);
        if (!r || !r.ok) {
          const err = String((r && r.error) || '');
          const msg = String((r && r.message) || '');
          if (err === 'not_logged_in' || msg === '\u672a\u767b\u5f55') {
            if (typeof shell.setShellView === 'function') {
              try {
                await shell.setShellView('workbench');
              } catch {
                /* ignore */
              }
            }
            window.alert('\u8bf7\u5148\u5728\u5de5\u4f5c\u53f0\u767b\u5f55\u7ba1\u7406\u5458\u8d26\u53f7\uff0c\u7136\u540e\u56de\u5230\u5de5\u5177\u9875\u518d\u70b9\u63d0\u4ea4\u4e91\u7aef\u3002');
            return;
          }
          if (err === 'admin_required') {
            window.alert('\u5f53\u524d\u767b\u5f55\u8d26\u53f7\u4e0d\u662f\u7ba1\u7406\u5458\uff0c\u65e0\u6cd5\u63d0\u4ea4\u5230\u4e91\u7aef\u3002');
            return;
          }
          window.alert(
            '\u63d0\u4ea4\u4e91\u7aef\u5931\u8d25\uff1a' +
              (r && (r.message || r.error) ? r.message || r.error : '\u672a\u77e5\u9519\u8bef'),
          );
          return;
        }
        const artifact = r.artifact || {};
        window.alert('\u5df2\u63d0\u4ea4\u5230\u4e91\u7aef\uff1av' + (artifact.semver || ''));
        await this.reloadAll(shell);
      } finally {
        this._busyIds.delete(toolId);
        this.renderGrid();
      }
    },

    showVersionPicker(entry, versions) {
      if (window.ShellCapabilityVersionPicker && typeof window.ShellCapabilityVersionPicker.pick === 'function') {
        return window.ShellCapabilityVersionPicker.pick({ ...entry, type: 'tool' }, versions, {
          title: '选择云端版本 - ' + (entry.name || entry.id || ''),
        });
      }
      window.alert('当前壳版本缺少能力包版本选择器，请重启或更新本地伴侣。');
      return Promise.resolve(null);
    },

    async chooseCloudVersion(shell, entry) {
      const versions = Array.isArray(entry && entry.cloudVersions) ? entry.cloudVersions : [];
      if (!versions.length) {
        window.alert('\u4e91\u7aef\u6682\u65e0\u53ef\u5207\u6362\u7248\u672c');
        return;
      }
      const bundle = await this.showVersionPicker(entry, versions);
      if (!bundle) return;
      this._busyIds.add(entry.id);
      this.renderGrid();
      try {
        if (bundle.capabilityVersion && bundle.capabilityPackageId) {
          const r = await shell.api(
            'POST',
            '/v1/capability-packages/' +
              encodeURIComponent(bundle.capabilityPackageId) +
              '/cloud-versions/' +
              encodeURIComponent(bundle.id) +
              '/activate',
            { isAdmin: true, actorRole: 'admin' },
            { timeoutMs: 30000 },
          );
          if (!r || !r.ok) {
            const body = (r && r.json) || {};
            window.alert('切换失败：' + (body.message || body.error || (r && r.text) || '未知错误'));
            return;
          }
          window.alert('已切换到云端版本 v' + (bundle.semver || ''));
          await this.reloadAll(shell);
          return;
        }
        const ok = await this.installBundle(shell, bundle, 'switch', entry.local);
        if (ok) {
          await this.reloadAll(shell);
          await this.openToolWindow(shell, entry.id);
        }
      } finally {
        this._busyIds.delete(entry.id);
        this.renderGrid();
      }
    },

    async importZip(shell) {
      if (typeof shell.pickPath !== 'function') {
        window.alert('无法选择文件');
        return;
      }
      const picked = await shell.pickPath({ pick: 'file', title: '选择小工具 ZIP' });
      const zipPath = picked && picked.ok && picked.path ? picked.path : '';
      if (!zipPath || picked.canceled) return;
      const r = await shell.api('POST', '/v1/shell-tools/authored/import', { zipPath }, { timeoutMs: INSTALL_TIMEOUT_MS });
      if (!r.ok) {
        window.alert('导入失败：' + formatShellToolError(r.json && r.json.error, r.json && r.json.message));
        return;
      }
      await this.reloadAll(shell);
      if (r.json && r.json.toolId) await this.openToolWindow(shell, r.json.toolId);
    },

    async scaffoldMine(shell) {
      const idRaw = window.prompt('工具 ID（小写字母开头，仅 a-z 0-9 -）', 'my-tool');
      if (!idRaw) return;
      const id = String(idRaw).trim().toLowerCase();
      const name = window.prompt('显示名称', id) || id;
      const r = await shell.api(
        'POST',
        '/v1/shell-tools/authored/scaffold',
        { id, name, description: '用户自建小工具', install: true },
        { timeoutMs: INSTALL_TIMEOUT_MS },
      );
      if (!r.ok) {
        window.alert('创建失败：' + formatShellToolError(r.json && r.json.error, r.json && r.json.message));
        return;
      }
      await this.reloadAll(shell);
      if (r.json && r.json.toolId) await this.openToolWindow(shell, r.json.toolId);
    },

    async installEntry(shell, entry) {
      if (!entry || this._busyIds.has(entry.id)) return false;
      this._busyIds.add(entry.id);
      this.renderGrid();
      let ok = false;
      try {
        if (entry.builtin) {
          const r = await shell.api(
            'POST',
            '/v1/shell-tools/install-example',
            { exampleId: entry.id },
            {
              timeoutMs: INSTALL_TIMEOUT_MS,
            },
          );
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
      let installUrl = bundle.publicInstallUrl || '';
      if (!installUrl && !bundle.builtin) {
        if (!bundle.id || typeof shell.resolveCompanionArtifactDownload !== 'function') {
          window.alert((bundle.label || bundle.fileName || '小工具包') + ' 暂时无法获取下载地址，请更新本地伴侣后重试。');
          return false;
        }
        this.setStatusHint('正在准备下载地址…');
        const resolved = await shell.resolveCompanionArtifactDownload(bundle.id);
        if (!resolved || !resolved.ok || !resolved.downloadUrl) {
          this.composeStatusHints();
          const err = resolved && (resolved.message || resolved.error) ? resolved.message || resolved.error : '未知错误';
          if (resolved && resolved.error === 'not_logged_in') {
            window.alert('请先在工作台登录后再下载云端工具。');
          } else {
            window.alert('获取下载地址失败：' + err);
          }
          return false;
        }
        installUrl = resolved.downloadUrl;
      }
      if (!installUrl) return false;
      this.setStatusHint((kind === 'upgrade' ? '正在更新 ' : '正在下载 ') + (bundle.semver || '') + '…');
      const ir = await shell.api(
        'POST',
        '/v1/shell-tools/install-from-url',
        {
          url: installUrl,
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

    openToolsWithButler() {
      const shell = this._shell;
      if (!shell || typeof shell.openDshHandoff !== 'function') {
        this.setStatusHint('当前壳版本还不支持管家办事入口。');
        return Promise.resolve({ ok: false });
      }
      return shell.openDshHandoff({
        domain: 'tools',
        surface: 'tools',
        label: '工具架',
        composerText: '请看货架并按需要安装。',
      });
    },

    bind(shell) {
      this._shell = shell;
      $('btnToolsRefresh')?.addEventListener('click', () => void this.reloadAll(shell));
      $('btnToolsImportZip')?.addEventListener('click', () => void this.importZip(shell));
      $('btnToolsScaffold')?.addEventListener('click', () => void this.scaffoldMine(shell));
      $('btnToolsAskButler')?.addEventListener('click', () => void this.openToolsWithButler());
      window.addEventListener('assetcutter:capability-created', (ev) => {
        const detail = ev && ev.detail && typeof ev.detail === 'object' ? ev.detail : {};
        if (detail.type !== 'tool') return;
        void this.reloadAll(this._shell || shell);
      });
      $('toolsSearchInput')?.addEventListener('input', (ev) => {
        this.searchQuery = ev.target && ev.target.value != null ? String(ev.target.value) : '';
        this.renderGrid();
      });
      document.querySelectorAll('#tools-rack [data-filter-source]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const v = btn.getAttribute('data-filter-source') || 'all';
          this.filterSource = v === 'local' || v === 'cloud' || v === 'mine' ? v : 'all';
          document.querySelectorAll('#tools-rack [data-filter-source]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-filter-source') === this.filterSource);
          });
          this.renderGrid();
        });
      });
    },

    async onViewShown(shell) {
      this._shell = shell;
      // Prefetch rack list in background so switching tabs is snappy.
      void this.reloadAll(shell);
    },
  };
})();
