import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeProcessEnv, runSpawnWithTimeout } from './subprocessRun.js';
import {
  getShellToolExtractedRoot,
  getShellToolDetail,
  resolveExtractedWorkDir,
} from './shellToolBundles.js';
import { buildShellToolParamEnv, type ShellToolPanelSpecV1 } from './shellToolSpec.js';

const DEFAULT_RUN_TIMEOUT_MS = 600_000;

export type ShellToolRunResult =
  | {
      ok: true;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }
  | { ok: false; error: string };

function runTimeoutMs(toolTimeout?: number): number {
  if (toolTimeout !== undefined) {
    const n = Math.floor(toolTimeout);
    if (n >= 1000 && n <= 3_600_000) return n;
  }
  return DEFAULT_RUN_TIMEOUT_MS;
}

function collectFieldIds(panel: ShellToolPanelSpecV1): Map<string, { required?: boolean; type: string }> {
  const m = new Map<string, { required?: boolean; type: string }>();
  for (const sec of panel.sections) {
    for (const f of sec.fields) {
      m.set(f.id, { required: f.required, type: f.type });
    }
  }
  return m;
}

function normalizeParams(
  panel: ShellToolPanelSpecV1,
  raw: unknown,
): { ok: Record<string, string | boolean> } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'invalid_params' };
  }
  const input = raw as Record<string, unknown>;
  const fields = collectFieldIds(panel);
  const out: Record<string, string | boolean> = {};

  for (const [id, meta] of fields) {
    const v = input[id];
    if (v === undefined || v === null || v === '') {
      if (meta.required) return { error: 'invalid_params' };
      continue;
    }
    if (meta.type === 'toggle') {
      if (typeof v !== 'boolean') return { error: 'invalid_params' };
      out[id] = v;
      continue;
    }
    if (typeof v !== 'string') return { error: 'invalid_params' };
    if (meta.type === 'path') {
      const abs = resolve(v);
      if (!existsSync(abs)) return { error: 'invalid_params' };
      out[id] = abs;
    } else {
      out[id] = v;
    }
  }

  for (const key of Object.keys(input)) {
    if (key === 'command' || key === 'actionId') continue;
    if (!fields.has(key)) {
      /* ignore unknown keys */
    }
  }

  return { ok: out };
}

export async function runShellTool(input: {
  toolId: string;
  actionId?: string;
  params?: unknown;
}): Promise<ShellToolRunResult> {
  const detail = await getShellToolDetail(input.toolId);
  if (!detail) return { ok: false, error: 'tool_not_found' };
  if (!detail.tool.permissions.includes('tool.run')) {
    return { ok: false, error: 'permission_denied' };
  }
  const run = detail.tool.run;
  if (!run) return { ok: false, error: 'run_not_configured' };

  const actionId = typeof input.actionId === 'string' ? input.actionId.trim() : '';
  if (actionId) {
    const action = detail.panel.actions.find((a) => a.id === actionId);
    if (!action) return { ok: false, error: 'invalid_params' };
    if (action.kind !== 'run') return { ok: false, error: 'permission_denied' };
  }

  const norm = normalizeParams(detail.panel, input.params ?? {});
  if ('error' in norm) return { ok: false, error: norm.error };

  const extractedRoot = getShellToolExtractedRoot(detail.id);
  if (!extractedRoot) return { ok: false, error: 'tool_not_found' };

  let cwd: string;
  try {
    cwd = resolveExtractedWorkDir(extractedRoot, run.cwd);
  } catch {
    return { ok: false, error: 'run_not_configured' };
  }

  const paramEnv = buildShellToolParamEnv(norm.ok);
  const env = mergeProcessEnv(process.env, paramEnv);
  const cmd = run.command;
  if (!cmd.length) return { ok: false, error: 'run_not_configured' };

  try {
    const out = await runSpawnWithTimeout(cmd, cwd, env, runTimeoutMs(run.timeoutMs));
    return {
      ok: true,
      exitCode: out.exitCode,
      signal: out.signal,
      stdout: out.stdout,
      stderr: out.stderr,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ETIMEDOUT') || msg.includes('SIGTERM')) {
      return { ok: false, error: 'run_timeout' };
    }
    return { ok: false, error: `run_failed: ${msg}` };
  }
}
