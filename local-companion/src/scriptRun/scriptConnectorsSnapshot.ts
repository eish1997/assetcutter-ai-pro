/**
 * GET /v1/script-connectors — 聚合 Script Hub 相关本机连接器 probe（仅缓存成功结果）。
 */
import { hasActiveScriptMayaJob } from '../compute/jobsStore.js';
import { MAYA_SCRIPT_ADAPTER_ID, probeMayaCommandPort } from './mayaScriptAdapter.js';
import { parseScriptConnectorsCacheTtlMs } from './scriptConnectorsCacheTtl.js';
import {
  invalidateScriptConnectorsCache,
  readScriptConnectorsSuccessCache,
  writeScriptConnectorsSuccessCache,
} from './scriptConnectorsSuccessCache.js';

export type ScriptConnectorsPayload = {
  protocolVersion: 1;
  probedAt: string;
  connectors: Array<{
    id: string;
    targetType: string;
    status: 'ok' | 'error' | 'skipped' | 'occupied';
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

function buildMayaOccupiedPayload(overrides?: MayaOverrides): ScriptConnectorsPayload {
  const { host, port } = resolveMayaEndpoint(overrides);
  return {
    protocolVersion: 1,
    probedAt: new Date().toISOString(),
    connectors: [
      {
        id: MAYA_SCRIPT_ADAPTER_ID,
        targetType: 'maya',
        host,
        port,
        status: 'occupied',
        message:
          'Maya 正执行 script.maya（Command Port 单连接；执行期间探针会误报，属正常）',
      },
      {
        id: 'unreal.python@v1',
        targetType: 'unreal',
        status: 'skipped',
        message: 'probe 尚未实现（Sprint 2）',
      },
    ],
  };
}

export async function buildScriptConnectorsPayload(
  overrides?: MayaOverrides & { bustCache?: boolean },
): Promise<ScriptConnectorsPayload> {
  const ttlMs = parseScriptConnectorsCacheTtlMs();
  const { host, port, cacheKey } = resolveMayaEndpoint(overrides);
  const bust = Boolean(overrides?.bustCache);

  if (hasActiveScriptMayaJob()) {
    if (!bust) {
      const hit = readScriptConnectorsSuccessCache(cacheKey, ttlMs, Date.now(), false);
      if (hit != null) return hit as ScriptConnectorsPayload;
    }
    return buildMayaOccupiedPayload(overrides);
  }

  const now = Date.now();
  const hit = readScriptConnectorsSuccessCache(cacheKey, ttlMs, now, bust);
  if (hit != null) {
    return hit as ScriptConnectorsPayload;
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
  if (ttlMs > 0 && mayaProbe.ok) {
    writeScriptConnectorsSuccessCache(cacheKey, now, body);
  } else {
    invalidateScriptConnectorsCache();
  }
  return body;
}
