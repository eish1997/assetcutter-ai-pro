'use strict';

/**
 * 由桌面壳以 ELECTRON_RUN_AS_NODE=1 子进程运行：
 * - **共享运行时**（嵌入 Python + pip 大依赖）→ `%LOCALAPPDATA%\AssetCutterCompanion\runtimes\<runtimeId>\<version>\`
 * - **薄应用**（SamLocal 源码 + 权重）→ `AC_SAM_USER_ROOT`（通常为 desktop-shell\sam-local-runtime）
 *
 * 后续其它插件可复用同一 `runtimes\...` 目录，无需每个插件各压一份 PyTorch。
 *
 * 环境变量（由 main.cjs 传入）：
 *   AC_SAM_USER_ROOT  绝对路径，SamLocal 安装根（sam-app、state、启动脚本）
 *   AC_SAM_SRC        内置 sam-local-bundled 绝对路径（extraResources）
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

/** 与磁盘目录名一致；升级 Python/主力 torch 档位时递增并新目录取全量 */
const RUNTIME_ID = 'py311-sam-torch-cpu-win-amd64';
const RUNTIME_VERSION = '1';

const PYTHON_EMBED_URL =
  'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const SAM_VIT_B_URL = 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth';
const MIN_CHECKPOINT_BYTES = 350 * 1024 * 1024;

function log(type, msg) {
  process.stdout.write(`${JSON.stringify({ type, msg, t: new Date().toISOString() })}\n`);
}

function companionDataRootFromSamUserRoot(userRoot) {
  // ...\AssetCutterCompanion\desktop-shell\sam-local-runtime → ...\AssetCutterCompanion
  return path.resolve(path.join(userRoot, '..', '..'));
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
              if (onProgress && total && done - last > 25 * 1024 * 1024) {
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
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
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

async function sha256Files(paths) {
  const h = crypto.createHash('sha256');
  for (const p of paths) {
    h.update(await fsp.readFile(p));
    h.update('\n');
  }
  return h.digest('hex');
}

async function tryMigrateLegacyPython(userRoot, pythonDir) {
  const legacy = path.join(userRoot, 'python');
  const legacyExe = path.join(legacy, 'python.exe');
  const targetExe = path.join(pythonDir, 'python.exe');
  if (fs.existsSync(targetExe) || !fs.existsSync(legacyExe)) return;
  log('phase', '检测到旧版安装（python 在 sam-local-runtime 内），迁移到共享运行时目录…');
  await fsp.mkdir(path.dirname(pythonDir), { recursive: true });
  try {
    await fsp.rename(legacy, pythonDir);
  } catch (e) {
    log(
      'log',
      `迁移共享目录失败（可继续使用旧路径或手动删除后重试）：${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function readRuntimeManifest(runtimeRoot) {
  const p = path.join(runtimeRoot, 'manifest.json');
  try {
    const raw = await fsp.readFile(p, 'utf8');
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

async function main() {
  if (process.platform !== 'win32') {
    log('error', '当前一键安装仅支持 Windows。');
    process.exit(1);
  }

  const userRoot = String(process.env.AC_SAM_USER_ROOT || '').trim();
  const bundledSrc = String(process.env.AC_SAM_SRC || '').trim();
  if (!userRoot || !bundledSrc) {
    log('error', '缺少环境变量 AC_SAM_USER_ROOT / AC_SAM_SRC');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(bundledSrc, 'app', 'main.py'))) {
    log('error', `内置 SamLocal 不完整: ${bundledSrc}`);
    process.exit(1);
  }

  const companionRoot = companionDataRootFromSamUserRoot(userRoot);
  const runtimeRoot = path.join(companionRoot, 'runtimes', RUNTIME_ID, RUNTIME_VERSION);
  const pythonDir = path.join(runtimeRoot, 'python');
  const samApp = path.join(userRoot, 'sam-app');
  const checkpoints = path.join(samApp, 'checkpoints');
  const embedZip = path.join(runtimeRoot, '_cache', 'python-embed.zip');
  const getPipPy = path.join(runtimeRoot, '_cache', 'get-pip.py');

  log('phase', `共享运行时：${RUNTIME_ID}@${RUNTIME_VERSION} → ${runtimeRoot}`);

  log('phase', '准备目录…');
  await fsp.mkdir(path.join(userRoot, '_cache'), { recursive: true });
  await fsp.mkdir(path.join(runtimeRoot, '_cache'), { recursive: true });

  await tryMigrateLegacyPython(userRoot, pythonDir);

  log('phase', '复制 SamLocal 应用文件…');
  await fsp.rm(samApp, { recursive: true, force: true });
  await fsp.mkdir(samApp, { recursive: true });
  await fsp.cp(path.join(bundledSrc, 'app'), path.join(samApp, 'app'), { recursive: true });
  for (const f of ['requirements.txt', 'requirements-sam-nogit.txt', 'openapi.yaml']) {
    await fsp.copyFile(path.join(bundledSrc, f), path.join(samApp, f));
  }
  await fsp.mkdir(checkpoints, { recursive: true });

  const reqMain = path.join(samApp, 'requirements.txt');
  const reqSam = path.join(samApp, 'requirements-sam-nogit.txt');
  const requirementsFingerprint = await sha256Files([reqMain, reqSam]);

  const pyExe = path.join(pythonDir, 'python.exe');
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

  const manifest = await readRuntimeManifest(runtimeRoot);
  const pipUpToDate =
    manifest &&
    manifest.schemaVersion === 1 &&
    manifest.samRequirementsFingerprint === requirementsFingerprint &&
    fs.existsSync(pyExe);

  log('phase', '安装 pip…');
  if (!fs.existsSync(getPipPy)) {
    await downloadToFile(GET_PIP_URL, getPipPy);
  }
  run(pyExe, [getPipPy, '--no-warn-script-location'], { cwd: pythonDir });
  run(pyExe, ['-m', 'pip', 'install', '--upgrade', 'pip', '--no-warn-script-location'], { cwd: samApp });

  if (pipUpToDate) {
    log('phase', '依赖指纹未变，跳过 PyTorch / SamLocal pip 安装（复用共享运行时）');
  } else {
    log('phase', '安装 PyTorch 与 SamLocal 依赖（耗时较长，可能数 GB 下载）…');
    run(
      pyExe,
      [
        '-m',
        'pip',
        'install',
        '--no-warn-script-location',
        '-r',
        path.join(samApp, 'requirements.txt'),
        '-r',
        path.join(samApp, 'requirements-sam-nogit.txt'),
      ],
      { cwd: samApp },
    );
    const nextManifest = {
      schemaVersion: 1,
      runtimeId: RUNTIME_ID,
      runtimeVersion: RUNTIME_VERSION,
      platform: 'win32',
      samRequirementsFingerprint: requirementsFingerprint,
      pipInstalledAt: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(runtimeRoot, 'manifest.json'), `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  }

  const ck = path.join(checkpoints, 'sam_vit_b_01ec64.pth');
  let needCk = true;
  try {
    const st = await fsp.stat(ck);
    if (st.size >= MIN_CHECKPOINT_BYTES) needCk = false;
  } catch {
    /* missing */
  }
  if (needCk) {
    log('phase', '下载 ViT-B 权重（约 375MB）…');
    await fsp.mkdir(path.dirname(ck), { recursive: true });
    await fsp.rm(ck, { force: true });
    await downloadToFile(SAM_VIT_B_URL, ck, (done) =>
      log('progress', `权重已下 ${Math.round(done / 1024 / 1024)} MiB`),
    );
  } else {
    log('phase', '权重已存在，跳过下载');
  }

  const startBat = path.join(userRoot, 'start-sam-local.cmd');
  const RUser = path.normalize(userRoot).replace(/[/\\]+$/, '');
  const RRun = path.normalize(runtimeRoot).replace(/[/\\]+$/, '');
  const bat =
    '@echo off\r\n' +
    'setlocal\r\n' +
    'set "SAM_MODE=sam"\r\n' +
    `set "PATH=${RRun}\\python;${RRun}\\python\\Scripts;%PATH%"\r\n` +
    `cd /d "${RUser}\\sam-app"\r\n` +
    `"${RRun}\\python\\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 18081\r\n`;
  await fsp.writeFile(startBat, bat, 'utf8');

  const state = {
    ready: true,
    platform: 'win32',
    userRoot,
    runtimeId: RUNTIME_ID,
    runtimeVersion: RUNTIME_VERSION,
    runtimeRoot,
    startScript: startBat,
    startCwd: userRoot,
    samMode: 'sam',
    installedAt: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(userRoot, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  log('phase', '安装完成。桌面壳将尝试重启本机伴侣以加载 SamLocal。');
}

main().catch((e) => {
  log('error', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
