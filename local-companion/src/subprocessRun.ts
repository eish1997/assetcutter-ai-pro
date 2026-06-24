import { spawn, type ChildProcess } from 'node:child_process';

export const SUBPROCESS_OUTPUT_CAP = 64 * 1024;

function appendCap(buf: string, chunk: string): string {
  const next = buf + chunk;
  if (next.length <= SUBPROCESS_OUTPUT_CAP) return next;
  return `${next.slice(0, SUBPROCESS_OUTPUT_CAP)}\n…[truncated ${next.length - SUBPROCESS_OUTPUT_CAP} chars]`;
}

export function mergeProcessEnv(base: NodeJS.ProcessEnv, extra?: Record<string, string>): NodeJS.ProcessEnv {
  if (!extra || Object.keys(extra).length === 0) return { ...base };
  return { ...base, ...extra };
}

/** 同步等待子进程结束；超时 SIGTERM → SIGKILL */
export function runSpawnWithTimeout(
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
