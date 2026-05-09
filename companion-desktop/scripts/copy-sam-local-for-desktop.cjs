'use strict';

/**
 * 将 SamLocal 源码子集复制到 companion-desktop/sam-local-bundled/，供安装包 extraResources 携带。
 * 使用 requirements-sam-nogit.txt，避免用户机必须安装 Git。
 */
const path = require('path');
const fs = require('fs');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const samRoot = path.join(repoRoot, 'SamLocal');
const outDir = path.join(desktopDir, 'sam-local-bundled');

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  if (!fs.existsSync(path.join(samRoot, 'app', 'main.py'))) {
    throw new Error(`缺少 SamLocal 源码: ${samRoot}`);
  }
  rmrf(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const copyDir = (name) => {
    const src = path.join(samRoot, name);
    const dest = path.join(outDir, name);
    if (!fs.existsSync(src)) throw new Error(`缺少 ${src}`);
    fs.cpSync(src, dest, { recursive: true });
  };

  copyDir('app');
  for (const f of ['requirements.txt', 'openapi.yaml', 'requirements-sam-nogit.txt']) {
    const src = path.join(samRoot, f);
    if (!fs.existsSync(src)) throw new Error(`缺少 ${src}`);
    fs.copyFileSync(src, path.join(outDir, f));
  }
  /** 桌面安装脚本固定读 requirements-sam-nogit.txt；复制一份常用名便于人工核对 */
  fs.copyFileSync(
    path.join(samRoot, 'requirements-sam-nogit.txt'),
    path.join(outDir, 'requirements-sam-desktop.txt'),
  );

  console.log('[copy-sam-local-for-desktop] ok', outDir);
}

main();
