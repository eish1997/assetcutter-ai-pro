/**
 * Shared UI facts for CapabilityPackage cards.
 * Keep this file data-only: pages decide their own markup and handlers.
 */
(function () {
  'use strict';

  function asList(value) {
    return Array.isArray(value) ? value : [];
  }

  function cloudVersionLabel(pkg) {
    const version = String((pkg && (pkg.cloudVersion || pkg.semverCloud || pkg.version)) || '').trim();
    return version ? '云端 v' + version : '云端';
  }

  function canPublish(pkg, opts) {
    const isAdmin = Boolean(opts && opts.isAdmin);
    if (!isAdmin || !pkg) return false;
    const type = String(pkg.type || '').trim();
    if (type === 'software_connection') {
      const connectionState = pkg.connectionState && typeof pkg.connectionState === 'object' ? pkg.connectionState : null;
      if (connectionState && connectionState.publishEligible !== true) return false;
      return Boolean(
        pkg.source === 'draft' &&
          pkg.governance &&
          pkg.governance.cloudVersioned === true &&
          (pkg.hasCloudMismatch || !pkg.hasCloud),
      );
    }
    if (type === 'tool') {
      const origin = String(pkg.origin || '').trim();
      const isMine = origin === 'authored' || origin === 'import';
      return Boolean(isMine && (!pkg.hasCloud || pkg.hasCloudVersionMismatch || pkg.reviewStatus !== 'approved'));
    }
    if (type === 'workflow') {
      return Boolean(
        pkg.source === 'draft' &&
          pkg.governance &&
          pkg.governance.cloudVersioned === true &&
          (pkg.hasCloudMismatch || !pkg.hasCloud),
      );
    }
    return false;
  }

  function canSwitchVersion(pkg, opts) {
    return Boolean(opts && opts.isAdmin && asList(pkg && pkg.cloudVersions).length > 0);
  }

  function tags(pkg, extra) {
    const out = [];
    const push = (label) => {
      const text = String(label || '').trim();
      if (text && !out.includes(text)) out.push(text);
    };
    push(pkg && pkg.type);
    if (pkg && pkg.hasCloud) push(cloudVersionLabel(pkg));
    const connectionState = pkg && pkg.connectionState && typeof pkg.connectionState === 'object' ? pkg.connectionState : null;
    if (connectionState) push(connectionState.label || connectionState.maturity);
    if (extra && extra.templateHint) push(extra.templateHint);
    for (const tag of asList(pkg && pkg.tags)) push(tag);
    return out;
  }

  function actions(pkg, opts) {
    const type = String(pkg && pkg.type ? pkg.type : '').trim();
    const connectionState = pkg && pkg.connectionState && typeof pkg.connectionState === 'object' ? pkg.connectionState : null;
    const base =
      type === 'software_connection'
        ? asList(connectionState && connectionState.availableActions).length
          ? asList(connectionState.availableActions)
          : ['agent_loop', 'conversation', 'discover_running', 'launch', 'install', 'probe', 'close', 'uninstall', 'export']
        : type === 'tool'
          ? ['open', 'export']
          : type === 'workflow'
            ? ['conversation', 'validate', 'run', 'export']
            : ['conversation'];
    const list = base.slice();
    if (canSwitchVersion(pkg, opts)) list.push('version');
    if (canPublish(pkg, opts)) list.push('publish');
    if (type === 'software_connection' && pkg && pkg.source === 'draft') list.push('delete');
    if (type === 'workflow' && pkg && pkg.source === 'draft') list.push('delete');
    return list;
  }

  function displayVersion(pkg) {
    const local = String((pkg && pkg.semverLocal) || '').trim();
    const cloud = String((pkg && pkg.semverCloud) || '').trim();
    const display = String((pkg && (pkg.displaySemver || pkg.version || pkg.semver)) || '').trim();
    if (pkg && pkg.needsUpgrade && local && cloud) return 'v' + local + ' -> v' + cloud;
    return display ? 'v' + display : '';
  }

  function status(pkg) {
    const type = String(pkg && pkg.type ? pkg.type : '').trim();
    if (type === 'software_connection') {
      const connectionState = pkg && pkg.connectionState && typeof pkg.connectionState === 'object' ? pkg.connectionState : null;
      if (connectionState && (connectionState.label || connectionState.maturity)) {
        return String(connectionState.label || connectionState.maturity);
      }
      const lastProbe = pkg && pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      if (lastProbe && lastProbe.ok) return '已连接';
      return String((pkg && (pkg.draftStatus || pkg.source)) || '草稿');
    }
    if (type === 'tool') {
      if (pkg && pkg.hasLocal && pkg.hasCloud) return '本地 + 云端';
      if (pkg && pkg.hasLocal) return '本地';
      if (pkg && pkg.hasCloud) return '云端';
      return '工具';
    }
    return String((pkg && (pkg.source || pkg.type)) || '能力包');
  }

  function description(pkg, extra) {
    const own = String((pkg && pkg.description) || '').trim();
    if (own) return own;
    if (extra && extra.fallbackDescription) return String(extra.fallbackDescription);
    const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
    if (String(pkg && pkg.type) === 'software_connection') {
      return String(manifest.appName || (pkg && pkg.name) || '本机软件') + ' 连接草稿';
    }
    if (String(pkg && pkg.type) === 'tool') return '本机工具能力包';
    return '能力包';
  }

  function view(pkg, opts) {
    const extra = opts || {};
    const type = String(pkg && pkg.type ? pkg.type : '').trim();
    const title = String((pkg && (pkg.name || pkg.id)) || (type === 'software_connection' ? '未命名连接' : '未命名能力包'));
    const subtitle =
      type === 'tool'
        ? [pkg && pkg.id, displayVersion(pkg)].filter(Boolean).join(' · ')
        : String((pkg && pkg.id) || '');
    return {
      title,
      subtitle,
      description: description(pkg, extra),
      status: status(pkg),
      tags: tags(pkg, extra),
      actions: actions(pkg, extra),
    };
  }

  function versionOptions(pkg) {
    return asList(pkg && pkg.cloudVersions)
      .map((item, index) => {
        const semver = String((item && item.semver) || '').trim();
        const note = String((item && item.note) || '').trim();
        const publishedAt = String((item && item.publishedAt) || '').trim();
        const dateLabel = publishedAt ? publishedAt.slice(0, 10) : 'cloud version';
        const current = Boolean(
          item &&
            (item.active ||
              (semver && semver === String((pkg && (pkg.semverLocal || pkg.cloudVersion || pkg.version)) || '').trim())),
        );
        const label =
          String(index + 1) +
          '. v' +
          (semver || '-') +
          (current ? ' (current)' : '') +
          (note ? ' - ' + note : '');
        return {
          index,
          id: String((item && item.id) || '').trim(),
          semver,
          note,
          publishedAt,
          dateLabel,
          current,
          label,
          raw: item,
        };
      })
      .filter((item) => item.id);
  }

  window.ShellCapabilityCardSchema = {
    canPublish,
    canSwitchVersion,
    cloudVersionLabel,
    tags,
    actions,
    view,
    versionOptions,
  };
})();
