'use strict';

/**
 * 打包前写入 build-constants.json 与 app-update.yml（electron-updater 安装包必需）。
 * 环境变量 COMPANION_BUILD_AUTH_API_ORIGIN：auth-api 根地址，无尾斜杠
 */
const fs = require('fs');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const constantsPath = path.join(desktopDir, 'build-constants.json');
const appUpdatePath = path.join(desktopDir, 'app-update.yml');

const origin = String(process.env.COMPANION_BUILD_AUTH_API_ORIGIN || '')
  .trim()
  .replace(/\/+$/, '');

function electronUpdateFeedUrl(authOrigin) {
  const base = String(authOrigin || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/api/companion-artifacts/electron-updater/win32/stable`;
}

const feedUrl = electronUpdateFeedUrl(origin);

fs.writeFileSync(
  constantsPath,
  `${JSON.stringify({ defaultAuthApiOrigin: origin, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);

const appUpdateYaml = [
  'provider: generic',
  feedUrl ? `url: ${feedUrl}` : 'url: ""',
  'updaterCacheDirName: assetcutter-companion-updater',
  '',
].join('\n');

fs.writeFileSync(appUpdatePath, appUpdateYaml, 'utf8');

console.log(
  `[companion-desktop] wrote build-constants.json defaultAuthApiOrigin=${origin || '(empty)'}`,
);
console.log(`[companion-desktop] wrote app-update.yml feed=${feedUrl || '(empty)'}`);
