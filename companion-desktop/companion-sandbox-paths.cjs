'use strict';

/**
 * Windows 本机伴侣「沙盒」根：运行时、模型缓存、默认卷、桌面壳 userData 均收拢其下，
 * 卸载时可整树删除 `%LOCALAPPDATA%\AssetCutterCompanion\sandbox\`（另见 docs/本地伴侣-沙盒目录.md）。
 *
 * 非 Windows：返回空字符串，由调用方走原有默认路径。
 */

const path = require('path');
const fs = require('fs');

/**
 * 将沙盒引入前的落盘整目录迁入沙盒（仅当目标路径尚不存在时），用户无需手动找旧路径。
 * - `...\AssetCutterCompanion\desktop-shell` → `...\sandbox\desktop-shell`
 * - `...\AssetCutterCompanion\runtimes` → `...\sandbox\runtimes`
 */
function migrateLegacyAssetCutterLayout() {
  if (process.platform !== 'win32') return;
  const la = String(process.env.LOCALAPPDATA || '').trim();
  if (!la) return;
  const companionRoot = path.join(la, 'AssetCutterCompanion');
  const sandboxRoot = path.join(companionRoot, 'sandbox');
  const legacyShell = path.join(companionRoot, 'desktop-shell');
  const newShell = path.join(sandboxRoot, 'desktop-shell');
  const legacyRt = path.join(companionRoot, 'runtimes');
  const newRt = path.join(sandboxRoot, 'runtimes');

  fs.mkdirSync(sandboxRoot, { recursive: true });

  if (!fs.existsSync(newShell) && fs.existsSync(legacyShell)) {
    try {
      fs.renameSync(legacyShell, newShell);
    } catch (e) {
      console.warn('[companion-sandbox] 迁入旧 desktop-shell 失败:', e);
    }
  } else if (!fs.existsSync(newShell)) {
    fs.mkdirSync(newShell, { recursive: true });
  }

  if (!fs.existsSync(newRt) && fs.existsSync(legacyRt)) {
    try {
      fs.renameSync(legacyRt, newRt);
    } catch (e) {
      console.warn('[companion-sandbox] 迁入旧 runtimes 失败:', e);
    }
  }
}

function getCompanionSandboxRoot() {
  if (process.platform !== 'win32') return '';
  const la = String(process.env.LOCALAPPDATA || '').trim();
  if (!la) return '';
  return path.join(la, 'AssetCutterCompanion', 'sandbox');
}

/** Electron `userData`：配对、设置、一键安装薄状态、spawn 日志等 */
function getDesktopShellUserDataPath() {
  const root = getCompanionSandboxRoot();
  if (!root) return '';
  return path.join(root, 'desktop-shell');
}

function sandboxRuntimesRoot() {
  const root = getCompanionSandboxRoot();
  if (!root) return '';
  return path.join(root, 'runtimes');
}

function sandboxModelsRembgDir() {
  const root = getCompanionSandboxRoot();
  if (!root) return '';
  return path.join(root, 'models', 'rembg');
}

function sandboxCachePipDir() {
  const root = getCompanionSandboxRoot();
  if (!root) return '';
  return path.join(root, 'cache', 'pip');
}

function sandboxCacheTorchDir() {
  const root = getCompanionSandboxRoot();
  if (!root) return '';
  return path.join(root, 'cache', 'torch');
}

function sandboxCacheHuggingfaceDir() {
  const root = getCompanionSandboxRoot();
  if (!root) return '';
  return path.join(root, 'cache', 'huggingface');
}

/** 未在设置中指定卷根时，由 local-companion 使用的默认路径（与 COMPANION_SANDBOX_ROOT 配套） */
function sandboxDefaultVolumeDir() {
  const root = getCompanionSandboxRoot();
  if (!root) return '';
  return path.join(root, 'volume');
}

module.exports = {
  getCompanionSandboxRoot,
  getDesktopShellUserDataPath,
  sandboxRuntimesRoot,
  sandboxModelsRembgDir,
  sandboxCachePipDir,
  sandboxCacheTorchDir,
  sandboxCacheHuggingfaceDir,
  sandboxDefaultVolumeDir,
  migrateLegacyAssetCutterLayout,
};
