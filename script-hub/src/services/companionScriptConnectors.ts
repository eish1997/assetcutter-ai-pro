import { companionFetchJson } from '../../../services/companionClient/fetch';
import { companionWorkbenchBase } from './companionWorkbenchClient';

export type ScriptConnectorsResponse = {
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

export async function fetchScriptConnectors(params?: {
  mayaHost?: string;
  mayaPort?: number;
  /** 绕过伴侣端「仅成功」短缓存，立即重探测 */
  bustCache?: boolean;
}): Promise<ScriptConnectorsResponse> {
  const q = new URLSearchParams();
  if (params?.mayaHost) q.set('mayaHost', params.mayaHost);
  if (params?.mayaPort != null && Number.isFinite(params.mayaPort)) q.set('mayaPort', String(params.mayaPort));
  if (params?.bustCache) q.set('bustCache', '1');
  const qs = q.toString();
  const path = qs ? `/v1/script-connectors?${qs}` : '/v1/script-connectors';
  const res = await companionFetchJson<ScriptConnectorsResponse>(companionWorkbenchBase(), path, { method: 'GET' });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
