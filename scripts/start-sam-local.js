#!/usr/bin/env node
/**
 * 启动本机分割 Python 服务（SamLocal）
 * 用法：npm run dev:sam-local
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const samRoot = path.join(repoRoot, 'SamLocal');
const vendoredSitePackages = path.join(repoRoot, 'lib', 'site-packages');

if (!fs.existsSync(path.join(samRoot, 'app', 'main.py'))) {
  console.error('[sam-local] 未找到 SamLocal/app/main.py，请确认仓库结构。');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const cmd = isWin ? 'python' : 'python3';
const port = process.env.SAM_HTTP_PORT?.trim() || '18081';
const args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', port];

console.log(`[sam-local] 启动本机分割服务 (http://127.0.0.1:${port}) …`);
console.log('[sam-local] 工作目录:', samRoot);

const env = { ...process.env };
/** 已跑过 setup 且存在默认权重时，未显式设置则启用真 SAM（避免装全依赖仍走 stub） */
const defaultSamCkpt = path.join(samRoot, 'checkpoints', 'sam_vit_b_01ec64.pth');
if (!String(env.SAM_MODE || '').trim() && fs.existsSync(defaultSamCkpt)) {
  env.SAM_MODE = 'sam';
}
if (fs.existsSync(vendoredSitePackages)) {
  const sep = isWin ? ';' : ':';
  env.PYTHONPATH = env.PYTHONPATH
    ? `${samRoot}${sep}${vendoredSitePackages}${sep}${env.PYTHONPATH}`
    : `${samRoot}${sep}${vendoredSitePackages}`;
} else {
  env.PYTHONPATH = env.PYTHONPATH ? `${samRoot}${isWin ? ';' : ':'}${env.PYTHONPATH}` : samRoot;
}

const child = spawn(cmd, args, {
  cwd: samRoot,
  stdio: 'inherit',
  shell: isWin,
  env,
});

child.on('error', (err) => {
  console.error('[sam-local] 启动失败:', err.message);
  if (err.code === 'ENOENT') {
    console.error('[sam-local] 请先安装 Python 并执行: cd SamLocal && pip install -r requirements.txt');
  }
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
