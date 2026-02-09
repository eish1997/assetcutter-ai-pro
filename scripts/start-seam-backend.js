#!/usr/bin/env node
/**
 * 启动贴图修缝 Python 后端（WebSeamRepair）
 * 用法：npm run dev:seam-backend 或由 dev:all 一并启动
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..', 'WebSeamRepair', 'backend');
if (!fs.existsSync(path.join(backendDir, 'main.py'))) {
  console.error('[seam-backend] 未找到 WebSeamRepair/backend，请确认仓库结构。');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const cmd = isWin ? 'python' : 'python3';
const args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8008'];

console.log('[seam-backend] 启动贴图修缝后端 (http://127.0.0.1:8008) …');
console.log('[seam-backend] 工作目录:', backendDir);
const child = spawn(cmd, args, {
  cwd: backendDir,
  stdio: 'inherit',
  shell: isWin,
});

child.on('error', (err) => {
  console.error('[seam-backend] 启动失败:', err.message);
  if (err.code === 'ENOENT') {
    console.error('[seam-backend] 请先安装 Python 并确保已执行: cd WebSeamRepair/backend && pip install -r requirements.txt');
  }
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
