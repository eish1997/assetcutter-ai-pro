#!/usr/bin/env node
/**
 * Kumiko 分格实验室：克隆 vendor、pip 安装依赖。
 * 用法：npm run setup:kumiko-panel-lab
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const labRoot = path.join(repoRoot, 'tools', 'kumiko-panel-lab');
const vendorDir = path.join(labRoot, 'vendor', 'kumiko');
const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  console.log(`[setup:kumiko-panel-lab] ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
    ...opts,
  });
  return r.status === 0;
}

function resolvePython() {
  const candidates = isWin ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    const r = spawnSync(cmd, args, { encoding: 'utf8', shell: isWin });
    if (r.status === 0) return cmd;
  }
  return null;
}

function cloneKumiko() {
  if (fs.existsSync(path.join(vendorDir, 'kumikolib.py'))) {
    console.log('[setup:kumiko-panel-lab] vendor/kumiko 已存在，跳过 clone');
    return true;
  }
  fs.mkdirSync(path.dirname(vendorDir), { recursive: true });
  return run('git', ['clone', '--depth', '1', 'https://github.com/njean42/kumiko.git', vendorDir], {
    cwd: path.dirname(vendorDir),
  });
}

function pipInstall(py) {
  const pipArgs =
    py === 'py'
      ? ['-3', '-m', 'pip', 'install', '-r', 'requirements.txt']
      : ['-m', 'pip', 'install', '-r', 'requirements.txt'];
  return run(py, pipArgs, { cwd: labRoot });
}

function smokeKumiko(py) {
  const sample = path.join(vendorDir, 'tests', 'images', '000-common-page-templates', 'simple.png');
  if (!fs.existsSync(sample)) {
    console.warn('[setup:kumiko-panel-lab] 跳过 smoke：未找到 simple.png');
    return true;
  }
  const kumikoBin = path.join(vendorDir, isWin ? 'kumiko' : 'kumiko');
  const env = {
    ...process.env,
    PYTHONPATH: vendorDir + (process.env.PYTHONPATH ? (isWin ? ';' : ':') + process.env.PYTHONPATH : ''),
  };
  const outJson = path.join(labRoot, 'uploads', 'smoke-simple.json');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  const args = [kumikoBin, '-i', sample, '-o', outJson];
  const r = spawnSync(isWin ? 'python' : py, args, { cwd: vendorDir, env, encoding: 'utf8', shell: isWin });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    return false;
  }
  try {
    const data = JSON.parse(fs.readFileSync(outJson, 'utf8'));
    const panels = data[0]?.panels?.length ?? 0;
    console.log(`[setup:kumiko-panel-lab] smoke OK: simple.png → ${panels} panels`);
    return panels > 0;
  } catch (e) {
    console.error('[setup:kumiko-panel-lab] smoke JSON 解析失败', e);
    return false;
  }
}

function main() {
  if (!fs.existsSync(path.join(labRoot, 'requirements.txt'))) {
    console.error('[setup:kumiko-panel-lab] 未找到 tools/kumiko-panel-lab');
    process.exit(1);
  }
  const py = resolvePython();
  if (!py) {
    console.error('[setup:kumiko-panel-lab] 未找到 Python，请安装 Python 3.10+');
    process.exit(1);
  }
  if (!cloneKumiko()) process.exit(1);
  if (!pipInstall(py)) process.exit(1);
  if (!smokeKumiko(py)) {
    console.error('[setup:kumiko-panel-lab] smoke 失败');
    process.exit(1);
  }
  console.log('[setup:kumiko-panel-lab] 完成。启动: npm run dev:kumiko-panel-lab');
}

main();
