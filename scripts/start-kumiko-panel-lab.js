#!/usr/bin/env node
/**
 * 启动 Kumiko 分格实验室 Web UI
 * 用法：npm run dev:kumiko-panel-lab
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const labRoot = path.join(repoRoot, 'tools', 'kumiko-panel-lab');
const kumikoRoot = path.join(labRoot, 'vendor', 'kumiko');

if (!fs.existsSync(path.join(kumikoRoot, 'kumikolib.py'))) {
  console.error('[kumiko-panel-lab] 未找到 vendor/kumiko。请先执行: npm run setup:kumiko-panel-lab');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const cmd = isWin ? 'python' : 'python3';
const port = process.env.KUMIKO_LAB_PORT?.trim() || '18083';
const args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', port];

console.log(`[kumiko-panel-lab] http://127.0.0.1:${port}`);
console.log('[kumiko-panel-lab] 工作目录:', labRoot);

const sep = isWin ? ';' : ':';
const env = { ...process.env, PYTHONPATH: kumikoRoot + (process.env.PYTHONPATH ? sep + process.env.PYTHONPATH : '') };

const child = spawn(cmd, args, {
  cwd: labRoot,
  stdio: 'inherit',
  shell: isWin,
  env,
});

child.on('error', (err) => {
  console.error('[kumiko-panel-lab] 启动失败:', err.message);
  if (err.code === 'ENOENT') {
    console.error('[kumiko-panel-lab] 请先: npm run setup:kumiko-panel-lab');
  }
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
