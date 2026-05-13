/**
 * remove_bg：从 Volume 读图，调用本机 Python rembg，写回 RGBA PNG。
 * 需本机安装：`pip install "rembg[cpu]"`（或 gpu/rocm 变体）。
 * 可选环境变量 `COMPANION_REMBG_PYTHON`：python 可执行文件路径（须已安装 rembg）。
 * 桌面壳注入 `COMPANION_SANDBOX_ROOT` 时，默认将 rembg 权重目录设为 `<沙盒>/models/rembg`（经 `U2NET_HOME`）；可覆盖为 `COMPANION_REMBG_MODELS_DIR`。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { putAsset, readAssetObjectBytes } from '../storage/assetBlob.js';

export const REMBG_ADAPTER_ID = 'remove_bg@v1';

/** 与 `types.CustomAppModule.companionRembgModel` 白名单一致（缺省 u2net） */
const ALLOWED_MODELS = new Set([
  'u2net',
  'u2netp',
  'u2net_human_seg',
  'silueta',
  'isnet-general-use',
  'isnet-anime',
  'birefnet-general',
  'birefnet-general-lite',
  'birefnet-portrait',
]);

export type RembgResolvedInput = {
  imageKey: string;
  outputKey: string;
  model: string;
  alphaMatting: boolean;
};

function isNonEmptyKey(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

function rembgTimeoutMs(): number {
  const raw = process.env.COMPANION_REMBG_TIMEOUT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 600_000;
  return Number.isFinite(n) && n >= 30_000 && n <= 1_800_000 ? n : 600_000;
}

function pythonExecutable(): string {
  return (process.env.COMPANION_REMBG_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')).trim();
}

/** rembg 下载的 onnx 权重等；与桌面壳沙盒 `models/rembg` 对齐 */
function rembgModelDirForChildEnv(): string {
  const explicit = process.env.COMPANION_REMBG_MODELS_DIR?.trim();
  if (explicit) return explicit;
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return join(sb, 'models', 'rembg');
  return '';
}

const RUNNER_PY = `import sys
from pathlib import Path

def main() -> None:
    # argv: [脚本路径, in_path, out_path, model, am]
    if len(sys.argv) < 5:
        print("usage: run.py in_path out_path model am", file=sys.stderr)
        sys.exit(2)
    inp, outp, model, am_s = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    alpha = am_s == "1"
    try:
        from rembg import remove, new_session
    except ImportError as e:
        print(str(e), file=sys.stderr)
        sys.exit(91)
    data = Path(inp).read_bytes()
    out = remove(data, session=new_session(model), alpha_matting=alpha)
    Path(outp).write_bytes(out)

if __name__ == "__main__":
    main()
`;

function inputExtForBytes(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP')
    return '.webp';
  return '.bin';
}

function spawnPythonRembg(
  pyExe: string,
  scriptPath: string,
  inPath: string,
  outPath: string,
  model: string,
  alphaMatting: boolean,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
    const modelDir = rembgModelDirForChildEnv();
    if (modelDir) childEnv.U2NET_HOME = modelDir;
    const child = spawn(
      pyExe,
      [scriptPath, inPath, outPath, model, alphaMatting ? '1' : '0'],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: childEnv,
      },
    );
    let stderr = '';
    const cap = 12_000;
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > cap) stderr = stderr.slice(-cap);
    });
    const t = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
    }, rembgTimeoutMs());
    child.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

export function resolveRembgKeys(
  projectId: string | undefined,
  inputs: unknown,
  params: unknown,
): { ok: RembgResolvedInput } | { error: string; code: string } {
  if (!projectId?.trim()) {
    return { error: 'remove_bg requires projectId', code: 'COMPUTE_BAD_JOB' };
  }
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return { error: 'remove_bg inputs must be object', code: 'COMPUTE_BAD_JOB' };
  }
  const ins = inputs as Record<string, unknown>;
  if (!isNonEmptyKey(ins.imageKey) || !isNonEmptyKey(ins.outputKey)) {
    return { error: 'remove_bg requires inputs.imageKey and inputs.outputKey', code: 'COMPUTE_BAD_JOB' };
  }
  const p =
    params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  let model = typeof p.model === 'string' ? p.model.trim() : '';
  if (!model) model = 'u2net';
  if (!ALLOWED_MODELS.has(model)) {
    return { error: `remove_bg: unsupported model "${model}"`, code: 'COMPUTE_BAD_JOB' };
  }
  const alphaMatting = p.alphaMatting === true;
  return {
    ok: {
      imageKey: ins.imageKey.trim(),
      outputKey: ins.outputKey.trim(),
      model,
      alphaMatting,
    },
  };
}

/** 仅匹配「选错模型 / session 名」类信息；勿用宽泛的 "model"（onnx 日志常含该词） */
function looksLikeRembgModelOrSessionError(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes('unknown model') ||
    s.includes('invalid session') ||
    s.includes('unsupported model') ||
    s.includes('invalid model') ||
    s.includes('no matching session') ||
    (s.includes('valueerror') && (s.includes('session') || s.includes('model_name') || s.includes('model name')))
  );
}

function classifyRembgFailure(stderr: string, exitCode: number | null): { code: string; message: string } {
  const s = stderr.toLowerCase();
  if (
    s.includes('modulenotfounderror') ||
    s.includes('no module named') ||
    s.includes('importerror') ||
    exitCode === 91
  ) {
    return {
      code: 'COMPUTE_REMBG_NOT_INSTALLED',
      message: 'rembg 未安装：请在当前 Python 环境中执行 pip install "rembg[cpu]"（或 rembg[gpu]），并设置 COMPANION_REMBG_PYTHON 指向该解释器。',
    };
  }
  if (looksLikeRembgModelOrSessionError(stderr)) {
    return { code: 'COMPUTE_REMBG_MODEL', message: stderr.trim().slice(0, 1200) || 'rembg model/session error' };
  }
  return {
    code: 'COMPUTE_REMBG_FAILED',
    message: stderr.trim().slice(0, 2000) || `rembg exited with code ${exitCode ?? '?'}`,
  };
}

export async function runRembgJob(
  projectId: string,
  resolved: RembgResolvedInput,
): Promise<{ ok: true; outputKey: string; bytesOut: number } | { error: string; code: string }> {
  const img = readAssetObjectBytes(projectId, resolved.imageKey);
  if (!('ok' in img && img.ok)) {
    const e = img as { error: string; code: string };
    return { error: e.error, code: e.code };
  }

  const pyExe = pythonExecutable();
  const dir = mkdtempSync(join(tmpdir(), 'ac-rembg-'));
  const ext = inputExtForBytes(img.body);
  const inPath = join(dir, `in${ext}`);
  const outPath = join(dir, 'out.png');
  const scriptPath = join(dir, 'runner.py');
  try {
    writeFileSync(inPath, img.body);
    writeFileSync(scriptPath, RUNNER_PY, 'utf8');

    let run: { code: number | null; stderr: string };
    try {
      run = await spawnPythonRembg(pyExe, scriptPath, inPath, outPath, resolved.model, resolved.alphaMatting);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isEnoent = /ENOENT|spawn .* ENOENT/i.test(msg) || msg.toLowerCase().includes('enoent');
      return {
        error: isEnoent
          ? `无法启动 Python（${pyExe}）。请安装 Python 3.11+ 并设置环境变量 COMPANION_REMBG_PYTHON 为可执行文件路径。`
          : msg,
        code: isEnoent ? 'COMPUTE_REMBG_PYTHON_NOT_FOUND' : 'COMPUTE_REMBG_FAILED',
      };
    }

    if (run.code !== 0) {
      const mapped = classifyRembgFailure(run.stderr, run.code);
      return { error: mapped.message, code: mapped.code };
    }

    let outBuf: Buffer;
    try {
      outBuf = readFileSync(outPath);
    } catch {
      return { error: '未找到 rembg 输出 PNG', code: 'COMPUTE_REMBG_FAILED' };
    }

    if (outBuf.length === 0) {
      return { error: run.stderr.trim() || 'rembg 输出为空', code: 'COMPUTE_REMBG_FAILED' };
    }

    putAsset(projectId, resolved.outputKey, outBuf, 'image/png');
    return { ok: true, outputKey: resolved.outputKey, bytesOut: outBuf.length };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const REMBG_IMPORT_PROBE_TIMEOUT_MS = 8000;

export type RembgHealthProbeResult = {
  ok: boolean;
  pythonExecutable: string;
  latencyMs: number;
  exitCode?: number | null;
  error?: string;
  code?: string;
};

/** 子进程级轻量探测：`import rembg`（不跑推理；供 runtime-status / 调试接口） */
export async function probeRembgPythonHealth(): Promise<RembgHealthProbeResult> {
  const pyExe = pythonExecutable();
  const t0 = Date.now();
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
  const modelDir = rembgModelDirForChildEnv();
  if (modelDir) childEnv.U2NET_HOME = modelDir;

  return await new Promise<RembgHealthProbeResult>((resolve) => {
    const child = spawn(pyExe, ['-c', 'import rembg'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: childEnv,
    });
    let stderr = '';
    const cap = 4000;
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > cap) stderr = stderr.slice(-cap);
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
    }, REMBG_IMPORT_PROBE_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        pythonExecutable: pyExe,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
        code: 'REMBG_PROBE_SPAWN_ERROR',
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - t0;
      if (code === 0) {
        resolve({ ok: true, pythonExecutable: pyExe, latencyMs });
        return;
      }
      const mapped = classifyRembgFailure(stderr, code);
      resolve({
        ok: false,
        pythonExecutable: pyExe,
        latencyMs,
        exitCode: code,
        error: mapped.message.slice(0, 1200),
        code: mapped.code,
      });
    });
  });
}
