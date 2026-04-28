/**
 * 与 `local-companion` HTTP JSON 对齐的占位类型（已决：P1 前手写维护，见 docs/本地伴侣-待决策清单与建议.md §8）。
 * 实现演进时请同步本文件与 docs/附录-伴侣错误码.md。
 */

export type CompanionProtocolVersion = 1;

export type CompanionCapabilitiesV1 = {
  protocolVersion: CompanionProtocolVersion;
  companion: { semver: string; package?: string };
  plugins: Array<{
    id: string;
    displayName: string;
    role: string;
    semver: string;
    enabled: boolean;
    health: string;
  }>;
  compute: Record<string, unknown>;
  storage: Record<string, unknown>;
  relay: Record<string, unknown>;
  /** `local-companion`：访问策略摘要（`accessGate`） */
  access?: {
    originAllowlistEnabled: boolean;
    originAllowlistEntries: string[];
    bearerRequired: boolean;
  };
};

export type CompanionHealthV1 = {
  ok: boolean;
  service?: string;
  time?: string;
};

export type CompanionProbeError = {
  ok: false;
  error?: string;
  code?: string;
};
