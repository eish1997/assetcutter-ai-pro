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

  function updaterLogPath() {
    return path.join(app.getPath('userData'), 'updater.log');
  }

  function logUpdater(level, message, detail) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}${detail ? ` ${detail}` : ''}\n`;
    try {
      fs.appendFileSync(updaterLogPath(), line, 'utf8');
    } catch {
      /* ignore */
    }
    const fn = level === 'error' ? console.error : console.warn;
    fn(`[companion-desktop][updater] ${message}`, detail || '');
  }

  function feedOriginFromFeedUrl(feed) {
    try {
      return new URL(String(feed || '')).origin;
    } catch {
      return '';
    }
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

  function isUpdaterHttp404(err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    return msg.includes('404') || msg.includes('Not Found');
  }

  function formatUpdaterErrorForUser(err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    if (msg.includes('checksum') || msg.includes('sha512') || msg.includes('SHA512')) {
      return `${msg}\n\n校验失败：请确认管理后台登记的安装包与 semver 一致，且 sha512 对应完整 exe。`;
    }
    if (msg.includes('blockmap') || msg.includes('differential')) {
      return `${msg}\n\n差分更新失败：请上传与 exe 同名的 .blockmap（R2 键为「exe键.blockmap」），或等待新版本壳默认走全量下载。`;
    }
    if (!isUpdaterHttp404(err)) return msg;
    return (
      `${msg}\n\n` +
      '常见原因：线上 auth-api 尚未部署新版路由\n' +
      '  /api/companion-artifacts/electron-updater/{platform}/{channel}/latest.yml\n\n' +
      '处理：将含该路由的 server 代码部署到 Render 后重试。'
    );
  }

  async function probePublicBlockMapForInstallerUrl(installerUrl) {
    const base = String(installerUrl || '').trim();
    if (!base) return false;
    const mapUrl = `${base}.blockmap`;
    try {
      const res = await fetch(mapUrl, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function configureDifferentialDownloadFromFeed(feed) {
    if (!autoUpdater) return;
    autoUpdater.disableDifferentialDownload = true;
    try {
      const res = await fetch(`${String(feed).replace(/\/+$/, '')}/latest.yml`);
      if (!res.ok) return;
      const text = await res.text();
      const m = text.match(/^\s*-\s*url:\s*["']?([^"'\n]+)["']?/m);
      if (!m || !m[1]) return;
      const hasMap = await probePublicBlockMapForInstallerUrl(m[1].trim());
      if (hasMap) {
        autoUpdater.disableDifferentialDownload = false;
        logUpdater('info', '差分更新已启用（已找到 .blockmap）');
      } else {
        logUpdater('info', '使用全量下载（未找到公网 .blockmap）', m[1].trim());
      }
    } catch (e) {
      logUpdater('warn', '探测 blockmap 失败，使用全量下载', e instanceof Error ? e.message : e);
    }
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
    autoUpdater.disableDifferentialDownload = true;

    const devUpdateMode =
      !app.isPackaged && process.env.COMPANION_ENABLE_UPDATE_IN_DEV === '1';
    const latestProbe = await probeFeedLatestYml(feed);

    if (app.isPackaged) {
      const staleDevYaml = path.join(app.getPath('userData'), 'dev-app-update.yml');
      if (fs.existsSync(staleDevYaml)) {
        try {
          fs.unlinkSync(staleDevYaml);
          logUpdater('info', '已清除开发壳遗留 dev-app-update.yml');
        } catch {
          /* ignore */
        }
      }
    }

    if (!latestProbe.ok) {
      logUpdater(
        'warn',
        'latest.yml 不可用',
        `${latestProbe.status || ''} ${latestProbe.url || feed}`,
      );
    }

    configured = true;
    lastFeedUrl = feed;
    autoUpdater.forceDevUpdateConfig = false;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    await configureDifferentialDownloadFromFeed(feed);
    logUpdater('info', 'feed 已配置', feed);

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
      const errMsg = err instanceof Error ? err.message : String(err || '');
      logUpdater('error', errMsg, err instanceof Error ? err.stack : '');
      if (
        autoUpdater &&
        !autoUpdater.disableDifferentialDownload &&
        /blockmap|differential/i.test(errMsg)
      ) {
        autoUpdater.disableDifferentialDownload = true;
        logUpdater('warn', '差分下载失败，已切换为全量下载并重试');
        try {
          await autoUpdater.checkForUpdates();
          return;
        } catch (retryErr) {
          logUpdater('error', '全量重试仍失败', retryErr instanceof Error ? retryErr.message : retryErr);
        }
      }
      setPhase('idle');
      setCompanionStatusNote('伴侣运行中');
      if (manualCheckPending) {
        void dialog.showErrorBox('更新失败', formatUpdaterErrorForUser(err));
      } else if (pendingVersion) {
        const short = errMsg.length > 120 ? `${errMsg.slice(0, 120)}…` : errMsg;
        displayTrayBalloon({
          title: '更新下载未完成',
          content: `v${pendingVersion} 下载失败：${short}。详见 userData/updater.log`,
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
