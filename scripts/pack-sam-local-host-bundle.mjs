#!/usr/bin/env node
/**
 * 将 SamLocal 打成 host_plugin_bundle 用 ZIP（extracted/ 内含 run.json + 源码树）。
 * 用法：node scripts/pack-sam-local-host-bundle.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const samRoot = path.join(repoRoot, 'SamLocal');
const runJsonSrc = path.join(samRoot, 'host-plugin-bundle', 'extracted', 'run.json');
const outDir = path.join(repoRoot, 'SamLocal-release');
const staging = path.join(outDir, '.staging-bundle');
const extracted = path.join(staging, 'extracted');

function readSamVersion() {
  try {
    const mainPy = fs.readFileSync(path.join(samRoot, 'app', 'main.py'), 'utf8');
    const m = /SAM_BACKEND_VERSION\s*=\s*["']([^"']+)["']/.exec(mainPy);
    return m ? m[1].trim() : '0.2.0';
  } catch {
    return '0.2.0';
  }
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (!fs.existsSync(runJsonSrc)) {
  console.error('[pack-sam-local-bundle] 缺少', runJsonSrc);
  process.exit(1);
}

const version = readSamVersion();
const zipName = `sam-local-host-bundle-${version}.zip`;
const zipPath = path.join(outDir, zipName);

rmrf(staging);
fs.mkdirSync(extracted, { recursive: true });

fs.copyFileSync(runJsonSrc, path.join(extracted, 'run.json'));

const copyNames = ['app', 'requirements.txt', 'openapi.yaml', 'requirements-sam.txt', 'README.md'];
for (const name of copyNames) {
  const src = path.join(samRoot, name);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(extracted, name);
  fs.cpSync(src, dest, { recursive: true });
}

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

/** Windows / macOS / Linux：BSD tar 支持 -a 按后缀选 zip */
const tar = spawnSync('tar', ['-a', '-c', '-f', zipPath, 'extracted'], {
  cwd: staging,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (tar.status !== 0) {
  console.error('[pack-sam-local-bundle] tar 打包失败，可改用手动：将', extracted, '打成 zip，根路径内含 extracted/');
  process.exit(tar.status ?? 1);
}

rmrf(staging);

const REQUIRED_ZIP_PATHS = [
  'extracted/run.json',
  'extracted/app/main.py',
  'extracted/requirements.txt',
  'extracted/openapi.yaml',
  'extracted/requirements-sam.txt',
];

function verifyHostBundleZip(zipFile) {
  if (!fs.existsSync(zipFile)) {
    console.error('[pack-sam-local-bundle] 校验失败：找不到', zipFile);
    return false;
  }
  const st = fs.statSync(zipFile);
  if (st.size < 512) {
    console.error('[pack-sam-local-bundle] 校验失败：zip 过小（', st.size, 'bytes）');
    return false;
  }
  const list = spawnSync('tar', ['-tf', zipFile], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (list.status !== 0) {
    console.error(
      '[pack-sam-local-bundle] 校验失败：无法执行 tar -tf（请使用 Windows 10+ 自带 tar 或 Git Bash）。',
      list.stderr || list.error || '',
    );
    return false;
  }
  const norm = String(list.stdout || '').replace(/\\/g, '/');
  for (const p of REQUIRED_ZIP_PATHS) {
    if (!norm.includes(p)) {
      console.error('[pack-sam-local-bundle] 校验失败：ZIP 清单中缺少', p);
      console.error('[pack-sam-local-bundle] tar -tf 前几行示例：\n', norm.split(/\r?\n/).slice(0, 12).join('\n'));
      return false;
    }
  }
  return true;
}

if (!verifyHostBundleZip(zipPath)) {
  try {
    fs.rmSync(zipPath, { force: true });
  } catch {
    /* ignore */
  }
  process.exit(1);
}

console.log('[pack-sam-local-bundle] 已生成', zipPath);
console.log('[pack-sam-local-bundle] 结构校验通过（', REQUIRED_ZIP_PATHS.length, '项关键路径）');
console.log('[pack-sam-local-bundle] 上传 R2 后在后台登记 host_plugin_bundle；用户通过设置页 install-from-url 安装。');
