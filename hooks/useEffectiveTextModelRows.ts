import { useCallback, useEffect, useMemo, useState } from "react";
import { buildEffectiveTextModelRows, type EffectiveTextModelRow } from "../services/modelRegistry/merge";
import type { ModelOpsConfig } from "../services/modelRegistry/opsTypes";
import { getModelOpsConfigSync, refreshModelOpsConfig } from "../services/modelRegistry/opsConfig";
import { coerceTextModelRegistryId } from "../services/modelRegistry/textModels";
import { getEnabledChannels, subscribeAiSettingsCrossTab } from "../services/settingsStore";

/** 当前启用 channel 下的有效文本模型列表（含禁用原因） */
export function useEffectiveTextModelRows(): {
  rows: EffectiveTextModelRow[];
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
    const unsub = subscribeAiSettingsCrossTab(syncFromStorage);
    refreshModelOpsConfig()
      .then(() => setOps(getModelOpsConfigSync()))
      .catch(() => {});
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("ac-ai-provider-changed", onChannels);
        window.removeEventListener("ac-model-ops-updated", onOps);
      }
      unsub();
    };
  }, []);

  const rows = useMemo(() => {
    void channelsKey;
    return buildEffectiveTextModelRows(ops).filter((row) => !row.disabled);
  }, [channelsKey, ops]);

  const coerceModelId = useCallback(
    (currentRegistryId: string) => {
      const current = coerceTextModelRegistryId(currentRegistryId);
      const row = rows.find((r) => r.registryId === current);
      if (row && !row.disabled) return current;
      const firstReady = rows.find((r) => !r.disabled);
      return firstReady?.registryId ?? current;
    },
    [rows]
  );

  return { rows, coerceModelId, opsConfig: ops };
}
