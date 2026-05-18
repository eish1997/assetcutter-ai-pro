'use strict';

/**
 * 打包前写入 build-constants.json（供安装包内 electron-updater 默认更新源）。
 * 环境变量 COMPANION_BUILD_AUTH_API_ORIGIN：auth-api 根地址，无尾斜杠，例如 https://your-auth.onrender.com
 */
const fs = require('fs');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const outPath = path.join(desktopDir, 'build-constants.json');

const origin = String(process.env.COMPANION_BUILD_AUTH_API_ORIGIN || '')
  .trim()
  .replace(/\/+$/, '');

const payload = {
  defaultAuthApiOrigin: origin,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(
  `[companion-desktop] wrote build-constants.json defaultAuthApiOrigin=${origin || '(empty — 将回退到设置中的主站)'}`,
);
