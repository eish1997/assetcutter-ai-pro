/**
 * GET /v1/script-connectors — 聚合 Script Hub 相关本机连接器 probe（短缓存）。
 */
import { parseRuntimeProbeCacheTtlMs } from '../runtimeProbeCacheTtl.js';
import { MAYA_SCRIPT_ADAPTER_ID, probeMayaCommandPort } from './mayaScriptAdapter.js';

export type ScriptConnectorsPayload = {
  protocolVersion: 1;
  probedAt: string;
  connectors: Array<{
    id: string;
    targetType: string;
    status: 'ok' | 'error' | 'skipped';
    message: string;
    host?: string;
    port?: number;
  }>;
};

type MayaOverrides = { mayaHost?: string; mayaPort?: number };

function resolveMayaEndpoint(overrides?: MayaOverrides): { host: string; port: number; cacheKey: string } {
  const host =
    (overrides?.mayaHost && String(overrides.mayaHost).trim()) ||
    String(process.env.COMPANION_MAYA_HOST || '127.0.0.1').trim() ||
    '127.0.0.1';
  const portNum = overrides?.mayaPort ?? Number(process.env.COMPANION_MAYA_PORT ?? 7001);
  const port = Number.isFinite(portNum) && Number(portNum) > 0 ? Math.floor(Number(portNum)) : 7001;
  return { host, port, cacheKey: `${host}:${port}` };
}

let cache: { key: string; at: number; body: ScriptConnectorsPayload } | null = null;

export async function buildScriptConnectorsPayload(overrides?: MayaOverrides): Promise<ScriptConnectorsPayload> {
  const ttlMs = parseRuntimeProbeCacheTtlMs();
  const { host, port, cacheKey } = resolveMayaEndpoint(overrides);
  const now = Date.now();
  if (ttlMs > 0 && cache && cache.key === cacheKey && now - cache.at < ttlMs) {
    return cache.body;
  }

  const mayaProbe = await probeMayaCommandPort(host, port, 10000);
  const body: ScriptConnectorsPayload = {
    protocolVersion: 1,
    probedAt: new Date().toISOString(),
    connectors: [
      {
        id: MAYA_SCRIPT_ADAPTER_ID,
        targetType: 'maya',
        host,
        port,
        status: mayaProbe.ok ? 'ok' : 'error',
        message: mayaProbe.message,
      },
      {
        id: 'unreal.python@v1',
        targetType: 'unreal',
        status: 'skipped',
        message: 'probe 尚未实现（Sprint 2）',
      },
    ],
  };
  if (ttlMs > 0) {
    cache = { key: cacheKey, at: now, body };
  }
  return body;
}
