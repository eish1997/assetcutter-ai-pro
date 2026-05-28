/**
 * 运营侧模型策略（可由远端 JSON 覆盖，见 opsConfig.ts）。
 * `imageRegistryAllowlist === null | undefined` 表示不限制（全量注册表）。
 */
import type { WiringEdge } from "./hubGraph/types";

export type ModelOpsConfig = {
  version: number;
  imageRegistryAllowlist?: string[] | null;
  /** 当前模型不可用时按 registryId 顺序回退 */
  imageModelPreference?: string[] | null;
  /** 运营侧 binding 覆盖（禁用 / 调优先级 / 上游 id） */
  bindingOverrides?: Array<{
    bindingId: string;
    enabled?: boolean;
    priority?: number;
    upstreamOverride?: string;
  }> | null;
  /** 枢纽边表：存在且某 SKU 有边时，优先于静态 providerBindings */
  wiringEdges?: WiringEdge[] | null;
  /** @deprecated 请用 `imageModelPreference`（gear id 会在读取时迁移为 registryId） */
  gearPreference?: string[];
};
