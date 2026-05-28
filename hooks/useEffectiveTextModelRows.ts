import { useCallback, useEffect, useMemo, useState } from "react";
import { buildEffectiveTextModelRows, type EffectiveTextModelRow } from "../services/modelRegistry/merge";
import { coerceTextModelRegistryId } from "../services/modelRegistry/textModels";
import { getEnabledChannels, subscribeAiSettingsCrossTab } from "../services/settingsStore";

/** 当前启用 channel 下的有效文本模型列表（含禁用原因） */
export function useEffectiveTextModelRows(): {
  rows: EffectiveTextModelRow[];
  coerceModelId: (currentRegistryId: string) => string;
} {
  const [channelsKey, setChannelsKey] = useState(() => getEnabledChannels().join(","));

  useEffect(() => {
    const sync = () => setChannelsKey(getEnabledChannels().join(","));
    if (typeof window !== "undefined") {
      window.addEventListener("ac-ai-provider-changed", sync);
    }
    const unsub = subscribeAiSettingsCrossTab(sync);
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("ac-ai-provider-changed", sync);
      }
      unsub();
    };
  }, []);

  const rows = useMemo(() => buildEffectiveTextModelRows(), [channelsKey]);

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

  return { rows, coerceModelId };
}
