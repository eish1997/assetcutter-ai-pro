import type { ConnectorRegistry } from "../core/plugin-runtime/connectorRegistry.js";

/** 与 `docs/本地伴侣-存储与计算规范.md` 对齐的 capabilities 载荷（P0：仅 Relay 真实启用） */
export const COMPANION_SEMVER = "0.1.0";

export type CompanionCapabilitiesV1 = {
  protocolVersion: 1;
  companion: { id: string; version: string };
  plugins: Array<{
    id: "relay.site_automation";
    version: string;
    connectors: Array<{ id: string; version: string }>;
  }>;
  storage: { enabled: boolean; layoutVersion?: number; reason?: string };
  compute: { enabled: boolean; adapters?: string[]; reason?: string };
};

export function buildCompanionCapabilities(registry: ConnectorRegistry): CompanionCapabilitiesV1 {
  return {
    protocolVersion: 1,
    companion: { id: "assetcutter.companion", version: COMPANION_SEMVER },
    plugins: [
      {
        id: "relay.site_automation",
        version: COMPANION_SEMVER,
        connectors: registry.list().map((c) => ({ id: c.id, version: c.version })),
      },
    ],
    storage: { enabled: false, reason: "not_implemented_in_local_bridge" },
    compute: { enabled: false, reason: "not_implemented_in_local_bridge" },
  };
}
