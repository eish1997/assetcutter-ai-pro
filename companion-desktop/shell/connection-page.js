/**
 * Connection page: capability-package first local connections.
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

  function normalizeCapabilityId(value) {
    return String(value || 'software-connection')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'software-connection';
  }

  function normalizeLocalVersionId(value) {
    return String(value || 'local-version')
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/')
      .replace(/[^a-z0-9._/-]+/g, '-')
      .replace(/[/\\]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'local-version';
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function compactText(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || fallback || '';
  }

  var PATH_LABEL_NOISE = { bin: 1, win64: 1, win32: 1, x64: 1, engine: 1, binaries: 1, binary: 1 };

  function displayVersionLabel(item) {
    if (!item || typeof item !== 'object') return '未识别版本';
    const softwareVersion = compactText(item.softwareVersion, '');
    if (softwareVersion) return softwareVersion;
    const paths = [item.executablePath, item.installRoot, item.shortcutPath, item.targetLabel]
      .map(function (p) {
        return compactText(p, '').replace(/\//g, '\\');
      })
      .filter(Boolean);
    for (var pi = 0; pi < paths.length; pi += 1) {
      var rawPath = paths[pi];
      var maya = rawPath.match(/Maya(\d{4})/i);
      if (maya && maya[1]) return maya[1];
      var ue = rawPath.match(/UE[_\s-]?(\d+(?:\.\d+)?)/i);
      if (ue && ue[1]) return ue[1];
      var segments = rawPath.split(/[/\\]/).filter(Boolean);
      for (var si = 0; si < segments.length; si += 1) {
        var segment = segments[si];
        var lower = segment.toLowerCase();
        if (PATH_LABEL_NOISE[lower]) continue;
        var plainVersion = segment.match(/^v?(\d+(?:\.\d+){0,2})$/i);
        if (plainVersion && plainVersion[1]) return plainVersion[1];
        var productYear = segment.match(/^[A-Za-z]+(\d{4})$/);
        if (productYear && productYear[1]) return productYear[1];
      }
    }
    var label = compactText(item.label, '');
    if (label) {
      var labelLower = label.toLowerCase();
      if (!PATH_LABEL_NOISE[labelLower]) {
        var parts = label.split(/\s+/);
        var tail = parts[parts.length - 1] || '';
        if (/^\d/.test(tail)) return tail;
        if (label.length <= 16) return label;
      }
    }
    var executablePath = compactText(item.executablePath || item.targetLabel, '').replace(/\//g, '\\');
    if (executablePath) {
      var base = executablePath.split('\\').pop() || '';
      base = base.replace(/\.exe$/i, '');
      if (base && !PATH_LABEL_NOISE[base.toLowerCase()]) return base;
    }
    return '未识别版本';
  }

  function cardInitial(value) {
    const text = compactText(value, '连');
    return text.slice(0, 1).toUpperCase();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value || ''));
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function recordOk(record) {
    return Boolean(record && typeof record === 'object' && record.ok === true);
  }

  function recordFailed(record) {
    return Boolean(record && typeof record === 'object' && record.ok === false);
  }

  function actionLabel(action) {
    const labels = {
      agent_loop: '管家',
      conversation: '对话',
      discover_running: '识别运行',
      launch: '启动',
      close: '关闭',
      install: '安装桥接',
      probe: '探测',
      uninstall: '卸载',
      export: '导出',
      publish: '发布',
      version: '版本',
      local_versions: '切换本机版本',
      set_local_version: '设为当前版本',
      delete: '删除草稿',
    };
    return labels[String(action || '')] || String(action || '');
  }

  function actionIcon(action) {
    const icons = {
      agent_loop: '<path d="M12 3l7 4v5c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V7l7-4z"/><path d="M12 8v8"/><path d="M8 12h8"/>',
      conversation: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
      discover_running: '<circle cx="12" cy="12" r="7"/><path d="M12 9v3l2 2"/><path d="M4 12h2"/><path d="M18 12h2"/>',
      launch: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
      close: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>',
      install: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
      probe: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/>',
      uninstall: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 6l1 14h12l1-14"/>',
      export: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
      publish: '<path d="M16 16l-4-4-4 4"/><path d="M12 12v9"/><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A7 7 0 1 0 5 14.6"/>',
      version: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>',
      local_versions: '<path d="M4 7h16"/><path d="M4 12h12"/><path d="M4 17h8"/><path d="M17 16l2 2 3-4"/>',
      set_local_version: '<path d="M20 6L9 17l-5-5"/>',
      delete: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 6l1 14h12l1-14"/>',
    };
    return (
      '<svg class="connection-card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (icons[String(action || '')] || '<circle cx="12" cy="12" r="7"/>') +
      '</svg>'
    );
  }

  function versionRouteViewForItem(item, isCurrent) {
    const status = compactText(item && item.status, 'detected');
    let routeTone = 'pending';
    let routeLabel = '未开通';
    if (status === 'verified') {
      routeTone = 'open';
      routeLabel = '已开通';
    } else if (status === 'launchable' || status === 'installed') {
      routeLabel = '未验证';
    } else if (status === 'failed') {
      routeTone = 'repair';
      routeLabel = '需修复';
    }
    const targetLabel = compactText(item && (item.executablePath || item.shortcutPath || item.installRoot || item.targetLabel), '未指定位置');
    const label = displayVersionLabel(item || {});
    return {
      id: compactText(item && item.id, ''),
      label: label,
      softwareVersion: compactText(item && item.softwareVersion, ''),
      targetLabel,
      routeTone,
      routeLabel,
      isCurrent: isCurrent === true,
    };
  }

  function versionRowsForCardView(cardView, currentLocalVersion) {
    const currentId = compactText(
      currentLocalVersion && currentLocalVersion.id,
      compactText(cardView && cardView.currentLocalVersion && cardView.currentLocalVersion.id, ''),
    );
    if (cardView && Array.isArray(cardView.versionRows) && cardView.versionRows.length) {
      return cardView.versionRows.map((row) => ({
        ...row,
        label: displayVersionLabel({
          softwareVersion: row && row.softwareVersion,
          label: row && row.label,
          executablePath: row && row.targetLabel,
          targetLabel: row && row.targetLabel,
        }),
        isCurrent: String((row && row.id) || '') === currentId,
      }));
    }
    let localVersions = asArray(cardView && cardView.localVersions);
    if (!localVersions.length && currentLocalVersion && typeof currentLocalVersion === 'object') {
      localVersions = [currentLocalVersion];
    }
    return localVersions.map((item) => versionRouteViewForItem(item, String((item && item.id) || '') === currentId));
  }

  function placeSummaryForCardView(cardView, versionRows) {
    if (cardView && cardView.routeSummary && typeof cardView.routeSummary === 'object') {
      return {
        versionCount: Number(cardView.placeSummary && cardView.placeSummary.versionCount) || (versionRows || []).length,
        openCount: Number(cardView.placeSummary && cardView.placeSummary.openCount) || 0,
        summaryLabel: compactText(cardView.routeSummary.summaryLabel, ''),
      };
    }
    if (cardView && cardView.placeSummary && typeof cardView.placeSummary === 'object') return cardView.placeSummary;
    const rows = versionRows || [];
    const versionCount = rows.length;
    const openCount = rows.filter((row) => row.routeTone === 'open').length;
    return {
      versionCount,
      openCount,
      summaryLabel:
        versionCount > 0
          ? versionCount + ' 个版本' + (openCount > 0 ? ' · ' + openCount + ' 条已开通' : '')
          : '尚无本机版本',
    };
  }

  function versionRowPrimaryAction(row) {
    if (!row || row.routeTone === 'open') return null;
    if (row.routeTone === 'repair') return { action: 'repair_route', label: '让管家修复' };
    const routeLabel = compactText(row.routeLabel, '');
    if (routeLabel === '未验证') return { action: 'open_route', label: '让管家验证' };
    return { action: 'open_route', label: '让管家开通' };
  }

  function internalRouteRowsForCardView(cardView) {
    return asArray(cardView && cardView.internalRouteRows);
  }

  function internalRowPrimaryAction(row) {
    if (!row || row.routeTone === 'open') return null;
    if (row.routeTone === 'repair') return { action: 'repair_internal_route', label: '让管家修复此线' };
    return { action: 'verify_internal_route', label: '让管家验证此线' };
  }

  function formatRelativeProbeAge(iso) {
    const at = Date.parse(String(iso || ''));
    if (!Number.isFinite(at)) return '未知';
    const days = Math.max(0, Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000)));
    if (days <= 0) return '今天';
    return days + ' 天前';
  }

  function legacyLocalVersionsFromManifest(manifest, appName) {
    const existing = asArray(manifest && manifest.localVersions);
    if (existing.length) return existing;
    const m = manifest && typeof manifest === 'object' ? manifest : {};
    const executablePath = compactText(m.executablePath || m.inputPath, '');
    const shortcutPath = compactText(m.shortcutPath, '');
    const softwareVersion = compactText(m.softwareVersion || m.versionHint || m.version, '');
    if (!softwareVersion && !executablePath && !shortcutPath) return [];
    const id = normalizeLocalVersionId(
      compactText(m.currentLocalVersionId || m.defaultLocalVersionId, [softwareVersion, executablePath, shortcutPath].filter(Boolean).join('|')),
    );
    return [
      {
        id,
        label: softwareVersion ? compactText(appName, '本机软件') + ' ' + softwareVersion : compactText(appName, '本机软件'),
        softwareVersion,
        executablePath: executablePath.toLowerCase().endsWith('.exe') ? executablePath : compactText(m.executablePath, ''),
        shortcutPath,
        source: compactText(m.droppedFrom, '') === 'connection_page' ? 'drag_drop' : 'manual',
        status: executablePath || shortcutPath ? 'launchable' : 'detected',
      },
    ];
  }

  function connectionCardViewFor(pkg) {
    if (pkg && pkg.connectionCardView && typeof pkg.connectionCardView === 'object') return pkg.connectionCardView;
    const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
    const connectionState = connectionStateFor(pkg);
    const appName = compactText(manifest.appName || (pkg && pkg.name), '本机软件');
    const localVersions = legacyLocalVersionsFromManifest(manifest, appName);
    const currentId = compactText(manifest.currentLocalVersionId || manifest.defaultLocalVersionId, '');
    const currentLocalVersion =
      localVersions.find((item) => item && typeof item === 'object' && String(item.id || '') === currentId) ||
      localVersions[0] ||
      null;
    const primaryActions = ['agent_loop'];
    if (asArray(connectionState.availableActions).includes('launch')) primaryActions.push('launch');
    if (asArray(connectionState.availableActions).includes('probe')) primaryActions.push('probe');
    if (connectionState.publishEligible === true) primaryActions.push('publish');
    const versionRows = localVersions.map((item) =>
      versionRouteViewForItem(item, String((item && item.id) || '') === currentId),
    );
    const placeSummary = placeSummaryForCardView(null, versionRows);
    return {
      id: pkg && pkg.id,
      name: pkg && pkg.name,
      statusLabel: connectionState.label || connectionState.maturity || '草稿',
      currentLocalVersion,
      localVersions,
      versionRows,
      placeSummary,
      nextActionLabel: connectionState.nextAction || '',
      maintenanceChips: [{ label: connectionState.label || connectionState.maturity || '草稿', tone: 'neutral' }],
      primaryActions,
    };
  }

  function routeStatusFor(connectionState) {
    const maturity = compactText(connectionState && connectionState.maturity, '');
    if (maturity === 'connected') return { label: '已开通', tone: 'open', maturity };
    if (maturity === 'probe_failed' || maturity === 'bridge_installed') return { label: '需修复', tone: 'repair', maturity };
    return { label: '未开通', tone: 'pending', maturity };
  }

  function shortPathLabel(value, maxLen) {
    const text = compactText(value, '');
    if (!text) return '未指定位置';
    const limit = maxLen || 48;
    if (text.length <= limit) return text;
    const head = Math.max(8, Math.floor(limit * 0.35));
    const tail = Math.max(8, limit - head - 1);
    return text.slice(0, head) + '…' + text.slice(-tail);
  }

  function primaryRowActionFor(connectionState) {
    const maturity = compactText(connectionState && connectionState.maturity, '');
    if (maturity === 'connected') return null;
    if (maturity === 'probe_failed' || maturity === 'bridge_installed') return { action: 'repair_route', label: '修复路线' };
    return { action: 'open_route', label: '开通路线' };
  }

  function overflowMenuLabel(action) {
    const labels = {
      agent_loop: '让管家处理',
      conversation: '继续对话',
      discover_running: '识别运行',
      launch: '启动软件',
      close: '关闭软件',
      install: '安装桥接',
      probe: '探测路线',
      uninstall: '卸载桥接',
      export: '导出路线',
      publish: '提交云端',
      version: '切换云端版本',
      local_versions: '切换本机版本',
      delete: '删除地点',
    };
    return labels[String(action || '')] || actionLabel(action);
  }

  function connectionStateFor(pkg) {
    if (pkg && pkg.connectionState && typeof pkg.connectionState === 'object') return pkg.connectionState;
    const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
    const hostId = compactText(manifest.hostId || manifest.softwareId, '');
    const hasPath = Boolean(compactText(manifest.executablePath || manifest.shortcutPath || manifest.inputPath, ''));
    const make = (maturity, label, availableActions, blockedReason, nextAction, publishEligible) => ({
      maturity,
      label,
      availableActions,
      blockedReason: blockedReason || '',
      nextAction,
      publishEligible: publishEligible === true,
    });
    const base = ['agent_loop', 'conversation', 'export'];
    const process = ['discover_running', 'launch', 'close'];
    if (recordOk(pkg && pkg.lastProbe)) {
      return make('connected', '已开通', base.concat(process), '', '路线已通。选中文件后，点窗口顶部「发送到」。', true);
    }
    if (recordFailed(pkg && pkg.lastProbe)) {
      return make('probe_failed', '需修复', base.concat(process), '路线尚未收到软件信号。', '告诉管家修复这条路线。');
    }
    if (recordOk(pkg && pkg.lastInstall)) {
      return make('bridge_installed', '需修复', base.concat(process), '桥接已装，仍需验证路线。', '点「修复路线」或交给管家继续探测。');
    }
    if (hostId) {
      return make('strategy_draft', '未开通', base.concat(process), '还没有可用的配送路线。', '告诉管家开通这条路线。');
    }
    if (hasPath) {
      return make('exploring', '未开通', base, '已记录软件位置，路线尚未确认。', '告诉管家确认并开通路线。');
    }
    return make('discovery_pending', '未开通', base, '还没有可用的软件信息。', '添加地点、拖入快捷方式或识别运行中的软件。');
  }

  function ensureStyles() {
    const styleId = 'connection-page-style-v2';
    if (document.getElementById(styleId)) return;
    const legacy = document.getElementById('connection-page-style');
    if (legacy) legacy.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .connections-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
        gap: 12px;
        width: 100%;
      }
      .connection-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        min-height: 68px;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.028);
      }
      .connection-row:hover { background: rgba(255, 255, 255, 0.045); }
      .connection-row.is-focused {
        border-color: rgba(59, 130, 246, 0.45);
        background: rgba(37, 99, 235, 0.08);
      }
      .connection-row-mark {
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        border-radius: 9px;
        display: grid;
        place-items: center;
        color: rgba(244, 244, 245, 0.96);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(148, 163, 184, 0.18);
        font-size: 14px;
        font-weight: 700;
      }
      .connection-row-body { min-width: 0; flex: 1 1 auto; }
      .connection-row-head {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .connection-row-title {
        font-size: 13px;
        font-weight: 650;
        color: rgba(244, 244, 245, 0.96);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .connection-row-status {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 650;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        color: rgba(212, 212, 216, 0.86);
        background: rgba(255, 255, 255, 0.04);
      }
      .connection-row-status.is-open { color: rgba(212, 212, 216, 0.92); }
      .connection-row-status.is-repair {
        color: rgba(252, 165, 165, 0.92);
        border-color: rgba(239, 68, 68, 0.22);
      }
      .connection-row-sub {
        margin-top: 3px;
        font-size: 11px;
        color: rgba(161, 161, 170, 0.92);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .connection-row-actions {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }
      .connection-row-primary {
        height: 30px;
        padding: 0 12px;
        border-radius: 7px;
        border: 1px solid rgba(59, 130, 246, 0.45);
        background: rgba(37, 99, 235, 0.18);
        color: rgba(239, 246, 255, 0.98);
        font-size: 11px;
        font-weight: 650;
        cursor: pointer;
      }
      .connection-row-primary:hover { background: rgba(37, 99, 235, 0.28); }
      .connection-row-primary:disabled { opacity: 0.45; cursor: not-allowed; }
      .connection-row-menu { position: relative; }
      .connection-row-menu > summary {
        list-style: none;
        cursor: pointer;
        width: 30px;
        height: 30px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(212, 212, 216, 0.9);
        font-size: 16px;
        line-height: 1;
        display: grid;
        place-items: center;
      }
      .connection-row-menu > summary::-webkit-details-marker { display: none; }
      .connection-row-menu-panel {
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        z-index: 50;
        min-width: 168px;
        padding: 6px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 8px;
        background: #0f0f12;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      }
      .connection-row-menu-panel button {
        display: block;
        width: 100%;
        text-align: left;
        border: none;
        border-radius: 6px;
        padding: 7px 9px;
        background: transparent;
        color: rgba(244, 244, 245, 0.92);
        font-size: 11px;
        cursor: pointer;
      }
      .connection-row-menu-panel button:hover { background: rgba(255, 255, 255, 0.08); }
      .connection-row-menu-panel button.danger { color: rgba(252, 165, 165, 0.95); }
      .connection-row-extra { flex: 1 1 100%; margin-left: 48px; }
      .connection-row-result { margin-top: 6px; font-size: 11px; color: rgba(191, 219, 254, 0.88); }
      .connection-row-result.fail { color: rgba(252, 165, 165, 0.92); }
      .connection-place-group {
        display: flex;
        flex-direction: column;
        gap: 0;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.028);
        overflow: visible;
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03);
      }
      .connection-place-group:has(.connection-row-menu[open]) {
        position: relative;
        z-index: 40;
      }
      .connection-place-group:hover {
        background: rgba(255, 255, 255, 0.045);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
      }
      .connection-place-group.is-focused {
        border-color: rgba(59, 130, 246, 0.45);
        background: rgba(37, 99, 235, 0.08);
      }
      .connection-place-group.is-drop-target {
        border-color: rgba(59, 130, 246, 0.55);
        background: rgba(37, 99, 235, 0.12);
      }
      .connection-place-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        min-height: 52px;
        padding: 8px 12px;
      }
      .connection-place-summary {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 650;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        color: rgba(212, 212, 216, 0.86);
        background: rgba(255, 255, 255, 0.04);
      }
      .connection-version-rows {
        border-top: 1px solid rgba(148, 163, 184, 0.12);
        padding: 6px 12px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .connection-place-group.is-expanded .connection-place-head { cursor: pointer; }
      .connection-internal-routes {
        border-top: 1px solid rgba(148, 163, 184, 0.1);
        padding: 4px 12px 10px;
      }
      .connection-internal-head {
        font-size: 10px;
        color: rgba(161, 161, 170, 0.92);
        margin: 0 0 6px;
        letter-spacing: 0.02em;
      }
      .connection-internal-last-check {
        font-size: 10px;
        color: rgba(161, 161, 170, 0.75);
        padding: 0 8px 2px 10px;
      }
      .connection-internal-more {
        margin-top: 6px;
        padding-left: 2px;
      }
      .connection-version-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 6px 8px 6px 10px;
        border-radius: 8px;
        border: 1px solid transparent;
        border-left: 2px solid transparent;
      }
      .connection-version-row:hover { background: rgba(255, 255, 255, 0.04); }
      .connection-version-row.is-current {
        border-left-color: rgba(59, 130, 246, 0.55);
        background: rgba(37, 99, 235, 0.08);
      }
      .connection-version-row[data-can-set-current="true"] { cursor: pointer; }
      .connection-version-top {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .connection-version-label {
        flex: 0 0 auto;
        min-width: 40px;
        font-size: 12px;
        font-weight: 650;
        color: rgba(244, 244, 245, 0.94);
      }
      .connection-version-status {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 650;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        color: rgba(212, 212, 216, 0.86);
        background: rgba(255, 255, 255, 0.04);
      }
      .connection-version-status.is-open { color: rgba(134, 239, 172, 0.92); border-color: rgba(34, 197, 94, 0.25); }
      .connection-version-status.is-repair { color: rgba(252, 165, 165, 0.92); border-color: rgba(239, 68, 68, 0.22); }
      .connection-version-current-badge {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 650;
        color: rgba(191, 219, 254, 0.92);
      }
      .connection-version-actions {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }
      .connection-version-link {
        border: none;
        background: transparent;
        color: rgba(191, 219, 254, 0.95);
        font-size: 10px;
        font-weight: 650;
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .connection-version-link:hover { color: rgba(219, 234, 254, 0.98); }
      .connection-place-add-version {
        margin: 0 12px 8px;
        font-size: 11px;
        color: rgba(161, 161, 170, 0.92);
      }
      .connections-dock-link {
        border: none;
        background: transparent;
        color: rgba(191, 219, 254, 0.88);
        font-size: 11px;
        cursor: pointer;
        padding: 0;
      }
      .connections-dock-link:hover { text-decoration: underline; }
      .connection-card {
        display: none;
      }
      .connection-card.is-focused {
        border-color: rgba(59, 130, 246, 0.62);
        background: rgba(37, 99, 235, 0.12);
      }
      .connection-card-head {
        display: flex;
        align-items: flex-start;
        gap: 9px;
      }
      .connection-card-appmark {
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        color: rgba(244, 244, 245, 0.96);
        background: rgba(59, 130, 246, 0.18);
        border: 1px solid rgba(96, 165, 250, 0.26);
        font-size: 14px;
        font-weight: 800;
      }
      .connection-card-identity {
        min-width: 0;
        flex: 1 1 auto;
      }
      .connection-card-title {
        min-width: 0;
        font-size: 14px;
        font-weight: 700;
        color: rgba(244, 244, 245, 0.96);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-desc {
        margin-top: 3px;
        color: var(--muted);
        font-size: 11px;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-status {
        flex: none;
        border: 1px solid rgba(59, 130, 246, 0.36);
        border-radius: 999px;
        color: #bfdbfe;
        background: rgba(59, 130, 246, 0.12);
        padding: 3px 7px;
        font-size: 10px;
        font-weight: 700;
      }
      .connection-card-facts {
        display: grid;
        grid-template-columns: minmax(82px, 0.9fr) minmax(0, 1.8fr);
        gap: 8px;
      }
      .connection-card-fact {
        min-width: 0;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 7px;
        padding: 7px 8px;
        background: rgba(0, 0, 0, 0.11);
      }
      .connection-card-fact-label {
        color: rgba(161, 161, 170, 0.78);
        font-size: 11px;
        font-weight: 700;
      }
      .connection-card-fact-value {
        margin-top: 3px;
        min-width: 0;
        color: rgba(244, 244, 245, 0.9);
        font-size: 12px;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-fact-row {
        margin-top: 3px;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .connection-card-fact-row .connection-card-fact-value {
        margin-top: 0;
        flex: 1 1 auto;
      }
      .connection-card-version-trigger {
        flex: none;
        width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(212, 212, 216, 0.9);
        cursor: pointer;
      }
      .connection-card-version-trigger:hover {
        border-color: rgba(59, 130, 246, 0.44);
        background: rgba(59, 130, 246, 0.1);
      }
      .connection-card-version-drawer {
        display: grid;
        gap: 7px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.14);
      }
      .connection-card-version-row {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 7px;
        padding: 7px;
        background: rgba(255, 255, 255, 0.025);
      }
      .connection-card-version-row.is-current {
        border-color: rgba(59, 130, 246, 0.36);
        background: rgba(59, 130, 246, 0.08);
      }
      .connection-card-version-name {
        min-width: 0;
        color: rgba(244, 244, 245, 0.92);
        font-size: 12px;
        font-weight: 750;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-version-meta {
        margin-top: 2px;
        min-width: 0;
        color: rgba(161, 161, 170, 0.82);
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-version-actions {
        display: flex;
        gap: 5px;
      }
      .connection-card-next {
        border: 1px solid rgba(96, 165, 250, 0.22);
        border-radius: 7px;
        padding: 8px 9px;
        background: rgba(37, 99, 235, 0.08);
        color: rgba(219, 234, 254, 0.94);
      }
      .connection-card-next-label {
        color: rgba(147, 197, 253, 0.88);
        font-size: 11px;
        font-weight: 800;
      }
      .connection-card-next-value {
        margin-top: 3px;
        font-size: 12px;
        line-height: 1.42;
      }
      .connection-card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .connection-card-tag {
        padding: 3px 7px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(212, 212, 216, 0.84);
        background: rgba(255, 255, 255, 0.04);
        font-size: 10px;
        font-weight: 600;
      }
      .connection-card-availability {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .connection-card-availability-chip {
        padding: 3px 6px;
        border-radius: 6px;
        border: 1px solid rgba(34, 197, 94, 0.22);
        color: rgba(187, 247, 208, 0.9);
        background: rgba(22, 163, 74, 0.08);
        font-size: 10px;
        font-weight: 700;
      }
      .connection-card-result {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 7px;
        padding: 7px 8px;
        color: rgba(244, 244, 245, 0.88);
        background: rgba(255, 255, 255, 0.04);
        font-size: 11px;
        line-height: 1.4;
      }
      .connection-card-result.ok {
        border-color: rgba(34, 197, 94, 0.32);
        background: rgba(22, 163, 74, 0.08);
      }
      .connection-card-result.fail {
        border-color: rgba(239, 68, 68, 0.34);
        color: #fecaca;
        background: rgba(239, 68, 68, 0.08);
      }
      .connection-card-events {
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.1);
      }
      .connection-card-support {
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.025);
        padding: 8px;
      }
      .connection-card-support-head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: rgba(212, 212, 216, 0.86);
        font-size: 11px;
        font-weight: 800;
      }
      .connection-card-support-note {
        min-width: 0;
        color: rgba(161, 161, 170, 0.78);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-support-chips {
        margin-top: 7px;
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .connection-card-support-chip {
        max-width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        padding: 3px 7px;
        color: rgba(212, 212, 216, 0.82);
        background: rgba(255, 255, 255, 0.035);
        font-size: 10px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-event-list {
        display: grid;
        gap: 5px;
        padding: 0 8px 8px;
      }
      .connection-card-event {
        min-width: 0;
        display: grid;
        gap: 2px;
        color: rgba(212, 212, 216, 0.78);
        font-size: 11px;
        line-height: 1.35;
      }
      .connection-card-event.fail {
        color: #fecaca;
      }
      .connection-card-event-kind {
        font-weight: 700;
      }
      .connection-card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .connection-card-utility-actions {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding-top: 2px;
      }
      .connection-card-action {
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.045);
        color: rgba(244, 244, 245, 0.92);
        padding: 0;
        cursor: pointer;
      }
      .connection-card-action-icon {
        width: 15px;
        height: 15px;
        display: block;
      }
      .connection-card-action:hover {
        border-color: rgba(59, 130, 246, 0.48);
        background: rgba(59, 130, 246, 0.11);
      }
      .connection-card-action.primary {
        border-color: rgba(59, 130, 246, 0.42);
        color: #dbeafe;
        background: rgba(37, 99, 235, 0.16);
      }
      .connection-card-action:disabled {
        opacity: 0.5;
        cursor: wait;
      }
      .connection-card-action.danger:hover {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(239, 68, 68, 0.1);
      }
      .connections-error {
        max-width: 720px;
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: 8px;
        padding: 10px 12px;
        color: #fecaca;
        background: rgba(239, 68, 68, 0.08);
        font-size: 12px;
      }
      .connections-empty-result {
        max-width: 720px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 8px;
        padding: 10px 12px;
        color: rgba(212, 212, 216, 0.82);
        background: rgba(255, 255, 255, 0.035);
        font-size: 12px;
      }
      #view-connections.connection-drop-active {
        outline: 1px solid rgba(59, 130, 246, 0.72);
        outline-offset: -6px;
        background: rgba(59, 130, 246, 0.045);
      }
      #view-connections.connection-drop-active .connections-empty {
        border-color: rgba(96, 165, 250, 0.72);
        background: rgba(37, 99, 235, 0.08);
      }
    `;
    document.head.appendChild(style);
  }

  window.ShellConnectionPage = {
    _shell: null,
    drafts: [],
    packages: [],
    isAdmin: false,
    listError: null,
    searchQuery: '',
    inlineStatus: '',
    busyId: '',
    cardResults: {},
    selectedLocalVersionIds: {},
    _reloadGen: 0,
    _dropBound: false,
    _dropDepth: 0,
    focusedConnectionId: '',
    expandedConnectionIds: {},
    _healthPromptAtByDraft: {},

    buildConnectionComposerMessage(kind, pkg, row) {
      const name = compactText(pkg && (pkg.name || pkg.id), '这个软件');
      if (kind === 'create') {
        return '我想在地图添加一个本机软件地点，请帮我创建连接并探测路线。';
      }
      if (kind === 'health_check') {
        const hostName = compactText(row && row.hostName, name);
        const count = Number(row && row.count) || 0;
        return '请检查一下 ' + hostName + ' 城内' + (count > 0 ? ' ' + count + ' 条' : '') + '基础路线是否正常。';
      }
      if (row && typeof row === 'object' && row.internalRoute === true) {
        const routeName = compactText(row.label, '这条内线');
        if (row.routeTone === 'repair') return '请帮我修复 ' + name + ' 的「' + routeName + '」内线。';
        return '请帮我验证 ' + name + ' 的「' + routeName + '」内线。';
      }
      if (row && typeof row === 'object') {
        const ver = compactText(row.label || row.softwareVersion, '');
        const verText = ver ? ' ' + ver : '';
        if (row.routeTone === 'repair') return '请帮我修复 ' + name + verText + ' 的连接。';
        if (compactText(row.routeLabel, '') === '未验证') return '请帮我验证 ' + name + verText + ' 的连接。';
        return '请帮我开通 ' + name + verText + ' 的连接。';
      }
      return '请继续处理 ' + name + ' 的连接。';
    },

    async openDshHandoff(payload) {
      const shell = this._shell;
      if (!shell || typeof shell.openDshHandoff !== 'function') {
        this.setInlineStatus('当前壳版本还不支持管家办事入口。');
        return { ok: false };
      }
      const body = payload && typeof payload === 'object' ? payload : {};
      const composerText = compactText(body.composerText || body.suggestedMessage, '');
      const r = await shell.openDshHandoff({ ...body, composerText });
      if (!r || r.ok === false) {
        this.setInlineStatus('管家入口打开失败：' + ((r && r.error) || '未知错误'));
        return r || { ok: false };
      }
      this.setInlineStatus(composerText ? '已填入管家输入框，确认后点发送即可。' : '已打开管家面板。');
      return r;
    },

    openCreateConnectionWithButler() {
      void this.openDshHandoff({
        domain: 'connection',
        label: '新地点',
        surface: 'connections',
        composerText: this.buildConnectionComposerMessage('create'),
      });
    },

    openCreateConnectionCopilot() {
      this.openCreateConnectionWithButler();
    },

    capabilityContext(pkg) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      return [
        '当前对话绑定到一个连接能力包对象。',
        '能力包 ID: ' + (pkg.id || ''),
        '名称: ' + (pkg.name || pkg.id || ''),
        '类型: ' + (pkg.type || ''),
        '来源: ' + (pkg.source || ''),
        '草稿状态: ' + (pkg.draftStatus || ''),
        '目标软件: ' + (manifest.appName || pkg.name || ''),
        '连接提示: ' + (manifest.templateHint || ''),
        '生命周期: validate/install/launch/probe/close/uninstall/publish',
        '继续修改时围绕这个 CapabilityPackage 草稿进行，不要恢复旧 62 宿主 catalog。',
      ]
        .filter((line) => String(line || '').trim())
        .join('\n');
    },

    async fetchCapabilityContext(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return null;
      const r = await shell.api('GET', '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/context', null);
      if (!r || !r.ok || !r.json || !r.json.ok) return null;
      return r.json;
    },

    async openCapabilityConversation(pkg, composerText) {
      const message = compactText(composerText, '') || this.buildConnectionComposerMessage('continue', pkg);
      await this.openDshHandoff({
        domain: 'connection',
        capabilityPackageId: pkg.id,
        label: pkg.name || pkg.id,
        surface: 'connections',
        composerText: message,
      });
    },

    async fetchDrafts(shell) {
      if (!shell || typeof shell.api !== 'function') return [];
      const r = await shell.api('GET', '/v1/capability-packages/drafts', null);
      if (!r || !r.ok) {
        throw new Error((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '读取连接草稿失败');
      }
      const drafts = r.json && Array.isArray(r.json.drafts) ? r.json.drafts : [];
      return drafts.filter((pkg) => pkg && pkg.type === 'software_connection');
    },

    async refreshAdminState(shell) {
      if (!shell || typeof shell.accountStatus !== 'function') {
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

    async fetchCloudPackages(shell) {
      if (!shell || typeof shell.api !== 'function') return { packages: [], versions: [] };
      const r = await shell.api('GET', '/v1/capability-packages/cloud', null);
      if (!r || !r.ok) return { packages: [], versions: [] };
      return {
        packages: r.json && Array.isArray(r.json.packages) ? r.json.packages : [],
        versions: r.json && Array.isArray(r.json.versions) ? r.json.versions : [],
      };
    },

    packageSignature(pkg) {
      if (!pkg || typeof pkg !== 'object') return '';
      return JSON.stringify({
        type: pkg.type,
        name: pkg.name,
        description: pkg.description,
        tags: Array.isArray(pkg.tags) ? pkg.tags : [],
        manifest: pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {},
        lifecycle: pkg.lifecycle && typeof pkg.lifecycle === 'object' ? pkg.lifecycle : {},
        governance: pkg.governance && typeof pkg.governance === 'object' ? pkg.governance : {},
      });
    },

    mergePackages(drafts, cloud) {
      const cloudPackages = Array.isArray(cloud && cloud.packages) ? cloud.packages : [];
      const versions = Array.isArray(cloud && cloud.versions) ? cloud.versions : [];
      const versionsById = new Map();
      for (const version of versions) {
        const id = String(version && version.packageId ? version.packageId : '').trim();
        if (!id) continue;
        if (!versionsById.has(id)) versionsById.set(id, []);
        versionsById.get(id).push(version);
      }
      const cloudById = new Map();
      for (const pkg of cloudPackages) {
        if (pkg && pkg.id && pkg.type === 'software_connection') cloudById.set(String(pkg.id), pkg);
      }
      const out = [];
      const seen = new Set();
      for (const draft of drafts || []) {
        const id = String(draft && draft.id ? draft.id : '').trim();
        if (!id) continue;
        seen.add(id);
        const activeCloudPackage = cloudById.get(id) || null;
        const cloudVersions = versionsById.get(id) || [];
        const merged = {
          ...draft,
          cloudVersions,
          activeCloudPackage,
          hasCloud: Boolean(activeCloudPackage || cloudVersions.length),
          cloudVersion: activeCloudPackage && activeCloudPackage.version,
          hasCloudMismatch: activeCloudPackage
            ? this.packageSignature(draft) !== this.packageSignature(activeCloudPackage)
            : true,
        };
        out.push({ ...merged, connectionState: connectionStateFor(merged) });
      }
      for (const pkg of cloudPackages) {
        const id = String(pkg && pkg.id ? pkg.id : '').trim();
        if (!id || seen.has(id) || pkg.type !== 'software_connection') continue;
        const merged = {
          ...pkg,
          draftStatus: 'cloud',
          cloudVersions: versionsById.get(id) || [],
          activeCloudPackage: pkg,
          hasCloud: true,
          cloudVersion: pkg.version,
          hasCloudMismatch: false,
        };
        out.push({ ...merged, connectionState: connectionStateFor(merged) });
      }
      return out;
    },

    canPublishPackage(pkg) {
      const schema = window.ShellCapabilityCardSchema;
      if (schema && typeof schema.canPublish === 'function') return schema.canPublish(pkg, { isAdmin: this.isAdmin });
      return Boolean(this.isAdmin && pkg && pkg.source === 'draft' && pkg.governance && pkg.governance.cloudVersioned === true);
    },

    latestEvent(pkg) {
      const events = asArray(pkg && pkg.events);
      const lastEvent = events.length ? events[events.length - 1] : null;
      if (lastEvent && typeof lastEvent === 'object') {
        return {
          ok: lastEvent.ok === true,
          kind: compactText(lastEvent.kind, 'event'),
          message: compactText(lastEvent.message, ''),
        };
      }
      const lastProbe = pkg && pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      if (lastProbe) {
        const result = lastProbe.result && typeof lastProbe.result === 'object' ? lastProbe.result : {};
        return {
          ok: lastProbe.ok === true,
          kind: 'probe',
          message: compactText(result.message || lastProbe.message, lastProbe.ok ? '已收到真实连接信号' : '未收到真实连接信号'),
        };
      }
      const lastInstall = pkg && pkg.lastInstall && typeof pkg.lastInstall === 'object' ? pkg.lastInstall : null;
      if (lastInstall) {
        const result = lastInstall.result && typeof lastInstall.result === 'object' ? lastInstall.result : {};
        return {
          ok: lastInstall.ok === true,
          kind: 'install',
          message: compactText(result.message || lastInstall.message, lastInstall.ok ? '安装完成，仍需探测' : '安装未完成'),
        };
      }
      return null;
    },

    recentEvents(pkg) {
      const rows = [];
      const push = (kind, ok, message) => {
        rows.push({
          kind: compactText(kind, 'event'),
          ok: ok === true,
          message: compactText(message, ok === true ? '完成' : '未完成'),
        });
      };
      const lastInstall = pkg && pkg.lastInstall && typeof pkg.lastInstall === 'object' ? pkg.lastInstall : null;
      if (lastInstall) {
        const result = lastInstall.result && typeof lastInstall.result === 'object' ? lastInstall.result : {};
        push('install', lastInstall.ok === true, result.message || lastInstall.message);
      }
      const lastProbe = pkg && pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      if (lastProbe) {
        const result = lastProbe.result && typeof lastProbe.result === 'object' ? lastProbe.result : {};
        push('probe', lastProbe.ok === true, result.message || lastProbe.message);
      }
      for (const event of asArray(pkg && pkg.events)) {
        if (!event || typeof event !== 'object') continue;
        push(event.kind, event.ok === true, event.message);
      }
      return rows.slice(-5).reverse();
    },

    latestTemplateDraft(pkg) {
      const events = asArray(pkg && pkg.events);
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || typeof event !== 'object' || event.kind !== 'connection_template_draft_created') continue;
        const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
        const templateDraft = detail.templateDraft && typeof detail.templateDraft === 'object' ? detail.templateDraft : null;
        if (templateDraft) return templateDraft;
      }
      return null;
    },

    latestStrategyDraft(pkg) {
      const events = asArray(pkg && pkg.events);
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || typeof event !== 'object' || event.kind !== 'connection_strategy_draft_created') continue;
        const detail = event.detail && typeof event.detail === 'object' ? event.detail : null;
        if (detail) return detail;
      }
      return null;
    },

    latestStrategyFailure(pkg) {
      const events = asArray(pkg && pkg.events);
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || typeof event !== 'object' || event.kind !== 'connection_strategy_failed') continue;
        const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
        return {
          failureClass: compactText(detail.failureClass, 'unknown'),
          strategyId: compactText(detail.strategyId, ''),
          nextCandidateStrategy: detail.nextCandidateStrategy && typeof detail.nextCandidateStrategy === 'object' ? detail.nextCandidateStrategy : null,
        };
      }
      return null;
    },

    factsSummary(facts) {
      if (!facts || typeof facts !== 'object') return '等待收集';
      const parts = [];
      if (facts.executablePath) parts.push('exe');
      if (facts.shortcutPath) parts.push('快捷方式');
      if (facts.processName) parts.push('进程');
      if (asArray(facts.candidateProjectDirs).length) parts.push('项目目录 ' + asArray(facts.candidateProjectDirs).length);
      if (asArray(facts.candidateScriptDirs).length) parts.push('脚本目录 ' + asArray(facts.candidateScriptDirs).length);
      if (asArray(facts.candidatePluginDirs).length) parts.push('插件目录 ' + asArray(facts.candidatePluginDirs).length);
      return parts.length ? parts.join(' / ') : '等待收集';
    },

    strategySummary(strategyDraft) {
      if (!strategyDraft || typeof strategyDraft !== 'object') return '等待候选策略';
      const candidates = asArray(strategyDraft.candidateStrategies);
      const current = strategyDraft.recommendedNextStrategy && typeof strategyDraft.recommendedNextStrategy === 'object'
        ? strategyDraft.recommendedNextStrategy
        : null;
      return (current ? compactText(current.label || current.id, '候选策略') + ' / ' : '') + candidates.length + ' 个候选';
    },

    softwareVersionLabel(pkg, facts) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      return compactText(
        manifest.softwareVersion || manifest.version || manifest.versionHint || (facts && facts.version),
        '未识别',
      );
    },

    connectionTargetLabel(pkg) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      return compactText(manifest.executablePath || manifest.shortcutPath || manifest.inputPath || manifest.targetDir || '', '未记录启动位置');
    },

    nextActionLabel(pkg, latest) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      const hostId = compactText(manifest.hostId || manifest.softwareId, '');
      const lastProbe = pkg && pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      const connectionState = connectionStateFor(pkg);
      if (connectionState && connectionState.nextAction) return connectionState.nextAction;
      if (lastProbe && lastProbe.ok) return '已连接，可继续对话优化这个连接';
      if (latest && latest.ok === false) return '交给管家读取失败并继续修复';
      if (!hostId) return '补齐连接方式和真实探测信号';
      return '启动、安装或探测，直到收到真实信号';
    },

    matchesSearch(pkg) {
      const q = String(this.searchQuery || '').trim().toLowerCase();
      if (!q) return true;
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      const haystack = [
        pkg && pkg.id,
        pkg && pkg.name,
        pkg && pkg.description,
        pkg && pkg.draftStatus,
        pkg && pkg.connectionState && pkg.connectionState.maturity,
        pkg && pkg.connectionState && pkg.connectionState.label,
        pkg && pkg.connectionState && pkg.connectionState.blockedReason,
        pkg && pkg.connectionState && pkg.connectionState.nextAction,
        pkg && pkg.connectionState && Array.isArray(pkg.connectionState.availableActions)
          ? pkg.connectionState.availableActions.join(' ')
          : '',
        manifest.appName,
        manifest.hostId,
        manifest.exeName,
        manifest.executablePath,
        manifest.shortcutPath,
        manifest.inputPath,
        ...asArray(pkg && pkg.tags),
      ]
        .map((item) => String(item || '').toLowerCase())
        .join('\n');
      return haystack.includes(q);
    },

    setCardResult(pkg, kind, message, ok) {
      const id = String(pkg && pkg.id ? pkg.id : '');
      if (!id) return;
      this.cardResults = {
        ...this.cardResults,
        [id]: {
          kind: compactText(kind, ''),
          message: compactText(message, ''),
          ok: ok === true,
        },
      };
    },

    lifecycleMessage(action, body, fallback) {
      const result = body && body.result && typeof body.result === 'object' ? body.result : {};
      return compactText(
        body && (body.message || body.error || result.message || body.nextAction),
        fallback || `${actionLabel(action)}已完成`,
      );
    },

    overflowActionsFor(pkg, viewActions, connectionState, localVersions) {
      void viewActions;
      void connectionState;
      void localVersions;
      const actions = ['agent_loop'];
      if (this.isAdmin && this.canPublishPackage(pkg)) actions.push('publish');
      if (this.isAdmin && asArray(pkg && pkg.cloudVersions).length) actions.push('version');
      if (pkg && pkg.source === 'draft') actions.push('delete');
      return actions.filter((action, index, list) => list.indexOf(action) === index);
    },

    renderInternalRouteRowsHtml(pkg, internalRows) {
      void pkg;
      if (!internalRows.length) {
        return (
          '<div class="connection-internal-routes">' +
          '<div class="connection-internal-head">城内路线</div>' +
          '<div class="connection-place-add-version">外线路开通后会自动登记基础内线</div>' +
          '</div>'
        );
      }
      return (
        '<div class="connection-internal-routes">' +
        '<div class="connection-internal-head">城内路线</div>' +
        '<div class="connection-version-rows">' +
        internalRows
          .map((row) => {
            const primary = internalRowPrimaryAction(row);
            const primaryHtml = primary
              ? '<div class="connection-version-actions">' +
                '<button type="button" class="connection-version-link" data-internal-action="' +
                esc(primary.action) +
                '" data-primitive-id="' +
                esc(row.id) +
                '" data-route-tone="' +
                esc(row.routeTone || '') +
                '" data-route-label="' +
                esc(row.routeLabel || '') +
                '" data-route-label-text="' +
                esc(row.label || '') +
                '">' +
                esc(primary.label) +
                '</button></div>'
              : '';
            const staleHint = row.lastProbeAt
              ? '<div class="connection-internal-last-check">上次检查：' + esc(formatRelativeProbeAge(row.lastProbeAt)) + '</div>'
              : '';
            return (
              '<div class="connection-version-row connection-internal-row" data-primitive-id="' +
              esc(row.id) +
              '">' +
              '<div class="connection-version-top">' +
              '<span class="connection-version-label">' +
              esc(row.label) +
              '</span>' +
              '<span class="connection-version-status' +
              (row.routeTone === 'open' ? ' is-open' : row.routeTone === 'repair' ? ' is-repair' : '') +
              '">' +
              esc(row.routeLabel) +
              '</span>' +
              primaryHtml +
              '</div>' +
              staleHint +
              '</div>'
            );
          })
          .join('') +
        '</div>' +
        '<div class="connection-internal-more"><button type="button" class="connection-version-link" data-action="open_tools_shelf">更多组合能力 → 五金铺</button></div>' +
        '</div>'
      );
    },

    renderVersionRowsHtml(pkg, versionRows, connectionState) {
      void pkg;
      void connectionState;
      if (!versionRows.length) {
        return '<div class="connection-place-add-version">拖入 exe 或快捷方式到此处，可添加本机版本</div>';
      }
      return (
        '<div class="connection-version-rows">' +
        versionRows
          .map((row) => {
            const primary = versionRowPrimaryAction(row);
            const canSetCurrent = !row.isCurrent;
            const currentBadge = row.isCurrent
              ? '<span class="connection-version-current-badge">当前</span>'
              : '';
            const primaryHtml = primary
              ? '<div class="connection-version-actions">' +
                '<button type="button" class="connection-version-link" data-version-action="' +
                esc(primary.action) +
                '" data-local-version-id="' +
                esc(row.id) +
                '" data-route-tone="' +
                esc(row.routeTone || '') +
                '" data-route-label="' +
                esc(row.routeLabel || '') +
                '" data-version-label="' +
                esc(row.label || '') +
                '">' +
                esc(primary.label) +
                '</button></div>'
              : '';
            return (
              '<div class="connection-version-row' +
              (row.isCurrent ? ' is-current' : '') +
              '" data-local-version-id="' +
              esc(row.id) +
              '" data-can-set-current="' +
              (canSetCurrent ? 'true' : 'false') +
              '"' +
              (canSetCurrent ? ' title="点击设为当前"' : '') +
              '>' +
              '<div class="connection-version-top">' +
              '<span class="connection-version-label">' +
              esc(row.label) +
              '</span>' +
              '<span class="connection-version-status' +
              (row.routeTone === 'open' ? ' is-open' : row.routeTone === 'repair' ? ' is-repair' : '') +
              '">' +
              esc(row.routeLabel) +
              '</span>' +
              currentBadge +
              primaryHtml +
              '</div></div>'
            );
          })
          .join('') +
        '</div>'
      );
    },

    wireConnectionRow(card, pkg) {
      if (!card || !pkg) return;
      const closeMenus = () => {
        for (const node of document.querySelectorAll('.connection-row-menu[open]')) node.removeAttribute('open');
        const pageMenu = $('connectionsPageMenu');
        if (pageMenu) pageMenu.removeAttribute('open');
      };
      card.querySelector('.connection-row-menu-panel [data-action="agent_loop"]')?.addEventListener('click', () => {
        closeMenus();
        void this.runConnectionAgentLoop(pkg);
      });
      card.querySelector('.connection-row-menu-panel [data-action="version"]')?.addEventListener('click', () => {
        closeMenus();
        void this.chooseCloudVersion(pkg);
      });
      card.querySelector('.connection-row-menu-panel [data-action="publish"]')?.addEventListener('click', () => {
        closeMenus();
        void this.publishToCloud(pkg);
      });
      card.querySelector('.connection-row-menu-panel [data-action="delete"]')?.addEventListener('click', () => {
        closeMenus();
        void this.deleteDraft(pkg);
      });
      card.querySelector('.connection-place-head')?.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
        card.classList.add('is-drop-target');
      });
      card.querySelector('.connection-place-head')?.addEventListener('dragleave', () => {
        card.classList.remove('is-drop-target');
      });
      card.querySelector('.connection-place-head')?.addEventListener('drop', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        card.classList.remove('is-drop-target');
        const files = ev.dataTransfer && ev.dataTransfer.files;
        if (!files || !files.length) return;
        void this.handleDroppedConnectionFiles(files, pkg);
      });
      for (const row of card.querySelectorAll('.connection-version-row[data-can-set-current="true"]')) {
        row.addEventListener('click', () => {
          const versionId = String(row.getAttribute('data-local-version-id') || '').trim();
          void this.setLocalVersion(pkg, versionId);
        });
      }
      for (const button of card.querySelectorAll('[data-version-action="repair_route"]')) {
        button.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const versionId = String(button.getAttribute('data-local-version-id') || '').trim();
          const state = connectionStateFor(pkg);
          if (asArray(state.availableActions).includes('probe')) {
            void this.runLifecycleAction(pkg, 'probe', versionId ? { localVersionId: versionId } : undefined);
          } else {
            void this.openCapabilityConversation(
              pkg,
              this.buildConnectionComposerMessage('version', pkg, {
                id: versionId,
                label: button.getAttribute('data-version-label'),
                routeTone: button.getAttribute('data-route-tone'),
                routeLabel: button.getAttribute('data-route-label'),
              }),
            );
          }
        });
      }
      for (const button of card.querySelectorAll('[data-version-action="open_route"]')) {
        button.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const versionId = String(button.getAttribute('data-local-version-id') || '').trim();
          if (versionId) void this.setLocalVersion(pkg, versionId);
          void this.openCapabilityConversation(
            pkg,
            this.buildConnectionComposerMessage('version', pkg, {
              id: versionId,
              label: button.getAttribute('data-version-label'),
              routeTone: button.getAttribute('data-route-tone'),
              routeLabel: button.getAttribute('data-route-label'),
            }),
          );
        });
      }
      card.querySelector('.connection-place-head')?.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('.connection-row-menu, button, summary')) return;
        const id = String(pkg.id || '').trim();
        if (!id) return;
        this.expandedConnectionIds[id] = !this.expandedConnectionIds[id];
        this.render();
      });
      for (const button of card.querySelectorAll('[data-internal-action]')) {
        button.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const primitiveId = String(button.getAttribute('data-primitive-id') || '').trim();
          void this.probeInternalRoute(pkg, primitiveId, {
            label: button.getAttribute('data-route-label-text'),
            routeTone: button.getAttribute('data-route-tone'),
            routeLabel: button.getAttribute('data-route-label'),
          });
        });
      }
      card.querySelector('[data-action="open_tools_shelf"]')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const shell = this._shell;
        if (shell && typeof shell.setActiveView === 'function') void shell.setActiveView('tools');
      });
    },

    async probeInternalRoute(pkg, primitiveId, rowMeta) {
      const id = String((pkg && pkg.id) || '').trim();
      const primitive = String(primitiveId || '').trim();
      if (!id || !primitive) return;
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') {
        void this.openDshHandoff({
          domain: 'connection',
          label: compactText(pkg && pkg.name, id),
          surface: 'connections',
          composerText: this.buildConnectionComposerMessage('internal', pkg, {
            internalRoute: true,
            label: rowMeta && rowMeta.label,
            routeTone: rowMeta && rowMeta.routeTone,
            routeLabel: rowMeta && rowMeta.routeLabel,
          }),
        });
        return;
      }
      this.busyId = id;
      this.render();
      try {
        const r = await shell.api(
          'POST',
          '/v1/capability-packages/' + encodeURIComponent(id) + '/host-primitives/' + encodeURIComponent(primitive) + '/probe',
          { confirmed: true },
        );
        if (!r.ok) {
          this.cardResults[id] = { ok: false, kind: '内线', message: (r.json && (r.json.message || r.json.error)) || r.error || '验证失败' };
        } else {
          this.cardResults[id] = { ok: true, kind: '内线', message: '已更新内线状态' };
        }
      } catch (e) {
        this.cardResults[id] = { ok: false, kind: '内线', message: e instanceof Error ? e.message : String(e) };
      } finally {
        this.busyId = '';
        await this.reload(shell);
      }
    },

    maybePromptHealthCheck() {
      const pendingByDraft = new Map();
      for (const pkg of this.packages) {
        const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
        const pending = asArray(manifest.healthCheckPending);
        if (!pending.length) continue;
        pendingByDraft.set(String(pkg.id || ''), { pkg, count: pending.length });
      }
      if (!pendingByDraft.size) return;
      const first = pendingByDraft.values().next().value;
      if (!first || !first.pkg) return;
      const draftId = String(first.pkg.id || '');
      const last = Number(this._healthPromptAtByDraft[draftId] || 0);
      if (Number.isFinite(last) && Date.now() - last < 24 * 60 * 60 * 1000) return;
      this._healthPromptAtByDraft[draftId] = Date.now();
      void this.openDshHandoff({
        domain: 'connection',
        label: compactText(first.pkg.name, draftId),
        surface: 'connections',
        composerText: this.buildConnectionComposerMessage('health_check', first.pkg, {
          hostName: first.pkg.name,
          count: first.count,
        }),
      });
    },

    renderSummary(items, visibleItems) {
      const summary = $('connectionsSummary');
      const status = $('connectionsInlineStatus');
      if (!summary) return;
      const visible = Array.isArray(visibleItems) ? visibleItems.length : items.length;
      const openCount = items.filter((pkg) => connectionStateFor(pkg).maturity === 'connected').length;
      const q = String(this.searchQuery || '').trim();
      summary.textContent = q
        ? '共 ' + items.length + ' 个地点，筛选出 ' + visible + ' 个'
        : items.length
          ? '共 ' + items.length + ' 个地点，' + openCount + ' 条路线已开通'
          : '';
      if (status && !this.inlineStatus) {
        const repairCount = items.filter((pkg) => {
          const m = connectionStateFor(pkg).maturity;
          return m === 'probe_failed' || m === 'bridge_installed';
        }).length;
        status.textContent = repairCount ? repairCount + ' 个地点的路线需修复，可交给管家处理。' : '';
      } else if (status) {
        status.textContent = this.inlineStatus;
      }
    },

    renderCard(pkg) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      const schema = window.ShellCapabilityCardSchema;
      const view =
        schema && typeof schema.view === 'function'
          ? schema.view(pkg, { isAdmin: this.isAdmin, templateHint: manifest.templateHint })
          : {
              title: pkg.name || pkg.id || '未命名地点',
              description: pkg.description || `${manifest.appName || pkg.name || '本机软件'} 路线`,
              status: connectionStateFor(pkg).label,
              tags: [],
              actions: ['conversation', 'discover_running', 'launch', 'install', 'probe', 'close', 'uninstall', 'export'],
            };
      const cardView = connectionCardViewFor(pkg);
      const localVersions = asArray(cardView && cardView.localVersions);
      const selectedLocalVersionId = compactText(this.selectedLocalVersionIds[String(pkg.id || '')], '');
      const selectedLocalVersion =
        localVersions.find((item) => item && typeof item === 'object' && String(item.id || '') === selectedLocalVersionId) ||
        null;
      const actions = Array.from(new Set((Array.isArray(view.actions) ? view.actions : []).concat(asArray(cardView && cardView.primaryActions))));
      const currentLocalVersion =
        selectedLocalVersion ||
        (cardView && cardView.currentLocalVersion && typeof cardView.currentLocalVersion === 'object'
          ? cardView.currentLocalVersion
          : null);
      const versionRows = versionRowsForCardView(cardView, currentLocalVersion);
      const placeSummary = placeSummaryForCardView(cardView, versionRows);
      const connectionState = connectionStateFor(pkg);
      const overflowActions = this.overflowActionsFor(pkg, actions, connectionState, localVersions);
      const busy = this.busyId === String(pkg.id || '');
      const cardResult = this.cardResults[String(pkg.id || '')] || null;
      const overflowHtml = overflowActions.length
        ? '<details class="connection-row-menu">' +
          '<summary aria-label="更多">⋯</summary>' +
          '<div class="connection-row-menu-panel">' +
          overflowActions
            .map((action) => {
              const danger = action === 'delete';
              return (
                '<button type="button" class="' +
                (danger ? 'danger' : '') +
                '" data-action="' +
                esc(action) +
                '">' +
                esc(overflowMenuLabel(action)) +
                '</button>'
              );
            })
            .join('') +
          '</div></details>'
        : '';
      const resultHtml = cardResult
        ? '<div class="connection-row-result' +
          (cardResult.ok ? '' : ' fail') +
          '">' +
          esc(cardResult.kind) +
          '：' +
          esc(cardResult.message) +
          '</div>'
        : '';
      const versionRowsHtml = this.renderVersionRowsHtml(pkg, versionRows, connectionState);
      const connectionId = String(pkg.id || '');
      const expanded = this.expandedConnectionIds[connectionId] === true;
      const internalRows = internalRouteRowsForCardView(cardView);
      const internalRowsHtml = expanded ? this.renderInternalRouteRowsHtml(pkg, internalRows) : '';
      const card = document.createElement('article');
      card.className =
        'connection-place-group' +
        (this.focusedConnectionId === connectionId ? ' is-focused' : '') +
        (expanded ? ' is-expanded' : '');
      card.dataset.connectionId = connectionId;
      card.innerHTML =
        '<div class="connection-place-head" data-drop-target="place">' +
        '<div class="connection-row-mark">' +
        esc(cardInitial(view.title)) +
        '</div>' +
        '<div class="connection-row-body">' +
        '<div class="connection-row-head">' +
        '<div class="connection-row-title">' +
        esc(view.title) +
        '</div>' +
        '<span class="connection-place-summary">' +
        esc(placeSummary.summaryLabel) +
        '</span>' +
        '</div>' +
        (resultHtml ? '<div class="connection-row-extra">' + resultHtml + '</div>' : '') +
        '</div>' +
        '<div class="connection-row-actions">' +
        overflowHtml +
        '</div></div>' +
        versionRowsHtml +
        internalRowsHtml;
      if (busy) {
        for (const button of card.querySelectorAll('button')) button.disabled = true;
      }
      this.wireConnectionRow(card, pkg);
      return card;
    },

    render() {
      ensureStyles();
      const empty = $('connectionsEmpty');
      const list = $('connectionsList');
      if (!list || !empty) return;
      list.innerHTML = '';
      const visiblePackages = this.packages.filter((pkg) => this.matchesSearch(pkg));
      this.renderSummary(this.packages, visiblePackages);
      if (this.listError) {
        empty.classList.add('hidden');
        list.className = 'connections-list';
        const error = document.createElement('div');
        error.className = 'connections-error';
        error.textContent = this.listError;
        list.appendChild(error);
        return;
      }
      if (!this.packages.length) {
        empty.classList.remove('hidden');
        list.className = 'hidden';
        return;
      }
      if (!visiblePackages.length) {
        empty.classList.add('hidden');
        list.className = 'connections-list';
        const emptySearch = document.createElement('div');
        emptySearch.className = 'connections-empty-result';
        emptySearch.textContent = '没有匹配的地点，换个关键词试试。';
        list.appendChild(emptySearch);
        return;
      }
      empty.classList.add('hidden');
      list.className = 'connections-list';
      for (const pkg of visiblePackages) {
        list.appendChild(this.renderCard(pkg));
      }
      if (this.focusedConnectionId) {
        const focused = list.querySelector('[data-connection-id="' + cssEscape(this.focusedConnectionId) + '"]');
        if (focused && typeof focused.scrollIntoView === 'function') {
          focused.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    },

    focusConnection(connectionId) {
      this.focusedConnectionId = String(connectionId || '').trim();
      this.render();
      if (!this.focusedConnectionId) return false;
      const card = document.querySelector('[data-connection-id="' + cssEscape(this.focusedConnectionId) + '"]');
      if (!card) {
        this.setInlineStatus('未找到地点：' + this.focusedConnectionId);
        return false;
      }
      this.setInlineStatus('已定位地点：' + this.focusedConnectionId);
      return true;
    },

    async reload(shell) {
      const gen = ++this._reloadGen;
      const activeShell = shell || this._shell;
      try {
        await this.refreshAdminState(activeShell);
        const [drafts, cloud] = await Promise.all([this.fetchDrafts(activeShell), this.fetchCloudPackages(activeShell)]);
        if (gen !== this._reloadGen) return;
        this.drafts = drafts;
        this.packages = this.mergePackages(drafts, cloud);
        this.listError = null;
        if (activeShell && typeof activeShell.publishWorkspaceConnectionDrafts === 'function') {
          void activeShell.publishWorkspaceConnectionDrafts(this.packages);
        }
      } catch (e) {
        if (gen !== this._reloadGen) return;
        this.drafts = [];
        this.packages = [];
        this.listError = e instanceof Error ? e.message : String(e);
        if (activeShell && typeof activeShell.publishWorkspaceConnectionDrafts === 'function') {
          void activeShell.publishWorkspaceConnectionDrafts([]);
        }
      }
      this.render();
    },

    setInlineStatus(message) {
      this.inlineStatus = String(message || '');
      const status = $('connectionsInlineStatus');
      if (status) status.textContent = this.inlineStatus;
    },

    async runConnectionAgentLoop(pkg) {
      const shell = this._shell;
      if (!shell || !pkg || !pkg.id) return;
      this.busyId = String(pkg.id || '');
      this.setInlineStatus(`正在打开管家输入框：${pkg.name || pkg.id}`);
      this.render();
      try {
        await this.openDshHandoff({
          domain: 'connection',
          capabilityPackageId: pkg.id,
          label: pkg.name || pkg.id,
          surface: 'connections',
          composerText: this.buildConnectionComposerMessage('continue', pkg),
        });
      } catch (e) {
        this.setInlineStatus('管家入口打开失败：' + (e instanceof Error ? e.message : String(e)));
      } finally {
        this.busyId = '';
        await this.reload(shell);
      }
    },

    async deleteDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      const ok = window.confirm(`删除“${pkg.name || pkg.id}”这个本地连接草稿？`);
      if (!ok) return;
      const r = await shell.api('DELETE', '/v1/capability-packages/drafts/' + encodeURIComponent(pkg.id), null);
      if (!r || !r.ok) {
        window.alert('删除失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      await this.reload(shell);
    },

    async createConnectionFromDroppedPath(rawPath) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      if (typeof shell.resolveDroppedConnectionPath !== 'function') {
        window.alert('当前版本还不支持拖拽创建连接。');
        return;
      }
      const resolved = await shell.resolveDroppedConnectionPath({ path: rawPath });
      if (!resolved || !resolved.ok) {
        window.alert('无法创建连接：' + ((resolved && (resolved.message || resolved.error)) || '请拖入软件快捷方式或 exe 文件'));
        return;
      }
      const name = String(resolved.name || '').trim() || String(resolved.exeName || '').replace(/\.exe$/i, '') || '本机软件';
      const hostId = String(resolved.hostId || '').trim();
      const id = normalizeCapabilityId(hostId || name);
      const localVersionId = normalizeLocalVersionId(
        ['drag_drop', resolved.versionHint || '', resolved.targetPath || '', resolved.shortcutPath || ''].filter(Boolean).join('|'),
      );
      const localVersion = {
        id: localVersionId,
        label: (resolved.versionHint ? name + ' ' + resolved.versionHint : name),
        softwareVersion: resolved.versionHint || '',
        executablePath: resolved.targetPath || '',
        shortcutPath: resolved.shortcutPath || '',
        installRoot: '',
        source: 'drag_drop',
        status: resolved.targetPath ? 'launchable' : 'detected',
      };
      const manifest = {
        droppedFrom: 'connection_page',
        inputPath: resolved.inputPath || rawPath,
        shortcutPath: resolved.shortcutPath || '',
        executablePath: resolved.targetPath || '',
        exeName: resolved.exeName || '',
        targetKind: resolved.targetKind || '',
        softwareVersion: resolved.versionHint || '',
        versionHint: resolved.versionHint || '',
        currentLocalVersionId: localVersionId,
        defaultLocalVersionId: localVersionId,
        localVersions: [localVersion],
        ...(hostId ? { hostId } : {}),
      };
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/drafts',
        {
          id,
          type: 'software_connection',
          name,
          appName: name,
          description: `从拖入的${resolved.shortcutPath ? '快捷方式' : '可执行文件'}创建的本机软件连接草稿。`,
          tags: ['本机软件', '拖拽创建'],
          templateHint: hostId ? 'shortcut_known_host' : 'shortcut_unknown_host',
          manifest,
          createdBy: 'drag-drop',
        },
        { timeoutMs: 30000 },
      );
      if (!r || !r.ok || !r.json || !r.json.ok) {
        window.alert('创建连接失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      await this.reload(shell);
      const draft = r.json.draft || { id, name, type: 'software_connection', manifest };
      window.alert('已创建连接草稿：' + (draft.name || name));
      void this.openCapabilityConversation(draft);
    },

    async mergeLocalVersionFromDroppedPath(pkg, rawPath) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      if (typeof shell.resolveDroppedConnectionPath !== 'function') {
        window.alert('当前版本还不支持拖拽添加版本。');
        return;
      }
      const resolved = await shell.resolveDroppedConnectionPath({ path: rawPath });
      if (!resolved || !resolved.ok) {
        window.alert('无法识别版本：' + ((resolved && (resolved.message || resolved.error)) || '请拖入软件快捷方式或 exe 文件'));
        return;
      }
      const name = String(pkg.name || resolved.name || '').trim() || '本机软件';
      const localVersionId = normalizeLocalVersionId(
        ['drag_drop', resolved.versionHint || '', resolved.targetPath || '', resolved.shortcutPath || ''].filter(Boolean).join('|'),
      );
      const localVersion = {
        id: localVersionId,
        label: resolved.versionHint ? name + ' ' + resolved.versionHint : name,
        softwareVersion: resolved.versionHint || '',
        executablePath: resolved.targetPath || '',
        shortcutPath: resolved.shortcutPath || '',
        installRoot: '',
        source: 'drag_drop',
        status: resolved.targetPath ? 'launchable' : 'detected',
      };
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/drafts/' + encodeURIComponent(pkg.id) + '/merge-local-version',
        { localVersion, makeCurrent: true, makeDefault: false },
        { timeoutMs: 30000 },
      );
      if (!r || !r.ok || !r.json || !r.json.ok) {
        window.alert('添加版本失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      await this.reload(shell);
      this.setInlineStatus('已添加本机版本：' + (localVersion.softwareVersion || localVersion.label));
    },

    async handleDroppedConnectionFiles(files, targetPkg) {
      const shell = this._shell;
      if (!shell) return;
      const paths =
        typeof shell.droppedFilePaths === 'function'
          ? shell.droppedFilePaths(files)
          : Array.from(files || []).map((file) => file && file.path).filter(Boolean);
      const first = Array.isArray(paths) ? paths.find(Boolean) : '';
      if (!first) {
        window.alert('没有读取到拖入文件路径。');
        return;
      }
      if (targetPkg && targetPkg.id) {
        await this.mergeLocalVersionFromDroppedPath(targetPkg, first);
        return;
      }
      await this.createConnectionFromDroppedPath(first);
    },

    bindDropCreate(shell) {
      if (this._dropBound) return;
      const target = $('view-connections');
      if (!target) return;
      this._dropBound = true;
      const setActive = (active) => {
        target.classList.toggle('connection-drop-active', active);
      };
      target.addEventListener('dragenter', (ev) => {
        this._dropDepth += 1;
        ev.preventDefault();
        setActive(true);
      });
      target.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      });
      target.addEventListener('dragleave', () => {
        this._dropDepth = Math.max(0, this._dropDepth - 1);
        if (this._dropDepth === 0) setActive(false);
      });
      target.addEventListener('drop', (ev) => {
        ev.preventDefault();
        this._dropDepth = 0;
        setActive(false);
        const files = ev.dataTransfer && ev.dataTransfer.files;
        if (!files || !files.length) return;
        void this.handleDroppedConnectionFiles(files);
      });
    },

    async runLifecycleAction(pkg, action, extraBody) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, actionLabel(action), '处理中...', true);
      this.setInlineStatus(`${actionLabel(action)}“${pkg.name || pkg.id}”中...`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/lifecycle',
        { action, ...(extraBody && typeof extraBody === 'object' ? extraBody : {}) },
        { timeoutMs: 60000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage(action, body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, actionLabel(action), message || '执行失败', false);
        this.setInlineStatus(`${actionLabel(action)}未完成，可交给管家继续处理。`);
        this.busyId = '';
        await this.reload(shell);
        void this.openCapabilityConversation(pkg);
        return;
      }
      this.setCardResult(pkg, actionLabel(action), message || '执行完成', true);
      this.setInlineStatus(`${actionLabel(action)}已完成。`);
      this.busyId = '';
      await this.reload(shell);
    },

    async setLocalVersion(pkg, localVersionId) {
      const shell = this._shell;
      const id = String(pkg && pkg.id ? pkg.id : '');
      const versionId = String(localVersionId || '').trim();
      if (!id || !versionId) return;
      this.selectedLocalVersionIds = { ...this.selectedLocalVersionIds, [id]: versionId };
      this.setCardResult(pkg, '本机版本', '已设为当前启动版本。', true);
      this.render();
      if (!shell || typeof shell.api !== 'function') return;
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/drafts/' + encodeURIComponent(id) + '/local-version',
        { localVersionId: versionId, makeDefault: true },
      );
      if (!r || !r.ok) {
        this.setCardResult(pkg, '本机版本', ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '保存失败'), false);
        this.setInlineStatus('本机版本保存失败，可继续使用当前页面选择。');
        this.render();
        return;
      }
      this.setInlineStatus('已保存当前本机版本。');
      await this.reload(shell);
    },

    async discoverRunningConnections() {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      const candidates = this.packages.filter((pkg) => {
        const state = connectionStateFor(pkg);
        return asArray(state && state.availableActions).includes('discover_running');
      });
      if (!candidates.length) {
        this.setInlineStatus('暂无可识别的连接对象。');
        return;
      }
      this.setInlineStatus('正在识别本机已打开软件...');
      let okCount = 0;
      let failCount = 0;
      for (const pkg of candidates) {
        const r = await shell.api(
          'POST',
          '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/lifecycle',
          { action: 'discover_running' },
          { timeoutMs: 60000 },
        );
        const body = (r && r.json) || {};
        const message = this.lifecycleMessage('discover_running', body, r && r.text);
        if (r && r.ok) {
          okCount += 1;
          this.setCardResult(pkg, '识别运行', message || '已识别', true);
        } else {
          failCount += 1;
          this.setCardResult(pkg, '识别运行', message || '未识别到运行中软件', false);
        }
      }
      this.setInlineStatus(`识别完成：${okCount} 个成功，${failCount} 个待处理。`);
      await this.reload(shell);
    },

    async installDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      let targetDir = '';
      if (typeof shell.pickPath === 'function') {
        const picked = await shell.pickPath({ pick: 'folder', title: `选择 ${pkg.name || pkg.id} 脚本目录或安装目录` });
        if (!picked || picked.canceled) return;
        if (!picked.ok || !picked.path) {
          window.alert('没有选择安装位置');
          return;
        }
        targetDir = String(picked.path || '').trim();
      }
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, '安装桥接', '安装中...', true);
      this.setInlineStatus(`正在安装“${pkg.name || pkg.id}”的连接脚本。`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/install',
        targetDir ? { targetDir } : {},
        { timeoutMs: 60000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage('install', body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, '安装桥接', message || '安装失败', false);
        this.setInlineStatus('安装未完成，可交给管家读取失败证据继续处理。');
        this.busyId = '';
        await this.reload(shell);
        void this.openCapabilityConversation(pkg);
        return;
      }
      this.setCardResult(pkg, '安装桥接', message || '安装完成，仍需真实探测。', true);
      this.setInlineStatus('安装完成，下一步需要打开目标软件并探测真实信号。');
      this.busyId = '';
      await this.reload(shell);
      void this.openCapabilityConversation(pkg);
    },

    async probeDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, '探测', '探测真实连接信号中...', true);
      this.setInlineStatus(`正在探测“${pkg.name || pkg.id}”的真实连接信号。`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/probe',
        {},
        { timeoutMs: 30000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage('probe', body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, '探测', message || '未收到真实连接信号', false);
        this.setInlineStatus('探测未收到真实信号，可交给管家继续修复。');
        this.busyId = '';
        await this.reload(shell);
        return;
      }
      this.setCardResult(pkg, '探测', message || '已收到真实连接信号', true);
      this.setInlineStatus('探测成功，连接已收到真实信号。');
      this.busyId = '';
      await this.reload(shell);
    },

    async uninstallDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      const ok = window.confirm(`卸载“${pkg.name || pkg.id}”已记录的连接脚本？`);
      if (!ok) return;
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, '卸载', '卸载中...', true);
      this.setInlineStatus(`正在卸载“${pkg.name || pkg.id}”的连接脚本。`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/uninstall',
        {},
        { timeoutMs: 60000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage('uninstall', body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, '卸载', message || '卸载失败', false);
        this.setInlineStatus('卸载未完成，可继续对话处理。');
        this.busyId = '';
        await this.reload(shell);
        return;
      }
      this.setCardResult(pkg, '卸载', message || '卸载完成', true);
      this.setInlineStatus('卸载完成。');
      this.busyId = '';
      await this.reload(shell);
    },

    async exportCapabilityTransfer(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      if (typeof shell.saveTextFile !== 'function') {
        window.alert('当前壳版本缺少保存文件能力，请重启或更新本地伴侣。');
        return;
      }
      const r = await shell.api('GET', '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/export', null, {
        timeoutMs: 30000,
      });
      if (!r || !r.ok || !r.json || !r.json.ok) {
        window.alert('导出失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      const saved = await shell.saveTextFile({
        title: '导出连接能力包',
        defaultPath: normalizeCapabilityId(pkg.id || pkg.name) + '.assetcutter-capability.json',
        text: JSON.stringify(r.json.bundle, null, 2),
      });
      if (!saved || saved.canceled) return;
      if (!saved.ok) {
        window.alert('保存失败：' + (saved.error || '未知错误'));
        return;
      }
      window.alert('已导出：' + saved.path);
    },

    async importCapabilityTransfer() {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      if (typeof shell.pickPath !== 'function' || typeof shell.readTextFile !== 'function') {
        window.alert('当前壳版本缺少导入能力，请重启或更新本地伴侣。');
        return;
      }
      const picked = await shell.pickPath({ pick: 'file', title: '选择能力包 JSON' });
      const filePath = picked && picked.ok && picked.path ? picked.path : '';
      if (!filePath || picked.canceled) return;
      const read = await shell.readTextFile({ path: filePath });
      if (!read || !read.ok) {
        window.alert('读取失败：' + ((read && read.error) || '未知错误'));
        return;
      }
      let bundle = null;
      try {
        bundle = JSON.parse(String(read.text || ''));
      } catch {
        window.alert('导入失败：不是有效的 JSON 文件。');
        return;
      }
      const r = await shell.api('POST', '/v1/capability-packages/import', { bundle }, { timeoutMs: 30000 });
      if (!r || !r.ok || !r.json || !r.json.ok) {
        window.alert('导入失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      await this.reload(shell);
      const draft = r.json.draft || {};
      window.alert('已导入连接草稿：' + (draft.name || draft.id || '能力包'));
      if (draft && draft.id) void this.openCapabilityConversation(draft);
    },

    async publishToCloud(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      if (!this.isAdmin) {
        window.alert('当前账号不是管理员。');
        return;
      }
      const note = window.prompt('填写本次云端版本说明', '');
      if (note == null) return;
      if (!String(note).trim()) {
        window.alert('版本说明不能为空。');
        return;
      }
      const semver = window.prompt('填写版本号', pkg.version || pkg.cloudVersion || '1.0.0');
      if (semver == null) return;
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/cloud-versions',
        {
          semver: String(semver || '').trim(),
          versionNote: String(note || '').trim(),
          isAdmin: true,
          actorRole: 'admin',
        },
        { timeoutMs: 60000 },
      );
      if (!r || !r.ok) {
        const body = (r && r.json) || {};
        const missing = Array.isArray(body.missingGates) ? body.missingGates.join(', ') : '';
        window.alert('提交失败：' + (body.message || body.error || (r && r.text) || missing || '未知错误'));
        return;
      }
      const version = r.json && r.json.version;
      window.alert('已提交云端' + (version && version.semver ? '：v' + version.semver : '。'));
      await this.reload(shell);
    },

    async chooseCloudVersion(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      if (!this.isAdmin) {
        window.alert('当前账号不是管理员。');
        return;
      }
      const versions = Array.isArray(pkg.cloudVersions) ? pkg.cloudVersions : [];
      if (!versions.length) {
        window.alert('还没有云端版本。');
        return;
      }
      const picker = window.ShellCapabilityVersionPicker;
      const version =
        picker && typeof picker.pick === 'function'
          ? await picker.pick(pkg, versions, { title: '选择云端版本 - ' + (pkg.name || pkg.id || '') })
          : versions[0];
      if (!version || !version.id) {
        window.alert('没有选择有效版本。');
        return;
      }
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/cloud-versions/' + encodeURIComponent(version.id) + '/activate',
        { isAdmin: true, actorRole: 'admin' },
        { timeoutMs: 30000 },
      );
      if (!r || !r.ok) {
        const body = (r && r.json) || {};
        window.alert('切换失败：' + (body.message || body.error || (r && r.text) || '未知错误'));
        return;
      }
      window.alert('已切换到云端版本 v' + (version.semver || ''));
      await this.reload(shell);
    },

    bind(shell) {
      this._shell = shell;
      this.bindDropCreate(shell);
      const openCreate = () => this.openCreateConnectionCopilot();
      $('btnConnectionCreateWithCopilot')?.addEventListener('click', openCreate);
      $('btnConnectionCreateWithCopilotEmpty')?.addEventListener('click', openCreate);
      $('btnConnectionImportTransfer')?.addEventListener('click', () => {
        $('connectionsPageMenu')?.removeAttribute('open');
        void this.importCapabilityTransfer();
      });
      $('btnConnectionsDiscoverRunning')?.addEventListener('click', () => {
        $('connectionsPageMenu')?.removeAttribute('open');
        void this.discoverRunningConnections();
      });
      $('connectionsSearch')?.addEventListener('input', (ev) => {
        this.searchQuery = String((ev && ev.target && ev.target.value) || '');
        this.render();
      });
      window.addEventListener('assetcutter:capability-created', (ev) => {
        const detail = ev && ev.detail && typeof ev.detail === 'object' ? ev.detail : {};
        if (detail.type !== 'software_connection') return;
        void this.reload(this._shell || shell);
      });
    },

    async onViewShown(shell) {
      this._shell = shell;
      await this.reload(shell);
      this.maybePromptHealthCheck();
    },
  };
})();

