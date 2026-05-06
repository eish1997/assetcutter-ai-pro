import type { DialogImageGear } from "./imageModels";

/**
 * 运营侧模型策略（可由远端 JSON 覆盖，见 opsConfig.ts）。
 * `imageRegistryAllowlist === null | undefined` 表示不限制（全量注册表）。
 */
export type ModelOpsConfig = {
  version: number;
  imageRegistryAllowlist?: string[] | null;
  /** 当前档位不可用时按顺序回退（gear id） */
  gearPreference?: DialogImageGear[];
};
