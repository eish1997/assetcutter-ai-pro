#!/usr/bin/env node
/**
 * 本机 SamLocal 首次准备：在 SamLocal/ 下 pip 安装依赖，并下载 ViT-B 权重。
 * 需本机已安装 Python 3.10+ 且在 PATH 中（Windows 可尝试 python / py -3）。
 *
 * 用法：
 *   node scripts/setup-sam-local.mjs
 *   node scripts/setup-sam-local.mjs --skip-pip
 *   node scripts/setup-sam-local.mjs --skip-download
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadSamVitBCheckpoint } from './download-sam-vit-b-checkpoint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const samRoot = path.join(repoRoot, 'SamLocal');

function parseFlags(argv) {
  const skipPip = argv.includes('--skip-pip');
  const skipDownload = argv.includes('--skip-download');
  return { skipPip, skipDownload };
}

function pipInstall() {
  const isWin = process.platform === 'win32';
  const attempts = isWin
    ? [
        ['python', ['-m', 'pip', 'install', '-r', 'requirements.txt', '-r', 'requirements-sam.txt']],
        ['py', ['-3', '-m', 'pip', 'install', '-r', 'requirements.txt', '-r', 'requirements-sam.txt']],
      ]
    : [
        ['python3', ['-m', 'pip', 'install', '-r', 'requirements.txt', '-r', 'requirements-sam.txt']],
        ['python', ['-m', 'pip', 'install', '-r', 'requirements.txt', '-r', 'requirements-sam.txt']],
      ];

  for (const [cmd, args] of attempts) {
    console.log(`[setup-sam-local] 尝试: ${cmd} ${args.join(' ')}`);
    const r = spawnSync(cmd, args, {
      cwd: samRoot,
      stdio: 'inherit',
      shell: isWin,
      env: process.env,
    });
    if (r.status === 0) return true;
    console.warn(`[setup-sam-local] 上述命令退出码 ${r.status ?? 'unknown'}，尝试下一种 Python 调用方式…`);
  }
  return false;
}

async function main() {
  const { skipPip, skipDownload } = parseFlags(process.argv.slice(2));

  if (!fs.existsSync(path.join(samRoot, 'requirements.txt'))) {
    console.error('[setup-sam-local] 未找到 SamLocal/requirements.txt，请在仓库根目录执行 npm run setup:sam-local');
    process.exit(1);
  }

  if (!skipPip) {
    console.log('[setup-sam-local] 安装 Python 依赖（可能需数分钟，含 torch 时更久）…');
    const ok = pipInstall();
    if (!ok) {
      console.error(
        '[setup-sam-local] pip 安装失败。请确认已安装 Python 3.10+ 且 pip 可用；Windows 可安装「Python Launcher」后重试。',
      );
      process.exit(1);
    }
  } else {
    console.log('[setup-sam-local] 已 --skip-pip，跳过依赖安装');
  }

  if (!skipDownload) {
    await downloadSamVitBCheckpoint({ force: false, samLocalRoot: samRoot });
  } else {
    console.log('[setup-sam-local] 已 --skip-download，跳过权重下载');
  }

  console.log('[setup-sam-local] 完成。请在本机将 SAM_MODE=sam（或默认读取 .env）后执行 npm run dev:sam-local 验证 GET /health。');
}

main().catch((err) => {
  console.error('[setup-sam-local]', err instanceof Error ? err.message : err);
  process.exit(1);
});
