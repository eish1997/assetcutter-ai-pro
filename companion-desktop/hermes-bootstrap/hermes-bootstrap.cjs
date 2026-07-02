'use strict';

/**
 * 壳内一键安装 Hermes Agent 官方版（Windows PowerShell install.ps1）。
 * 配置 OpenAI 兼容 API Server（默认 127.0.0.1:8642/v1）供伴侣 Copilot 使用。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { randomBytes } = require('node:crypto');
const { hermesEnvPath, findHermesCli } = require('../hermes-cli-resolve.cjs');

const DEFAULT_API_PORT = 8642;
const DEFAULT_API_HOST = '127.0.0.1';
const INSTALL_PS1_URL = 'https://hermes-agent.nousresearch.com/install.ps1';

function log(type, msg) {
  process.stdout.write(`${JSON.stringify({ type, msg, t: new Date().toISOString() })}\n`);
}

function upsertEnvLines(content, kv) {
  const lines = String(content || '').split(/\r?\n/);
  const keys = new Set(Object.keys(kv));
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && keys.has(m[1])) continue;
    if (line.trim()) out.push(line);
  }
  for (const [k, v] of Object.entries(kv)) {
    out.push(`${k}=${v}`);
  }
  return `${out.join('\n')}\n`;
}

async function configureApiServer(apiKey) {
  const envPath = hermesEnvPath();
  await fsp.mkdir(path.dirname(envPath), { recursive: true });
  let cur = '';
  try {
    cur = await fsp.readFile(envPath, 'utf8');
  } catch {
    /* new */
  }
  const next = upsertEnvLines(cur, {
    API_SERVER_ENABLED: 'true',
    API_SERVER_HOST: DEFAULT_API_HOST,
    API_SERVER_PORT: String(DEFAULT_API_PORT),
    API_SERVER_KEY: apiKey,
    API_SERVER_MODEL_NAME: 'hermes-agent',
  });
  await fsp.writeFile(envPath, next, 'utf8');
  return envPath;
}

async function writeState(userRoot, payload) {
  await fsp.mkdir(userRoot, { recursive: true });
  const statePath = path.join(userRoot, 'state.json');
  await fsp.writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return statePath;
}

function downloadInstallScript() {
  const ps = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `(Invoke-WebRequest -Uri '${INSTALL_PS1_URL}' -UseBasicParsing).Content`,
  ];
  const r = spawnSync('powershell.exe', ps, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000,
  });
  if (r.error) throw new Error(`下载 install.ps1 失败: ${r.error.message}`);
  if (r.status !== 0 || !r.stdout) {
    throw new Error(`下载 install.ps1 失败 exit=${r.status ?? 'null'}`);
  }
  return r.stdout;
}

function installHermesOfficial() {
  log('phase', '正在更新/安装 Hermes Agent 官方版（可能需要数分钟）…');
  const tmpDir = path.join(os.tmpdir(), 'ac-hermes-install');
  fs.mkdirSync(tmpDir, { recursive: true });
  const scriptPath = path.join(tmpDir, 'install.ps1');
  const content = downloadInstallScript();
  fs.writeFileSync(scriptPath, content, 'utf8');

  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-NonInteractive'],
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 25 * 60 * 1000,
      env: {
        ...process.env,
        HERMES_HOME: process.env.HERMES_HOME || undefined,
      },
    },
  );
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (out) log('log', out.slice(-8000));
  return { exitCode: r.status, error: r.error };
}

async function main() {
  if (process.platform !== 'win32') {
    log('error', 'Hermes 壳内一键安装当前仅支持 Windows（请在本机手动安装后使用「连接已有 Hermes」）。');
    process.exit(1);
  }

  const userRoot = String(process.env.AC_HERMES_USER_ROOT || '').trim();
  if (!userRoot) {
    log('error', '缺少 AC_HERMES_USER_ROOT');
    process.exit(1);
  }

  let cli = findHermesCli();
  if (cli) {
    log('phase', `检测到已安装的 Hermes CLI，跳过 install.ps1：${cli}`);
  } else {
    const install = installHermesOfficial();
    cli = findHermesCli();
    if (!cli) {
      const detail =
        install.error instanceof Error
          ? install.error.message
          : install.exitCode != null
            ? `install.ps1 exit=${install.exitCode}`
            : 'unknown';
      log('error', `未找到 hermes 命令（${detail}）。可手动在 PowerShell 运行：iex (irm ${INSTALL_PS1_URL})`);
      process.exit(1);
    }
    if (install.exitCode !== 0) {
      log('phase', `install.ps1 返回非零，但已找到 CLI，继续配置：${cli}`);
    }
  }

  log('phase', `已找到 Hermes CLI：${cli}`);

  const apiKey = String(process.env.AC_HERMES_API_KEY || randomBytes(24).toString('hex')).trim();
  const envPath = await configureApiServer(apiKey);
  log('phase', `已写入 API Server 配置：${envPath}`);

  const gatewayUrl = `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}/v1`;
  const state = {
    installedAt: new Date().toISOString(),
    hermesCli: cli,
    gatewayUrl,
    apiKey,
    apiServerPort: DEFAULT_API_PORT,
    apiServerHost: DEFAULT_API_HOST,
    envPath,
    hermesHome: path.dirname(envPath),
    kind: 'official',
  };
  const statePath = await writeState(userRoot, state);
  log('phase', `状态已保存：${statePath}`);
  log('phase', `安装完成，Gateway 地址：${gatewayUrl}`);
  log('bootstrap-finished', 'ok');
  process.exit(0);
}

main().catch((e) => {
  log('error', e instanceof Error ? e.message : String(e));
  log('bootstrap-finished', 'fail');
  process.exit(1);
});
