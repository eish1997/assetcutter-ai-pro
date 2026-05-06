import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildEffectiveImageGearRows,
  pickCoercedGearId,
  type EffectiveImageGearRow,
} from "../services/modelRegistry/merge";
import type { ModelOpsConfig } from "../services/modelRegistry/opsTypes";
import {
  getModelOpsConfigSync,
  refreshModelOpsConfig,
} from "../services/modelRegistry/opsConfig";
import { getAiProvider, subscribeAiSettingsCrossTab } from "../services/settingsStore";

/**
 * 当前 AI 渠道 + 运营配置下的有效生图档位列表（含禁用原因）。
 * 切换供应商（同标签 `setAiProvider`）或拉取运营 JSON 后会更新。
 */
export function useEffectiveImageGearRows(): {
  rows: EffectiveImageGearRow[];
  coerceGearId: (currentGearId: string) => string;
  opsConfig: ModelOpsConfig;
} {
  const [provider, setProvider] = useState(() => getAiProvider());
  const [ops, setOps] = useState(() => getModelOpsConfigSync());

  useEffect(() => {
    const syncFromStorage = () => {
      setProvider(getAiProvider());
      setOps(getModelOpsConfigSync());
    };
    const onProvider = () => setProvider(getAiProvider());
    const onOps = () => setOps(getModelOpsConfigSync());

    if (typeof window !== "undefined") {
      window.addEventListener("ac-ai-provider-changed", onProvider);
      window.addEventListener("ac-model-ops-updated", onOps);
    }
    const unsubCrossTab = subscribeAiSettingsCrossTab(syncFromStorage);

    refreshModelOpsConfig()
      .then(() => setOps(getModelOpsConfigSync()))
      .catch(() => {});

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("ac-ai-provider-changed", onProvider);
        window.removeEventListener("ac-model-ops-updated", onOps);
      }
      unsubCrossTab();
    };
  }, []);

  const rows = useMemo(() => buildEffectiveImageGearRows(provider, ops), [provider, ops]);

  const coerceGearId = useCallback(
    (currentGearId: string) => pickCoercedGearId(currentGearId, rows, ops.gearPreference),
    [rows, ops.gearPreference]
  );

  return { rows, coerceGearId, opsConfig: ops };
}
