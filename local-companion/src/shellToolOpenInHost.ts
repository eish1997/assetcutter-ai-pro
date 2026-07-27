/**
 * Open a shell-tool plugin UI inside a running DCC host (Maya Command Port first).
 * @see docs/本地伴侣-Maya工具页注入.md
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  probeMayaCommandPort,
  runMayaScriptJob,
} from './scriptRun/mayaScriptAdapter.js';
import { enqueueMayaScriptJob } from './scriptRun/mayaScriptJobQueue.js';
import { getShellToolExtractedRoot, getShellToolDetail } from './shellToolBundles.js';
import type { ShellToolMayaSpecV1, ShellToolSpecV1 } from './shellToolSpec.js';

export type OpenInHostBody = {
  host?: string;
  mayaHost?: string;
  mayaPort?: number | string;
};

export type OpenInHostResult =
  | { ok: true; host: 'maya'; message: string; stdout?: string }
  | { ok: false; error: string; message: string; code?: string };

function forwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function resolveMayaPaths(
  extractedRoot: string,
  maya: ShellToolMayaSpecV1,
): { roots: string[]; entryModule: string; entryFunc: string } {
  const roots: string[] = [];
  const relPaths = maya.pythonPath?.length ? maya.pythonPath : ['.'];
  for (const rel of relPaths) {
    const cleaned = String(rel || '.').replace(/\\/g, '/').replace(/^\//, '');
    if (cleaned.includes('..')) continue;
    const abs = resolve(extractedRoot, cleaned === '' ? '.' : cleaned);
    if (existsSync(abs) && !roots.includes(abs)) roots.push(abs);
  }
  if (roots.length === 0) roots.push(resolve(extractedRoot));
  return {
    roots,
    entryModule: maya.entryModule,
    entryFunc: maya.entryFunc,
  };
}

/** Bootstrap must define run(params) for mayaScriptAdapter wrapper. */
export function buildMayaOpenBootstrap(input: {
  roots: string[];
  entryModule: string;
  entryFunc: string;
}): string {
  const rootsLiteral = input.roots.map((r) => JSON.stringify(forwardSlashes(r))).join(', ');
  const mod = JSON.stringify(input.entryModule);
  const fn = JSON.stringify(input.entryFunc);
  return [
    'def run(params):',
    '    import sys',
    '    import importlib',
    `    _roots = [${rootsLiteral}]`,
    '    for _root in _roots:',
    '        if _root in sys.path:',
    '            sys.path.remove(_root)',
    '        sys.path.insert(0, _root)',
    `    _mod_name = ${mod}`,
    `    _fn_name = ${fn}`,
    '    _mod = importlib.import_module(_mod_name)',
    '    try:',
    '        importlib.reload(_mod)',
    '    except Exception:',
    '        pass',
    '    _fn = getattr(_mod, _fn_name, None)',
    '    if not callable(_fn):',
    '        raise RuntimeError("Maya entry %s.%s is not callable" % (_mod_name, _fn_name))',
    '    _fn()',
    '',
  ].join('\n');
}

function runMayaScriptJobSerialized(
  inputs: unknown,
  params: unknown,
): Promise<{ ok: true; stdout: string } | { error: string; code: string; stdout?: string }> {
  return new Promise((resolvePromise) => {
    enqueueMayaScriptJob(async () => {
      resolvePromise(await runMayaScriptJob(inputs, params));
    });
  });
}

function parseMayaPort(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  return fallback;
}

export async function openShellToolInHost(
  toolId: string,
  body?: OpenInHostBody,
): Promise<OpenInHostResult> {
  const detail = await getShellToolDetail(toolId);
  if (!detail) {
    return { ok: false, error: 'tool_not_found', message: '未找到该工具（可能已卸载）' };
  }

  const tool: ShellToolSpecV1 = detail.tool;
  const host = String(body?.host || 'maya').trim().toLowerCase() || 'maya';
  if (host !== 'maya') {
    return {
      ok: false,
      error: 'host_unsupported',
      message: `暂不支持宿主：${host}`,
      code: 'HOST_UNSUPPORTED',
    };
  }

  if (!tool.permissions.includes('host.open')) {
    return { ok: false, error: 'permission_denied', message: '缺少 host.open 权限' };
  }
  if (!tool.maya) {
    return {
      ok: false,
      error: 'maya_not_configured',
      message: 'tool.json 未配置 maya 入口',
      code: 'MAYA_NOT_CONFIGURED',
    };
  }

  const extractedRoot = getShellToolExtractedRoot(toolId);
  if (!extractedRoot || !existsSync(extractedRoot)) {
    return { ok: false, error: 'tool_not_found', message: '工具包目录不存在' };
  }

  const resolved = resolveMayaPaths(extractedRoot, tool.maya);
  const defaultHost = String(process.env.COMPANION_MAYA_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const defaultPort = parseMayaPort(process.env.COMPANION_MAYA_PORT, 7001);
  const mayaHost =
    typeof body?.mayaHost === 'string' && body.mayaHost.trim() ? body.mayaHost.trim() : defaultHost;
  const mayaPort = parseMayaPort(body?.mayaPort, defaultPort);

  const probe = await probeMayaCommandPort(mayaHost, mayaPort, 8000);
  if (!probe.ok) {
    return {
      ok: false,
      error: 'maya_not_connected',
      message:
        probe.message +
        '。请先打开 Maya，并启用 Python Command Port（默认 127.0.0.1:7001）。',
      code: 'MAYA_NOT_CONNECTED',
    };
  }

  const content = buildMayaOpenBootstrap(resolved);
  const result = await runMayaScriptJobSerialized(
    {
      content,
      maya: { host: mayaHost, port: mayaPort },
      timeoutMs: 60_000,
    },
    {},
  );

  if ('error' in result) {
    return {
      ok: false,
      error: result.code || 'maya_runtime_error',
      message: result.error,
      code: result.code,
    };
  }

  return {
    ok: true,
    host: 'maya',
    message: `已在 Maya（${mayaHost}:${mayaPort}）中打开 ${tool.name}`,
    stdout: result.stdout,
  };
}
