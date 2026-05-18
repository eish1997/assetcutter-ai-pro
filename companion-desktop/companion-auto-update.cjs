'use strict';

const fs = require('fs');
const path = require('path');

/** @typedef {'idle'|'checking'|'downloading'|'ready'|'error'} UpdaterPhase */

/**
 * @param {{
 *   app: import('electron').App;
 *   dialog: import('electron').Dialog;
 *   readShellSettings: () => { siteUrl: string; authApiOrigin?: string; volumeRoot: string };
 *   rebuildTrayMenu: () => void;
 *   updateTrayTooltip: () => void;
 *   setCompanionStatusNote: (note: string) => void;
 *   displayTrayBalloon: (opts: { title: string; content: string; iconType?: string }) => void;
 *   onUpdaterUiChange?: (state: { phase: string; version: string | null; percent: number }) => void;
 * }} deps
 */
function createCompanionAutoUpdate(deps) {
  const {
    app,
    dialog,
    readShellSettings,
    rebuildTrayMenu,
    updateTrayTooltip,
    setCompanionStatusNote,
    displayTrayBalloon,
    onUpdaterUiChange,
  } = deps;

  /** @type {import('electron-updater').AppUpdater | null} */
  let autoUpdater = null;
  let configured = false;
  /** @type {UpdaterPhase} */
  let phase = 'idle';
  /** @type {string | null} */
  let pendingVersion = null;
  /** @type {number} */
  let downloadPercent = 0;
  /** @type {NodeJS.Timeout | null} */
  let periodicTimer = null;
  let manualCheckPending = false;
  let lastFeedUrl = '';
  /** @type {boolean} */
  let usesLocalDevUpdateYaml = false;

  function feedOriginFromFeedUrl(feed) {
    try {
      return new URL(String(feed || '')).origin;
    } catch {
      return '';
    }
  }

  function legacyElectronUpdateYamlUrl(origin) {
    const base = String(origin || '')
      .trim()
      .replace(/\/+$/, '');
    if (!base) return '';
    const plat = companionPlatformForFeed();
    const qs = new URLSearchParams({
      kind: 'desktop_shell',
      platform: plat,
      channel: 'stable',
    });
    return `${base}/api/companion-artifacts/electron-app-update.yml?${qs.toString()}`;
  }

  function yamlBodyLooksValid(text) {
    const t = String(text || '');
    if (!/^\s*version\s*:/m.test(t)) return false;
    if (/^\s*#\s*error:/m.test(t)) return false;
    return /^\s*files\s*:/m.test(t);
  }

  async function probeFeedLatestYml(feedBase) {
    const url = `${String(feedBase || '').replace(/\/+$/, '')}/latest.yml`;
    try {
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'text/yaml,*/*' } });
      const text = await res.text();
      const ok = res.ok && yamlBodyLooksValid(text);
      return { ok, status: res.status, url };
    } catch (e) {
      return { ok: false, status: 0, url, error: e };
    }
  }

  async function bootstrapLocalUpdateYamlFromOrigin(origin) {
    const yamlUrl = legacyElectronUpdateYamlUrl(origin);
    if (!yamlUrl) return null;
    try {
      const res = await fetch(yamlUrl, { method: 'GET', headers: { Accept: 'text/yaml,*/*' } });
      if (!res.ok) {
        console.warn('[companion-desktop][updater] legacy yaml HTTP', res.status, yamlUrl);
        return null;
      }
      const text = await res.text();
      if (!yamlBodyLooksValid(text)) {
        console.warn('[companion-desktop][updater] legacy yaml 无效:', yamlUrl);
        return null;
      }
      const devPath = path.join(app.getPath('userData'), 'dev-app-update.yml');
      fs.writeFileSync(devPath, text, 'utf8');
      console.log('[companion-desktop][updater] 已写入本地更新清单 →', devPath);
      return devPath;
    } catch (e) {
      console.warn('[companion-desktop][updater] legacy yaml 拉取失败', e);
      return null;
    }
  }

  function isUpdaterHttp404(err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    return msg.includes('404') || msg.includes('Not Found');
  }

  function formatUpdaterErrorForUser(err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    if (!isUpdaterHttp404(err)) return msg;
    return (
      `${msg}\n\n` +
      '常见原因：线上 auth-api 尚未部署新版路由\n' +
      '  /api/companion-artifacts/electron-updater/{platform}/{channel}/latest.yml\n\n' +
      '处理：将含该路由的 server 代码部署到 Render 后重试；\n' +
      '开发壳会在检测到 404 时自动改用旧版 electron-app-update.yml（需重启伴侣）。'
    );
  }

  function companionPlatformForFeed() {
    if (process.platform === 'win32') return 'win32';
    if (process.platform === 'darwin') return 'darwin';
    return 'linux';
  }

  /** generic 源会请求 `{feed}/latest.yml`，须为目录前缀而非 .yml 文件路径 */
  function electronUpdateFeedPath() {
    const plat = companionPlatformForFeed();
    const channel = 'stable';
    return `/api/companion-artifacts/electron-updater/${encodeURIComponent(plat)}/${encodeURIComponent(channel)}`;
  }

  function readBakedAuthApiOrigin() {
    try {
      const p = path.join(__dirname, 'build-constants.json');
      if (!fs.existsSync(p)) return '';
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return String(j.defaultAuthApiOrigin || '').trim().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  function feedUrlFromOrigin(origin) {
    const base = String(origin || '')
      .trim()
      .replace(/\/+$/, '');
    if (!base) return '';
    try {
      return `${new URL(base).origin}${electronUpdateFeedPath()}`;
    } catch {
      return '';
    }
  }

  function resolveUpdateFeedUrl() {
    const explicit = process.env.COMPANION_UPDATE_FEED_URL?.trim();
    if (explicit) return explicit;

    const fromEnvOrigin = feedUrlFromOrigin(process.env.COMPANION_AUTH_API_ORIGIN);
    if (fromEnvOrigin) return fromEnvOrigin;

    const baked = feedUrlFromOrigin(readBakedAuthApiOrigin());
    if (baked) return baked;

    const settings = readShellSettings();
    const settingsOrigin = String(settings.authApiOrigin || settings.siteUrl || '').trim();
    return feedUrlFromOrigin(settingsOrigin);
  }

  function shouldEnable() {
    if (process.env.COMPANION_DISABLE_AUTO_UPDATE === '1') return false;
    const feed = resolveUpdateFeedUrl();
    if (!feed) return false;
    if (app.isPackaged) return true;
    if (process.env.COMPANION_UPDATE_FEED_URL?.trim()) return true;
    if (process.env.COMPANION_ENABLE_UPDATE_IN_DEV === '1') return true;
    return false;
  }

  function getTrayUpdateLabels() {
    if (phase === 'checking') return { status: '正在检查软件更新…', check: '检查更新…', install: null };
    if (phase === 'downloading') {
      const pct = Number.isFinite(downloadPercent) ? Math.round(downloadPercent) : 0;
      return {
        status: pendingVersion ? `正在下载 v${pendingVersion}（${pct}%）` : `正在下载更新（${pct}%）`,
        check: '检查更新…',
        install: null,
      };
    }
    if (phase === 'ready') {
      return {
        status: pendingVersion ? `更新 v${pendingVersion} 已就绪，可安装` : '更新已就绪，可安装',
        check: '检查更新…',
        install: pendingVersion ? `安装更新 v${pendingVersion} 并重启` : '安装更新并重启',
      };
    }
    return { status: null, check: '检查更新…', install: null };
  }

  function applyTrayRefresh() {
    updateTrayTooltip();
    rebuildTrayMenu();
  }

  function getUpdaterUiState() {
    return {
      phase,
      version: pendingVersion,
      percent: Number.isFinite(downloadPercent) ? downloadPercent : 0,
    };
  }

  function notifyUiChange() {
    if (typeof onUpdaterUiChange === 'function') {
      try {
        onUpdaterUiChange(getUpdaterUiState());
      } catch (e) {
        console.error('[companion-desktop][updater] ui', e);
      }
    }
  }

  function setPhase(next, version) {
    phase = next;
    if (version !== undefined) pendingVersion = version;
    applyTrayRefresh();
    notifyUiChange();
  }

  async function checkNow(manual = false) {
    if (!autoUpdater) {
      if (manual) {
        void dialog.showMessageBox({
          type: 'info',
          title: '软件更新',
          message: '未配置更新源',
          detail:
            '请设置 COMPANION_UPDATE_FEED_URL，或在打包时配置 COMPANION_BUILD_AUTH_API_ORIGIN；开发环境可设 COMPANION_ENABLE_UPDATE_IN_DEV=1。',
        });
      }
      return;
    }
    manualCheckPending = manual;
    setPhase('checking');
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      setPhase('error');
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[companion-desktop][updater] check', e);
      if (manual) {
        void dialog.showErrorBox('检查更新失败', formatUpdaterErrorForUser(e));
      }
      setPhase('idle');
    }
  }

  function installReadyUpdate() {
    if (!autoUpdater || phase !== 'ready') return;
    autoUpdater.quitAndInstall(false, true);
  }

  async function setup() {
    if (configured || !shouldEnable()) return false;
    const feed = resolveUpdateFeedUrl();
    if (!feed) return false;

    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (e) {
      console.error('[companion-desktop] electron-updater 未安装:', e.message);
      return false;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    const devUpdateMode =
      !app.isPackaged && process.env.COMPANION_ENABLE_UPDATE_IN_DEV === '1';
    const latestProbe = await probeFeedLatestYml(feed);
    let localYamlPath = null;

    if (!latestProbe.ok) {
      console.warn(
        '[companion-desktop][updater] latest.yml 不可用',
        latestProbe.status || latestProbe.error || '',
        latestProbe.url || feed,
      );
      if (devUpdateMode) {
        localYamlPath = await bootstrapLocalUpdateYamlFromOrigin(feedOriginFromFeedUrl(feed));
      }
    }

    configured = true;
    lastFeedUrl = feed;
    usesLocalDevUpdateYaml = Boolean(localYamlPath);

    if (localYamlPath) {
      autoUpdater.updateConfigPath = localYamlPath;
      if (devUpdateMode) autoUpdater.forceDevUpdateConfig = true;
    } else {
      if (devUpdateMode) autoUpdater.forceDevUpdateConfig = true;
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    }

    autoUpdater.on('checking-for-update', () => {
      setPhase('checking');
    });

    autoUpdater.on('update-not-available', () => {
      setPhase('idle');
      setCompanionStatusNote('伴侣运行中');
      if (manualCheckPending) {
        displayTrayBalloon({ title: '软件更新', content: '当前已是最新版本。' });
      }
      manualCheckPending = false;
    });

    autoUpdater.on('update-available', (info) => {
      const ver = info && typeof info.version === 'string' ? info.version : null;
      pendingVersion = ver;
      setPhase('downloading', ver);
      setCompanionStatusNote(ver ? `正在后台下载 v${ver}…` : '正在后台下载更新…');
      displayTrayBalloon({
        title: '发现新版本',
        content: ver
          ? `正在后台下载 v${ver}，完成后将通知您安装。`
          : '正在后台下载更新，完成后将通知您安装。',
      });
      manualCheckPending = false;
    });

    autoUpdater.on('download-progress', (p) => {
      const pct = p && typeof p.percent === 'number' ? p.percent : 0;
      downloadPercent = pct;
      if (phase !== 'ready') {
        phase = 'downloading';
        const rounded = Math.round(pct);
        setCompanionStatusNote(
          pendingVersion
            ? `正在下载 v${pendingVersion}（${rounded}%）`
            : `正在下载更新（${rounded}%）`,
        );
        applyTrayRefresh();
        notifyUiChange();
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      const ver = info && typeof info.version === 'string' ? info.version : pendingVersion;
      pendingVersion = ver;
      downloadPercent = 100;
      setPhase('ready', ver);
      setCompanionStatusNote(ver ? `更新 v${ver} 已就绪` : '更新已就绪');
      displayTrayBalloon({
        title: '更新已就绪',
        content: ver
          ? `v${ver} 已下载完成。请从托盘选择「安装更新并重启」，或退出应用时自动安装。`
          : '更新已下载完成。请从托盘安装，或退出应用时自动安装。',
      });
    });

    autoUpdater.on('error', async (err) => {
      console.error('[companion-desktop][updater]', err);
      if (
        !usesLocalDevUpdateYaml &&
        isUpdaterHttp404(err) &&
        !app.isPackaged &&
        process.env.COMPANION_ENABLE_UPDATE_IN_DEV === '1'
      ) {
        const localYamlPath = await bootstrapLocalUpdateYamlFromOrigin(
          feedOriginFromFeedUrl(lastFeedUrl || feed),
        );
        if (localYamlPath && autoUpdater) {
          usesLocalDevUpdateYaml = true;
          autoUpdater.updateConfigPath = localYamlPath;
          autoUpdater.forceDevUpdateConfig = true;
          if (manualCheckPending) {
            try {
              await autoUpdater.checkForUpdates();
              return;
            } catch (retryErr) {
              console.error('[companion-desktop][updater] retry after bootstrap', retryErr);
            }
          }
        }
      }
      setPhase('idle');
      setCompanionStatusNote('伴侣运行中');
      if (manualCheckPending) {
        void dialog.showErrorBox('更新失败', formatUpdaterErrorForUser(err));
      } else if (pendingVersion) {
        displayTrayBalloon({
          title: '更新下载未完成',
          content: `v${pendingVersion} 后台下载失败，可稍后在托盘选择「检查更新…」重试。`,
        });
      }
      manualCheckPending = false;
    });

    setTimeout(() => {
      void checkNow(false);
    }, 20000);

    if (periodicTimer) clearInterval(periodicTimer);
    periodicTimer = setInterval(
      () => {
        void checkNow(false);
      },
      4 * 60 * 60 * 1000,
    );

    return true;
  }

  function dispose() {
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
  }

  return {
    setup,
    checkNow,
    installReadyUpdate,
    resolveUpdateFeedUrl,
    shouldEnable,
    isConfigured: () => configured,
    usesFullAutoUpdater: () => configured,
    getTrayUpdateLabels,
    getUpdaterUiState,
    dispose,
  };
}

module.exports = { createCompanionAutoUpdate };
