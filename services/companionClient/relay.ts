/**
 * Relay M1：从宿主 `/v1/capabilities` 读取 `relay` 切片（与 `local-bridge` 子进程等对齐），不直连 WSS。
 */

import { companionFetchJson } from './fetch';

export type CompanionRelayCapabilityV1 = {
  enabled?: boolean;
  configured?: boolean;
  supervisor?: {
    running?: boolean;
    configured?: boolean;
    pid?: number | null;
    childHttpPortPolicy?: string;
  };
  connectors?: unknown[];
  note?: string;
};

export async function probeRelayFromCapabilities(baseUrl: string) {
  const r = await companionFetchJson<Record<string, unknown>>(baseUrl, '/v1/capabilities');
  if (!r.ok) return r;
  const relay = (r.data.relay ?? null) as CompanionRelayCapabilityV1 | null;
  return { ok: true as const, data: { relay }, latencyMs: r.latencyMs, status: r.status };
}
