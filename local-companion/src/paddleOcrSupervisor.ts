import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let paddleProc: ChildProcess | null = null;
let paddleLastExitCode: number | null = null;
let paddleLastSignal: NodeJS.Signals | null = null;
let paddleLastError: string | null = null;
let paddleLastUpdatedAt: string | null = null;

export function paddleOcrServiceDir(): string {
  const explicit = process.env.COMPANION_PADDLEOCR_SERVICE_DIR?.trim();
  if (explicit) return explicit;
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, 'paddleocr-service');
  if (existsSync(join(bundled, 'server.py'))) return bundled;
  const dev = join(here, '..', 'paddleocr-service');
  if (existsSync(join(dev, 'server.py'))) return dev;
  return dev;
}

export function paddleOcrServerScriptPath(): string {
  const explicit = process.env.COMPANION_PADDLEOCR_SERVER_SCRIPT?.trim();
  if (explicit) return explicit;
  return join(paddleOcrServiceDir(), 'server.py');
}

function paddleOcrPort(): number {
  const raw = process.env.COMPANION_PADDLEOCR_PORT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 18082;
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : 18082;
}

function pythonExecutable(): string {
  return (
    process.env.COMPANION_PADDLEOCR_PYTHON?.trim() ||
    process.env.COMPANION_REMBG_PYTHON?.trim() ||
    (process.platform === 'win32' ? 'python' : 'python3')
  ).trim();
}

function buildDefaultSpawnCmd(): string | null {
  const py = pythonExecutable();
  const script = paddleOcrServerScriptPath();
  if (!existsSync(script)) return null;
  return `"${py}" "${script}"`;
}

function resolveSpawnCmd(): string | null {
  const explicit = process.env.COMPANION_SPAWN_PADDLEOCR_CMD?.trim();
  if (explicit) return explicit;
  return buildDefaultSpawnCmd();
}

function killProcessListeningOnPort(port: number): void {
  if (process.platform !== 'win32') return;
  try {
    execSync(
      `powershell -NoProfile -Command "$pids = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($pid in $pids) { if ($pid) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } }"`,
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {
    /* ignore */
  }
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='python.exe'\\" | Where-Object { $_.CommandLine -like '*paddleocr-service*server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {
    /* ignore */
  }
}

function paddleOcrChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
  env.COMPANION_PADDLEOCR_PORT = String(paddleOcrPort());
  env.FLAGS_use_mkldnn = '0';
  const device = (process.env.COMPANION_PADDLEOCR_DEVICE?.trim() || 'cpu').toLowerCase();
  env.COMPANION_PADDLEOCR_DEVICE = device === 'gpu' ? 'gpu' : 'cpu';
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  const explicitModels = process.env.COMPANION_PADDLEOCR_MODELS_DIR?.trim();
  if (explicitModels) {
    env.COMPANION_PADDLEOCR_MODELS_DIR = explicitModels;
  } else if (sb) {
    env.COMPANION_PADDLEOCR_MODELS_DIR = join(sb, 'models', 'paddleocr');
  }
  return env;
}

/**
 * 若配置了 `COMPANION_SPAWN_PADDLEOCR_CMD`，或存在 `COMPANION_PADDLEOCR_PYTHON` + server.py，
 * 在伴侣 HTTP 启动后拉起 PaddleOCR 常驻服务（默认 127.0.0.1:18082）。
 */
export function startPaddleOcrIfConfigured(): void {
  const cmd = resolveSpawnCmd();
  if (!cmd) return;
  const port = paddleOcrPort();
  stopPaddleOcrChild();
  killProcessListeningOnPort(port);
  if (paddleProc && paddleProc.exitCode === null && !paddleProc.killed) return;

  const cwd = process.env.COMPANION_SPAWN_PADDLEOCR_CWD?.trim() || paddleOcrServiceDir();

  try {
    paddleProc = spawn(cmd, [], {
      shell: true,
      stdio: 'inherit',
      env: paddleOcrChildEnv(),
      windowsHide: false,
      ...(cwd && existsSync(cwd) ? { cwd } : {}),
    });
    paddleLastError = null;
    paddleLastUpdatedAt = new Date().toISOString();
  } catch (e) {
    console.error('[local-companion] PaddleOCR 服务启动失败', e);
    paddleLastError = e instanceof Error ? e.message : String(e);
    paddleLastUpdatedAt = new Date().toISOString();
    paddleProc = null;
    return;
  }

  paddleProc.on('exit', (code, signal) => {
    console.log(`[local-companion] PaddleOCR 子进程退出 code=${code} signal=${signal ?? ''}`);
    paddleLastExitCode = code ?? null;
    paddleLastSignal = signal ?? null;
    paddleLastUpdatedAt = new Date().toISOString();
    paddleProc = null;
  });
  paddleProc.on('error', (err) => {
    console.error('[local-companion] PaddleOCR 子进程错误', err);
    paddleLastError = err instanceof Error ? err.message : String(err);
    paddleLastUpdatedAt = new Date().toISOString();
    paddleProc = null;
  });
  console.log(`[local-companion] 已拉起 PaddleOCR 服务（port=${paddleOcrPort()} device=${paddleOcrChildEnv().COMPANION_PADDLEOCR_DEVICE}）`);
}

export type PaddleOcrSupervisorStatus = {
  configured: boolean;
  running: boolean;
  pid?: number;
  serviceUrl: string;
  device: string;
  lastExitCode: number | null;
  lastSignal: NodeJS.Signals | null;
  lastError: string | null;
  lastUpdatedAt: string | null;
};

export function getPaddleOcrSupervisorStatus(): PaddleOcrSupervisorStatus {
  const configured = Boolean(resolveSpawnCmd());
  const running = paddleProc != null && paddleProc.exitCode === null && !paddleProc.killed;
  const port = paddleOcrPort();
  const device = (process.env.COMPANION_PADDLEOCR_DEVICE?.trim() || 'cpu').toLowerCase();
  return {
    configured,
    running,
    pid: running && paddleProc?.pid != null ? paddleProc.pid : undefined,
    serviceUrl: `http://127.0.0.1:${port}`,
    device: device === 'gpu' ? 'gpu' : 'cpu',
    lastExitCode: paddleLastExitCode,
    lastSignal: paddleLastSignal,
    lastError: paddleLastError,
    lastUpdatedAt: paddleLastUpdatedAt,
  };
}

export function stopPaddleOcrChild(): void {
  if (paddleProc && !paddleProc.killed) {
    try {
      paddleProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    paddleProc = null;
  }
}

export function getPaddleOcrServiceUrl(): string {
  return process.env.COMPANION_PADDLEOCR_URL?.trim() || `http://127.0.0.1:${paddleOcrPort()}`;
}
