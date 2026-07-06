import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WorkflowAsset } from '../types';
import {
  applyCompanionHydratePatches,
  buildCompanionLazyHydrateTasks,
  runWorkflowCompanionLazyHydrate,
  type WorkflowCompanionHydratePatch,
} from '../services/workflowCompanionLazyHydrate';

export type UseWorkflowCompanionLazyHydrateOpts = {
  projectId: string;
  companionBaseUrl: string;
  assets: WorkflowAsset[];
  /** 视口内资产 id：仅用于任务排序，不中断已在进行的 hydrate */
  visibleRootAssetIds: Set<string>;
  setAssets: Dispatch<SetStateAction<WorkflowAsset[]>>;
  onLog?: (level: 'warn' | 'info', title: string, detail?: string) => void;
  hydrateKey: string;
};

/**
 * 伴侣 raster hydrate：项目/键变化时跑完整队列；滚动只更新优先级 ref，**不 cancel** 进行中的拉取。
 */
export function useWorkflowCompanionLazyHydrate({
  projectId,
  companionBaseUrl,
  assets,
  visibleRootAssetIds,
  setAssets,
  onLog,
  hydrateKey,
}: UseWorkflowCompanionLazyHydrateOpts): void {
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const visibleRef = useRef(visibleRootAssetIds);
  visibleRef.current = visibleRootAssetIds;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const runGenRef = useRef(0);

  useEffect(() => {
    visibleRef.current = visibleRootAssetIds;
  }, [visibleRootAssetIds]);

  useEffect(() => {
    const base = String(companionBaseUrl || '').trim();
    const pid = String(projectId || '').trim();
    if (!base || !pid || !hydrateKey) return;

    const gen = ++runGenRef.current;
    let cancelled = false;

    void runWorkflowCompanionLazyHydrate({
      projectId: pid,
      companionBaseUrl: base,
      getAssets: () => assetsRef.current,
      visibleAssetIds: visibleRef.current,
      isCancelled: () => cancelled || runGenRef.current !== gen,
      onPatch: (patches: WorkflowCompanionHydratePatch[]) => {
        if (cancelled || runGenRef.current !== gen || !patches.length) return;
        setAssets((prev) => applyCompanionHydratePatches(prev, patches));
      },
      onFailure: (task, error) => {
        if (cancelled || runGenRef.current !== gen) return;
        const label =
          task.kind === 'original'
            ? `${task.assetId}: ${error}`
            : `${task.assetId}/${task.stepId}: ${error}`;
        onLogRef.current?.(
          'warn',
          task.kind === 'original' ? '本地伴侣原图恢复失败' : '本地伴侣步骤结果图恢复失败',
          label
        );
      },
    });

    return () => {
      cancelled = true;
    };
  }, [hydrateKey, projectId, companionBaseUrl, setAssets]);
}

export { buildCompanionLazyHydrateTasks };
