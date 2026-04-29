/**
 * 按已安装宿主插件包内 extracted/run.json 的 exec / probe 启动子进程。
 * 命令行仅来自磁盘上的 run.json，请求体只能指定 inputs.dirName（host-bundles 下目录名）。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { readHostBundleRunSpecSync } from '../hostBundleRunSpec.js';
import { ensureRepositoryRoot } from '../repositoryVolume.js';

export const HOST_BUNDLE_ADAPTER_ID = 'host_bundle@v0.1.0';

const CAP_OUT = 64 * 1024;

function bundlesRoot(): string {
  return join(ensureRepositoryRoot(), 'host-bundles');
}

/** 与落盘目录名一致：仅单段安全名 */
function assertSafeBundleDirName(name: string): string | null {
  const s = name.trim();
  if (!s || s.length > 64 || s.startsWith('.')) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return null;
  return s;
}

function execTimeoutMs(): number {
  const raw = process.env.COMPANION_HOST_BUNDLE_EXEC_TIMEOUT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 300_000;
  return Number.isFinite(n) && n >= 1000 && n <= 3_600_000 ? n : 300_000;
}

function readBundleManifest(bundlePath: string): { extractedRelativeDir?: string; kind?: string } | null {
  try {
    const p = join(bundlePath, 'manifest.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as { extractedRelativeDir?: string; kind?: string };
  } catch {
    return null;
  }
}

function resolveWorkDir(bundlePath: string, cwdRel: string | undefined): { ok: string } | { error: string } {
  const manifest = readBundleManifest(bundlePath);
  if (!manifest || manifest.kind !== 'host_plugin_bundle') {
    return { error: '无效的 manifest.json' };
  }
  const relDir = manifest.extractedRelativeDir || 'extracted';
  const extractedRoot = join(bundlePath, relDir);
  if (!existsSync(extractedRoot)) {
    return { error: '包内无 extracted 目录，无法执行 run.json' };
  }
  const sub = (cwdRel && cwdRel.trim() !== '' ? cwdRel.trim() : '.') || '.';
  const target = sub === '.' ? extractedRoot : join(extractedRoot, sub);
  const resolved = resolve(target);
  const er = resolve(extractedRoot);
  if (resolved !== er && !resolved.startsWith(er + sep)) {
    return { error: 'cwd 超出 extracted 根目录' };
  }
  return { ok: resolved };
}

function mergeEnv(base: NodeJS.ProcessEnv, extra?: Record<string, string>): NodeJS.ProcessEnv {
  if (!extra || Object.keys(extra).length === 0) return { ...base };
  return { ...base, ...extra };
}

function appendCap(buf: string, chunk: string): string {
  const next = buf + chunk;
  if (next.length <= CAP_OUT) return next;
  return `${next.slice(0, CAP_OUT)}\n…[truncated ${next.length - CAP_OUT} chars]`;
}

function runSpawn(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolveP, rejectP) => {
    let child: ChildProcess;
    try {
      child = spawn(command[0]!, command.slice(1), {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      rejectP(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const out = child.stdout;
    const err = child.stderr;
    if (!out || !err) {
      rejectP(new Error('stdio pipe 不可用'));
      return;
    }

    let stdout = '';
    let stderr = '';
    out.setEncoding('utf8');
    err.setEncoding('utf8');
    out.on('data', (c: string) => {
      stdout = appendCap(stdout, c);
    });
    err.on('data', (c: string) => {
      stderr = appendCap(stderr, c);
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 2000).unref?.();
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      rejectP(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveP({ exitCode: code, signal, stdout, stderr });
    });
  });
}

export async function runHostBundlePhase(input: {
  phase: 'exec' | 'probe';
  inputs: unknown;
}): Promise<
  | {
      ok: {
        bundleDir: string;
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
      };
    }
  | { error: string; code: string }
> {
  if (!input.inputs || typeof input.inputs !== 'object' || Array.isArray(input.inputs)) {
    return { error: 'inputs 须为对象且含 dirName', code: 'COMPUTE_BAD_JOB' };
  }
  const dirRaw = (input.inputs as { dirName?: string }).dirName;
  const dirName = typeof dirRaw === 'string' ? assertSafeBundleDirName(dirRaw) : null;
  if (!dirName) {
    return { error: 'inputs.dirName 无效（须为 host-bundles 下目录名，仅字母数字 ._-）', code: 'COMPUTE_BAD_JOB' };
  }
  const bundlePath = join(bundlesRoot(), dirName);
  if (!existsSync(join(bundlePath, 'manifest.json'))) {
    return { error: `未找到宿主包目录: ${dirName}`, code: 'COMPUTE_BAD_JOB' };
  }

  const runSpec = readHostBundleRunSpecSync(bundlePath);
  const block = input.phase === 'exec' ? runSpec?.exec : runSpec?.probe;
  if (!runSpec || !block) {
    return {
      error: `run.json 缺少 ${input.phase} 段或无法解析`,
      code: 'COMPUTE_BAD_JOB',
    };
  }

  const wd = resolveWorkDir(bundlePath, block.cwd);
  if ('error' in wd) {
    return { error: wd.error, code: 'COMPUTE_BAD_JOB' };
  }

  const cmd = block.command;
  if (!cmd.length) {
    return { error: 'command 为空', code: 'COMPUTE_BAD_JOB' };
  }

  try {
    const env = mergeEnv(process.env, block.env);
    const out = await runSpawn(cmd, wd.ok, env, execTimeoutMs());
    return {
      ok: {
        bundleDir: dirName,
        exitCode: out.exitCode,
        signal: out.signal,
        stdout: out.stdout,
        stderr: out.stderr,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `子进程启动失败: ${msg}`, code: 'HOST_BUNDLE_SPAWN_FAILED' };
  }
}
