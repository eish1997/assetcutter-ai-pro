import { useEffect, useMemo, useState } from 'react';
import {
  buildEffectiveModel3dRows,
  buildEffectiveVideoModelRows,
  getModelOpsConfigSync,
  refreshModelOpsConfig,
  type EffectiveCapabilityModelRow,
} from '../services/modelRegistry';

type CapabilityModelModality = 'video' | 'model3d';

function buildRows(modality: CapabilityModelModality): EffectiveCapabilityModelRow[] {
  const ops = getModelOpsConfigSync();
  return modality === 'video' ? buildEffectiveVideoModelRows(ops) : buildEffectiveModel3dRows(ops);
}

export function useEffectiveCapabilityModelRows(modality: CapabilityModelModality): {
  rows: EffectiveCapabilityModelRow[];
  firstReadyRegistryId: string;
} {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    void refreshModelOpsConfig().finally(() => {
      if (alive) setVersion((v) => v + 1);
    });
    const onUpdated = () => setVersion((v) => v + 1);
    window.addEventListener('ac:model-ops-updated', onUpdated);
    return () => {
      alive = false;
      window.removeEventListener('ac:model-ops-updated', onUpdated);
    };
  }, []);

  const rows = useMemo(() => {
    void version;
    return buildRows(modality);
  }, [modality, version]);
  const firstReadyRegistryId = rows.find((row) => !row.disabled)?.registryId || rows[0]?.registryId || '';
  return { rows, firstReadyRegistryId };
}
