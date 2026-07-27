'use strict';

/**
 * 为 electron-builder 生成安装包内置的 local-companion 运行时：
 * - main.cjs：esbuild 单文件 **CommonJS** bundle（须为 CJS：`ELECTRON_RUN_AS_NODE` + ESM 会因 yauzl 等 **dynamic require** 直接崩）
 * - public/：本机管理页静态文件（与 httpHandler 中路径一致）
 */
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const entry = path.join(repoRoot, 'local-companion', 'src', 'main.ts');
const outDir = path.join(desktopDir, 'local-companion-bundle');
const outFile = path.join(outDir, 'main.cjs');

async function main() {
  if (!fs.existsSync(entry)) {
    throw new Error(`缺少入口: ${entry}`);
  }
  const lcNm = path.join(repoRoot, 'local-companion', 'node_modules');
  if (!fs.existsSync(path.join(lcNm, 'yauzl', 'package.json'))) {
    throw new Error(
      'local-companion 依赖未安装：请在仓库根执行 `npm ci --prefix local-companion`（或于 local-companion 目录 npm ci）后再打包桌面壳。',
    );
  }
  /** 仅清空目录内容，避免 Windows 下整目录 rmdir 偶发 EBUSY（句柄占用） */
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  } else {
    for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
      fs.rmSync(path.join(outDir, ent.name), { recursive: true, force: true });
    }
  }

  // CJS has no import.meta.url; without this polyfill, fileURLToPath(import.meta.url)
  // crashes at boot (loadRepoEnvLocalProxies / public path / Maya bridge, etc.).
  await esbuild.build({
    absWorkingDir: path.join(repoRoot, 'local-companion'),
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: outFile,
    logLevel: 'info',
    banner: {
      js: 'var __ac_import_meta_url = require("url").pathToFileURL(__filename).href;',
    },
    define: {
      'import.meta.url': '__ac_import_meta_url',
    },
  });

  const pubFrom = path.join(repoRoot, 'local-companion', 'public');
  const pubTo = path.join(outDir, 'public');
  if (!fs.existsSync(pubFrom)) {
    throw new Error(`缺少 public 目录: ${pubFrom}`);
  }
  fs.cpSync(pubFrom, pubTo, { recursive: true });

  const ocrFrom = path.join(repoRoot, 'local-companion', 'paddleocr-service');
  const ocrTo = path.join(outDir, 'paddleocr-service');
  if (fs.existsSync(ocrFrom)) {
    fs.cpSync(ocrFrom, ocrTo, { recursive: true });
  }

  // Maya Command Port bridge source for GET/POST /v1/bridges/maya (one-click install).
  const mayaBridgeFrom = path.join(repoRoot, 'maya-plugins', 'script-hub-bridge');
  const mayaBridgeTo = path.join(outDir, 'maya-plugins', 'script-hub-bridge');
  const mayaBridgePy = path.join(mayaBridgeFrom, 'script_hub_bridge.py');
  if (!fs.existsSync(mayaBridgePy)) {
    throw new Error(`缺少 Maya bridge 源: ${mayaBridgePy}`);
  }
  fs.mkdirSync(path.dirname(mayaBridgeTo), { recursive: true });
  fs.cpSync(mayaBridgeFrom, mayaBridgeTo, { recursive: true });

  const st = fs.statSync(outFile);
  if (!st.isFile() || st.size < 1024) {
    throw new Error(`bundle 异常（过小或不存在）: ${outFile}`);
  }

  const bundledSrc = fs.readFileSync(outFile, 'utf8');
  if (!bundledSrc.includes('__ac_import_meta_url')) {
    throw new Error(
      'bundle 缺少 import.meta.url CJS polyfill（__ac_import_meta_url）；安装包会在 fileURLToPath 处秒崩',
    );
  }

  // Smoke: module must load under plain Node CJS (same as ELECTRON_RUN_AS_NODE).
  // COMPANION_HTTP_PORT=0 exits after env/proxy load without binding the port.
  const { spawnSync } = require('child_process');
  const smoke = spawnSync(process.execPath, [outFile], {
    cwd: outDir,
    env: { ...process.env, COMPANION_HTTP_PORT: '0' },
    encoding: 'utf8',
    timeout: 15000,
  });
  const smokeOut = `${smoke.stdout || ''}${smoke.stderr || ''}`;
  if (smokeOut.includes('ERR_INVALID_ARG_TYPE') || smokeOut.includes('fileURLToPath')) {
    throw new Error(
      `bundle smoke failed (import.meta.url / fileURLToPath):\n${smokeOut.slice(0, 2000)}`,
    );
  }
  if (!smokeOut.includes('COMPANION_HTTP_PORT=0')) {
    throw new Error(
      `bundle smoke unexpected exit (expected PORT=0 message):\ncode=${smoke.status}\n${smokeOut.slice(0, 2000)}`,
    );
  }

  console.log('[bundle-local-companion-runtime] ok', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
