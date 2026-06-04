'use strict';

/**
 * 桌面壳一键安装 PaddleOCR（与 SamLocal/rembg 共用嵌入 Python）。
 *
 * 环境变量：
 *   AC_COMPANION_SANDBOX_ROOT   沙盒根（必填）
 *   AC_PADDLEOCR_USER_ROOT      状态目录（paddleocr-runtime）
 *   AC_PADDLEOCR_GPU=1          可选：安装 paddlepaddle-gpu 而非 CPU 版
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawnSync } = require('child_process');

const RUNTIME_ID = 'py311-sam-torch-cpu-win-amd64';
const RUNTIME_VERSION = '1';

function log(type, msg) {
  process.stdout.write(`${JSON.stringify({ type, msg, t: new Date().toISOString() })}\n`);
}

function run(pyExe, args, opts = {}) {
  log('log', `${pyExe} ${args.join(' ')}`);
  const { env: extraEnv, ...spawnRest } = opts;
  const env = {
    ...process.env,
    ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
  };
  const r = spawnSync(pyExe, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...spawnRest,
    env,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (out) log('log', out.slice(0, 8000));
  if (r.error) {
    throw new Error(`命令启动失败: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(`命令失败 exit=${r.status ?? 'null'} signal=${r.signal ?? ''}`.trim());
  }
  return r;
}

function resolvePythonExe(sandboxRoot) {
  const runtimeRoot = path.join(sandboxRoot, 'runtimes', RUNTIME_ID, RUNTIME_VERSION);
  const pyExe = path.join(runtimeRoot, 'python', 'python.exe');
  if (fs.existsSync(pyExe)) return pyExe;
  return '';
}

async function main() {
  if (process.platform !== 'win32') {
    log('error', '当前 PaddleOCR 一键安装仅支持 Windows（请先安装 SamLocal/rembg 共享 Python，或手动配置 COMPANION_PADDLEOCR_PYTHON）。');
    process.exit(1);
  }

  const sandboxRoot = String(process.env.AC_COMPANION_SANDBOX_ROOT || '').trim();
  const userRoot = String(process.env.AC_PADDLEOCR_USER_ROOT || '').trim();
  if (!sandboxRoot || !userRoot) {
    log('error', '缺少 AC_COMPANION_SANDBOX_ROOT 或 AC_PADDLEOCR_USER_ROOT');
    process.exit(1);
  }

  const pyExe = resolvePythonExe(sandboxRoot);
  if (!pyExe) {
    log('error', '未找到共享 Python。请先在桌面伴侣中完成 SamLocal 或 rembg 的一键安装。');
    process.exit(1);
  }

  const useGpu = String(process.env.AC_PADDLEOCR_GPU || '').trim() === '1';
  const device = useGpu ? 'gpu' : 'cpu';
  const modelsDir = path.join(sandboxRoot, 'models', 'paddleocr');
  const pipCacheDir = path.join(sandboxRoot, 'cache', 'pip');
  await fsp.mkdir(userRoot, { recursive: true });
  await fsp.mkdir(modelsDir, { recursive: true });
  await fsp.mkdir(pipCacheDir, { recursive: true });

  const pipEnv = {
    ...process.env,
    PIP_CACHE_DIR: pipCacheDir,
    PADDLEOCR_HOME: modelsDir,
  };

  log('phase', `安装 PaddlePaddle (${device})…`);
  const paddlePkg = useGpu ? 'paddlepaddle-gpu' : 'paddlepaddle';
  run(pyExe, ['-m', 'pip', 'install', '--upgrade', 'pip', '--no-warn-script-location'], {
    cwd: userRoot,
    env: pipEnv,
  });
  run(pyExe, ['-m', 'pip', 'install', '--no-warn-script-location', paddlePkg], {
    cwd: userRoot,
    env: pipEnv,
  });

  log('phase', '安装 paddleocr…');
  run(pyExe, ['-m', 'pip', 'install', '--no-warn-script-location', 'paddleocr'], {
    cwd: userRoot,
    env: pipEnv,
  });

  log('phase', '校验 import…');
  run(
    pyExe,
    ['-c', 'from paddleocr import PaddleOCR, PPStructureV3; print("paddleocr ok")'],
    { env: pipEnv, shell: false },
  );

  const repoRoot = path.resolve(__dirname, '..', '..');
  const serviceDirDev = path.join(repoRoot, 'local-companion', 'paddleocr-service');
  const serviceScriptDev = path.join(serviceDirDev, 'server.py');
  let serviceDir = serviceDirDev;
  let serviceScript = serviceScriptDev;
  try {
    if (process.resourcesPath) {
      const packaged = path.join(process.resourcesPath, 'paddleocr-service', 'server.py');
      if (fs.existsSync(packaged)) {
        serviceScript = packaged;
        serviceDir = path.dirname(packaged);
      }
    }
  } catch {
    /* ignore */
  }

  const state = {
    ready: true,
    platform: 'win32',
    sandboxRoot,
    userRoot,
    runtimeId: RUNTIME_ID,
    pythonExe: pyExe,
    device,
    modelsDir,
    serviceDir,
    serviceScript,
    installedAt: new Date().toISOString(),
  };
  await fsp.mkdir(userRoot, { recursive: true });
  await fsp.writeFile(path.join(userRoot, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  log('phase', `安装完成（device=${device}）。桌面壳将重启本机伴侣以加载 PaddleOCR 服务。`);
}

main().catch((e) => {
  log('error', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
