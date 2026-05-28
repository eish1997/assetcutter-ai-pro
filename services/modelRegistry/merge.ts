import {
  DIALOG_IMAGE_REGISTRY,
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
  coerceImageModelRegistryId,
  isRegisteredImageModelId,
  LEGACY_IMAGE_GEAR_TO_REGISTRY,
} from "./imageModels";
import { imageModelRouteDisabledReason } from "./imageModelProvider";
import { pickBinding } from "./pickBinding";
import { getEnabledChannels } from "../settingsStore";
import { setBindingDegradedHint } from "../settingsStore";
import type { ModelOpsConfig } from "./opsTypes";
import { modelRegistryLog } from "./log";

export type EffectiveImageModelRow = {
  registryId: string;
  label: string;
  disabled: boolean;
  disabledReason?: string;
};

/** @deprecated 请用 `EffectiveImageModelRow` */
export type EffectiveImageGearRow = EffectiveImageModelRow & { id: string; modelId: string };

/**
 * 合并：注册表模型 × 运营允许列表 ×（预留）渠道绑定。
 * 若运营规则导致「全部模型不可用」，则忽略限制并打 error 日志（避免工作流产线卡死）。
 */
export function buildEffectiveImageModelRows(ops: ModelOpsConfig): EffectiveImageModelRow[] {
  const allow = ops.imageRegistryAllowlist;
  const allowSet = allow == null || allow.length === 0 ? null : new Set(allow);

  const rows: EffectiveImageModelRow[] = DIALOG_IMAGE_REGISTRY.map((e) => {
    const blockedByOps = Boolean(allowSet && !allowSet.has(e.registryId));
    const blockedByCredentials = !pickBinding(e.registryId, "image");
    const disabled = blockedByOps || blockedByCredentials;
    const disabledReason = blockedByOps
      ? "运营未开放该生图模型"
      : blockedByCredentials
        ? imageModelRouteDisabledReason(e.registryId)
        : undefined;
    return {
      registryId: e.registryId,
      label: e.label,
      disabled,
      disabledReason,
    };
  });

  if (!rows.some((r) => !r.disabled)) {
    const sampleReason =
      rows.find((r) => r.disabledReason)?.disabledReason ?? "未配置可用生图通道凭证";
    setBindingDegradedHint("生图通道未就绪，已降级展示");
    modelRegistryLog(
      "error",
      "all image models disabled by ops/provider rules; falling back to full registry",
      `channels=${getEnabledChannels().join(",") || "(none)"} reason=${sampleReason}`
    );
    return DIALOG_IMAGE_REGISTRY.map((e) => ({
      registryId: e.registryId,
      label: e.label,
      disabled: false,
      disabledReason: sampleReason,
    }));
  }
  setBindingDegradedHint(null);
  return rows;
}

/** @deprecated 请用 `buildEffectiveImageModelRows` */
export function buildEffectiveImageGearRows(_provider: unknown, ops: ModelOpsConfig): EffectiveImageGearRow[] {
  return buildEffectiveImageModelRows(ops).map((r) => ({
    ...r,
    id: r.registryId,
    modelId: r.registryId,
  }));
}

function defaultModelPreference(): string[] {
  return DIALOG_IMAGE_REGISTRY.map((e) => e.registryId);
}

function normalizeModelPreference(pref: string[] | undefined): string[] {
  if (!pref?.length) return defaultModelPreference();
  const out = pref.map((x) => coerceImageModelRegistryId(x)).filter((id, i, arr) => arr.indexOf(id) === i);
  return out.length > 0 ? out : defaultModelPreference();
}

export function pickCoercedImageModelId(
  currentRegistryId: string,
  rows: EffectiveImageModelRow[],
  preference: string[] | undefined
): string {
  const pref = normalizeModelPreference(preference);
  const current = coerceImageModelRegistryId(currentRegistryId);
  const row = rows.find((r) => r.registryId === current);
  if (row && !row.disabled) return current;
  for (const p of pref) {
    const hit = rows.find((x) => x.registryId === p && !x.disabled);
    if (hit) {
      if (current !== p) {
        modelRegistryLog("info", "image model coerced", `${current} → ${p}`);
      }
      return p;
    }
  }
  const first = rows.find((r) => !r.disabled);
  const fallback = first?.registryId ?? DEFAULT_IMAGE_MODEL_REGISTRY_ID;
  if (current !== fallback) {
    modelRegistryLog("info", "image model coerced", `${current} → ${fallback}`);
  }
  return fallback;
}

/** @deprecated 请用 `pickCoercedImageModelId` */
export function pickCoercedGearId(
  currentGearId: string,
  rows: EffectiveImageGearRow[],
  preference: string[] | undefined
): string {
  const modelRows: EffectiveImageModelRow[] = rows.map((r) => ({
    registryId: r.modelId ?? r.registryId ?? r.id,
    label: r.label,
    disabled: r.disabled,
    disabledReason: r.disabledReason,
  }));
  const pref = preference?.map((x) => {
    if (isRegisteredImageModelId(x)) return x;
    return LEGACY_IMAGE_GEAR_TO_REGISTRY[x] ?? x;
  });
  return pickCoercedImageModelId(coerceImageModelRegistryId(currentGearId), modelRows, pref);
}
