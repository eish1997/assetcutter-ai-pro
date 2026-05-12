'use strict';

/**
 * 统一 Windows 产物文件名：AssetCutterCompanion-<semver>-<buildTag>-<arch>.exe
 * - buildTag：环境变量 COMPANION_ARTIFACT_SUFFIX（CI/人工指定）；未设则用本地时间 yyyyMMdd-HHmmss。
 * - 通过 --config.win.artifactName 覆盖 package.json，避免同版本多次打包互相覆盖。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const cliPath = path.join(desktopDir, 'node_modules', 'electron-builder', 'cli.js');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function defaultBuildTag() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

/** Windows 文件名安全 + 长度上限，避免用户自定义 env 含非法字符 */
function sanitizeBuildTag(raw) {
  const s = String(raw)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) {
    return null;
  }
  return s.length > 48 ? s.slice(0, 48) : s;
}

function resolveBuildTag() {
  const fromEnv = process.env.COMPANION_ARTIFACT_SUFFIX;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    const t = sanitizeBuildTag(fromEnv);
    if (t) {
      return t;
    }
  }
  return defaultBuildTag();
}

function usage() {
  console.error('用法: node scripts/electron-build-with-suffix.cjs <dir|portable|nsis>');
  process.exit(1);
}

const mode = process.argv[2];
if (!mode || !['dir', 'portable', 'nsis'].includes(mode)) {
  usage();
}

if (!fs.existsSync(cliPath)) {
  console.error(`缺少 electron-builder：未找到 ${cliPath}，请在 companion-desktop 目录执行 npm ci。`);
  process.exit(1);
}

const buildTag = resolveBuildTag();
process.env.COMPANION_ARTIFACT_SUFFIX = buildTag;

// electron-builder 会展开 ${version}、${arch}、${ext}；buildTag 已脱敏，直接拼接
const winArtifactName = `AssetCutterCompanion-\${version}-${buildTag}-\${arch}.\${ext}`;
console.log(`[companion-desktop] win.artifactName 后缀 COMPANION_ARTIFACT_SUFFIX=${buildTag}`);

const outputByMode = {
  dir: 'dist/pack',
  portable: 'dist/portable',
  nsis: 'dist/installer',
};

const outDir = outputByMode[mode];
const extraArgs =
  mode === 'dir'
    ? ['--dir', `--config.directories.output=${outDir}`, `--config.win.artifactName=${winArtifactName}`]
    : [
        '--win',
        mode === 'portable' ? 'portable' : 'nsis',
        `--config.directories.output=${outDir}`,
        `--config.win.artifactName=${winArtifactName}`,
      ];

const r = spawnSync(process.execPath, [cliPath, ...extraArgs], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: { ...process.env, COMPANION_ARTIFACT_SUFFIX: buildTag },
});

if (r.error) {
  throw r.error;
}
process.exit(r.status == null ? 1 : r.status);
