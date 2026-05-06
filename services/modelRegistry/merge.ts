import { DIALOG_IMAGE_GEARS } from "./imageModels";
import type { DialogImageGear } from "./imageModels";
import type { AiProvider } from "../settingsStore";
import type { ModelOpsConfig } from "./opsTypes";
import { modelRegistryLog } from "./log";

export type EffectiveImageGearRow = {
  id: DialogImageGear;
  label: string;
  modelId: string;
  disabled: boolean;
  disabledReason?: string;
};

/**
 * 合并：注册表档位 × 运营允许列表 ×（预留）渠道绑定。
 * 若运营规则导致「全部档位不可用」，则忽略限制并打 error 日志（避免工作流产线卡死）。
 */
export function buildEffectiveImageGearRows(provider: AiProvider, ops: ModelOpsConfig): EffectiveImageGearRow[] {
  void provider;
  const allow = ops.imageRegistryAllowlist;
  const allowSet = allow == null || allow.length === 0 ? null : new Set(allow);

  const rows: EffectiveImageGearRow[] = DIALOG_IMAGE_GEARS.map((g) => {
    const blockedByOps = Boolean(allowSet && !allowSet.has(g.modelId));
    return {
      id: g.id,
      label: g.label,
      modelId: g.modelId,
      disabled: blockedByOps,
      disabledReason: blockedByOps ? "运营未开放该生图模型" : undefined,
    };
  });

  if (!rows.some((r) => !r.disabled)) {
    modelRegistryLog(
      "error",
      "all image gears disabled by ops/provider rules; falling back to full registry",
      `provider=${provider}`
    );
    return DIALOG_IMAGE_GEARS.map((g) => ({
      id: g.id,
      label: g.label,
      modelId: g.modelId,
      disabled: false,
    }));
  }
  return rows;
}

const DEFAULT_PREF: DialogImageGear[] = ["standard", "fast", "pro"];

export function pickCoercedGearId(
  currentGearId: string,
  rows: EffectiveImageGearRow[],
  preference: DialogImageGear[] | undefined
): string {
  const pref = preference?.length ? preference : DEFAULT_PREF;
  const row = rows.find((r) => r.id === currentGearId);
  if (row && !row.disabled) return currentGearId;
  for (const p of pref) {
    const hit = rows.find((x) => x.id === p && !x.disabled);
    if (hit) {
      if (currentGearId !== p) {
        modelRegistryLog("info", "image gear coerced", `${currentGearId} → ${p}`);
      }
      return p;
    }
  }
  const first = rows.find((r) => !r.disabled);
  const fallback = first?.id ?? "standard";
  if (currentGearId !== fallback) {
    modelRegistryLog("info", "image gear coerced", `${currentGearId} → ${fallback}`);
  }
  return fallback;
}
