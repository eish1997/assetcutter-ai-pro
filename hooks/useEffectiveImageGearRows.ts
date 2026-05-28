import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildEffectiveImageModelRows,
  pickCoercedImageModelId,
  type EffectiveImageModelRow,
} from "../services/modelRegistry/merge";
import type { ModelOpsConfig } from "../services/modelRegistry/opsTypes";
import {
  getModelOpsConfigSync,
  refreshModelOpsConfig,
} from "../services/modelRegistry/opsConfig";
import { getEnabledChannels, subscribeAiSettingsCrossTab } from "../services/settingsStore";

/**
 * 当前启用 channel + 运营配置下的有效生图模型列表（含禁用原因）。
 * channel 或运营 JSON 变更后会更新。
 */
export function useEffectiveImageModelRows(): {
  rows: EffectiveImageModelRow[];
  coerceModelId: (currentRegistryId: string) => string;
  opsConfig: ModelOpsConfig;
} {
  const [channelsKey, setChannelsKey] = useState(() => getEnabledChannels().join(","));
  const [ops, setOps] = useState(() => getModelOpsConfigSync());

  useEffect(() => {
    const syncFromStorage = () => {
      setChannelsKey(getEnabledChannels().join(","));
      setOps(getModelOpsConfigSync());
    };
    const onChannels = () => setChannelsKey(getEnabledChannels().join(","));
    const onOps = () => setOps(getModelOpsConfigSync());

    if (typeof window !== "undefined") {
      window.addEventListener("ac-ai-provider-changed", onChannels);
      window.addEventListener("ac-model-ops-updated", onOps);
    }
    const unsubCrossTab = subscribeAiSettingsCrossTab(syncFromStorage);

    refreshModelOpsConfig()
      .then(() => setOps(getModelOpsConfigSync()))
      .catch(() => {});

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("ac-ai-provider-changed", onChannels);
        window.removeEventListener("ac-model-ops-updated", onOps);
      }
      unsubCrossTab();
    };
  }, []);

  const rows = useMemo(() => buildEffectiveImageModelRows(ops), [channelsKey, ops]);

  const coerceModelId = useCallback(
    (currentRegistryId: string) =>
      pickCoercedImageModelId(currentRegistryId, rows, ops.imageModelPreference ?? undefined),
    [rows, ops.imageModelPreference]
  );

  return { rows, coerceModelId, opsConfig: ops };
}

/** @deprecated 请用 `useEffectiveImageModelRows` */
export function useEffectiveImageGearRows(): {
  rows: Array<EffectiveImageModelRow & { id: string; modelId: string }>;
  coerceGearId: (currentId: string) => string;
  opsConfig: ModelOpsConfig;
} {
  const { rows, coerceModelId, opsConfig } = useEffectiveImageModelRows();
  return {
    rows: rows.map((r) => ({ ...r, id: r.registryId, modelId: r.registryId })),
    coerceGearId: coerceModelId,
    opsConfig,
  };
}
