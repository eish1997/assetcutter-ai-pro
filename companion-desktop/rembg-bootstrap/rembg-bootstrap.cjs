'use strict';

/**
 * 桌面壳以 ELECTRON_RUN_AS_NODE=1 子进程运行：与 SamLocal 一键安装**共用**同一嵌入 Python 目录
 * `<AC_COMPANION_SANDBOX_ROOT>\runtimes\py311-sam-torch-cpu-win-amd64\1\python\`（RUNTIME_ID 须与 sam-local-bootstrap 一致）。
 *
 * 环境变量（由 main.cjs 传入）：
 *   AC_COMPANION_SANDBOX_ROOT  沙盒根（必填）
 *   AC_REMBG_USER_ROOT         薄状态目录（rembg-runtime），仅写 state.json
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const RUNTIME_ID = 'py311-sam-torch-cpu-win-amd64';
const RUNTIME_VERSION = '1';

const PYTHON_EMBED_URL =
  'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

let pipCacheDir = '';

function log(type, msg) {
  process.stdout.write(`${JSON.stringify({ type, msg, t: new Date().toISOString() })}\n`);
}

function downloadToFile(url, dest, onProgress) {
  return fsp.mkdir(path.dirname(dest), { recursive: true }).then(
    () =>
      new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const tmp = `${dest}.partial`;
        const file = fs.createWriteStream(tmp);
        lib
          .get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              file.close();
              fs.unlink(tmp, () => {});
              void downloadToFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
              return;
            }
            if (res.statusCode !== 200) {
              file.close();
              fs.unlink(tmp, () => {});
              reject(new Error(`HTTP ${res.statusCode} ${url}`));
              return;
            }
            const total = Number(res.headers['content-length']) || 0;
            let done = 0;
            let last = 0;
            res.on('data', (chunk) => {
              done += chunk.length;
              if (onProgress && total && done - last > 8 * 1024 * 1024) {
                last = done;
                onProgress(done, total);
              }
            });
            res.pipe(file);
            file.on('finish', () => {
              file.close((err) => {
                if (err) return reject(err);
                fs.rename(tmp, dest, (e) => (e ? reject(e) : resolve()));
              });
            });
          })
          .on('error', (e) => {
            try {
              file.close();
            } catch {
              /* ignore */
            }
            fs.unlink(tmp, () => {});
            reject(e);
          });
      }),
  );
}

function run(cmd, args, opts = {}) {
  log('log', `${cmd} ${args.join(' ')}`);
  const { env: extraEnv, ...spawnRest } = opts;
  const env = {
    ...process.env,
    ...(pipCacheDir ? { PIP_CACHE_DIR: pipCacheDir } : {}),
    ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
  };
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    ...spawnRest,
    env,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (out) log('log', out.slice(0, 8000));
  if (r.status !== 0) {
    throw new Error(`命令失败 exit=${r.status}: ${cmd} ${args.join(' ')}`);
  }
  return r;
}

function findPthFile(pythonDir) {
  const names = fs.readdirSync(pythonDir);
  const pth = names.find((n) => n.endsWith('._pth'));
  if (!pth) throw new Error('未找到 python*._pth（嵌入包异常）');
  return path.join(pythonDir, pth);
}

function enableSitePackages(pythonDir) {
  const pthPath = findPthFile(pythonDir);
  let text = fs.readFileSync(pthPath, 'utf8');
  if (!text.includes('import site')) {
    text += '\r\nimport site\r\n';
  } else {
    text = text.replace(/#(\s*import site)/, '$1');
  }
  fs.writeFileSync(pthPath, text, 'utf8');
}

async function main() {
  if (process.platform !== 'win32') {
    log('error', '当前一键安装仅支持 Windows。');
    process.exit(1);
  }

  const sandboxRoot = String(process.env.AC_COMPANION_SANDBOX_ROOT || '').trim();
  if (!sandboxRoot) {
    log('error', '缺少环境变量 AC_COMPANION_SANDBOX_ROOT');
    process.exit(1);
  }

  const userRoot = String(process.env.AC_REMBG_USER_ROOT || '').trim();
  if (!userRoot) {
    log('error', '缺少环境变量 AC_REMBG_USER_ROOT');
    process.exit(1);
  }

  pipCacheDir = path.join(sandboxRoot, 'cache', 'pip');
  await fsp.mkdir(pipCacheDir, { recursive: true });
  await fsp.mkdir(path.join(sandboxRoot, 'models', 'rembg'), { recursive: true });

  const runtimeRoot = path.join(sandboxRoot, 'runtimes', RUNTIME_ID, RUNTIME_VERSION);
  const pythonDir = path.join(runtimeRoot, 'python');
  const pyExe = path.join(pythonDir, 'python.exe');
  const embedZip = path.join(runtimeRoot, '_cache', 'python-embed.zip');
  const getPipPy = path.join(runtimeRoot, '_cache', 'get-pip.py');

  log('phase', `沙盒根：${sandboxRoot}`);
  log('phase', `共享运行时：${RUNTIME_ID}@${RUNTIME_VERSION} → ${runtimeRoot}`);

  await fsp.mkdir(path.join(userRoot, '_cache'), { recursive: true });
  await fsp.mkdir(path.join(runtimeRoot, '_cache'), { recursive: true });

  if (!fs.existsSync(pyExe)) {
    log('phase', '下载嵌入式 Python（约 20MB）…');
    await downloadToFile(PYTHON_EMBED_URL, embedZip, (done, total) =>
      log('progress', `Python 压缩包 ${Math.round(done / 1024 / 1024)} / ${Math.round(total / 1024 / 1024)} MiB`),
    );
    await fsp.rm(pythonDir, { recursive: true, force: true });
    await fsp.mkdir(pythonDir, { recursive: true });
    run('tar', ['-xf', embedZip, '-C', pythonDir]);
    enableSitePackages(pythonDir);
  } else {
    log('phase', '共享目录已存在 python.exe，跳过嵌入包解压');
  }

  log('phase', '确保 pip 可用…');
  if (!fs.existsSync(getPipPy)) {
    await downloadToFile(GET_PIP_URL, getPipPy);
  }
  run(pyExe, [getPipPy, '--no-warn-script-location'], { cwd: pythonDir });
  run(pyExe, ['-m', 'pip', 'install', '--upgrade', 'pip', '--no-warn-script-location'], { cwd: userRoot });

  const u2netHome = path.join(sandboxRoot, 'models', 'rembg');
  const pipProbeEnv = { U2NET_HOME: u2netHome };

  log('phase', '检测 / 安装 rembg[cpu]…');
  const probe = spawnSync(pyExe, ['-c', 'import rembg'], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PIP_CACHE_DIR: pipCacheDir, ...pipProbeEnv },
  });
  if (probe.status !== 0) {
    run(pyExe, ['-m', 'pip', 'install', '--no-warn-script-location', 'rembg[cpu]'], {
      cwd: userRoot,
      env: pipProbeEnv,
    });
  } else {
    log('phase', 'rembg 已可 import，跳过 pip（可再次运行以升级）');
  }

  const verify = spawnSync(pyExe, ['-c', 'from rembg import remove, new_session'], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PIP_CACHE_DIR: pipCacheDir, ...pipProbeEnv },
  });
  if (verify.status !== 0) {
    const err = `${verify.stderr || ''}${verify.stdout || ''}`.trim();
    throw new Error(`rembg 校验失败: ${err.slice(0, 800)}`);
  }

  log('phase', '预取 rembg 默认权重 u2net 到沙盒（与网站「去背景」一致；体积较大，需稳定网络）…');
  const prefetchEnv = { ...process.env, PIP_CACHE_DIR: pipCacheDir, ...pipProbeEnv };
  const prefetch = spawnSync(pyExe, ['-c', 'from rembg import new_session; new_session("u2net")'], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: prefetchEnv,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (prefetch.status !== 0) {
    const errText = `${prefetch.stderr || ''}${prefetch.stdout || ''}`.trim();
    throw new Error(`rembg 模型预取失败: ${errText.slice(0, 1200)}`);
  }
  const prefetchOut = `${prefetch.stdout || ''}${prefetch.stderr || ''}`.trim();
  if (prefetchOut) log('log', prefetchOut.slice(0, 4000));

  const state = {
    ready: true,
    platform: 'win32',
    sandboxRoot,
    userRoot,
    runtimeId: RUNTIME_ID,
    runtimeVersion: RUNTIME_VERSION,
    runtimeRoot,
    pythonExe: pyExe,
    u2netHome,
    installedAt: new Date().toISOString(),
  };
  await fsp.mkdir(userRoot, { recursive: true });
  await fsp.writeFile(path.join(userRoot, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  log('phase', '安装完成。桌面壳将尝试重启本机伴侣以加载 rembg。');
}

main().catch((e) => {
  log('error', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
