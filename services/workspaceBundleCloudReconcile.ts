import type { WorkflowProjectBundle } from './workspaceProjectStore';
import { loadWorkflowBundle } from './workspaceProjectStore';
import { fetchWorkflowBundleFromCloud } from './workspaceCloudSync';
import { mergeWorkflowProjectBundles, type MergeWorkflowProjectBundlesOptions, type WorkflowBundleMergeConflict } from './workflowBundleMerge';

/**
 * 打开项目后是否与 R2 上的 workflow.json 做「本地 ∪ 云端」合并。
 * - 未设置或 `1` / `true`：开启（默认）。
 * - `0` / `false` / `off`：关闭，避免每次打开项目请求云端。
 */
export function isWorkspaceCloudBundleMergeEnabled(): boolean {
  const raw = import.meta.env.VITE_WORKSPACE_CLOUD_BUNDLE_MERGE;
  if (raw === undefined || raw === '') return true;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}

export type ReconcileWorkflowBundleWithCloudResult = {
  bundle: WorkflowProjectBundle;
  /** 是否成功请求到远端 workflow（含「无对象」解析为 null） */
  fetchedRemote: boolean;
  /** 远端存在可解析包并已执行 merge（可能与本地逐字节相同） */
  didMerge: boolean;
  conflicts: WorkflowBundleMergeConflict[];
};

/**
 * 读取本地 bundle，拉取（并 hydrate）云端 workflow，再按策略合并。
 * 调用方负责：仅在已登录、云同步开启等条件下调用。
 */
export async function reconcileWorkflowBundleWithCloud(options: {
  projectId: string;
  userId: string;
  username: string;
  merge?: Pick<MergeWorkflowProjectBundlesOptions, 'sameKey' | 'pendingKeyedBy'>;
}): Promise<ReconcileWorkflowBundleWithCloudResult> {
  const { projectId, userId, username } = options;
  const local = loadWorkflowBundle(projectId, userId);
  let fetchedRemote = false;
  try {
    const remote = await fetchWorkflowBundleFromCloud(userId, projectId, username);
    fetchedRemote = true;
    if (!remote) {
      return { bundle: local, fetchedRemote, didMerge: false, conflicts: [] };
    }
    const remoteBundle: WorkflowProjectBundle = {
      assets: remote.assets,
      pending: remote.pending,
      ...(Array.isArray(remote.capabilityRefs) && remote.capabilityRefs.length
        ? { capabilityRefs: remote.capabilityRefs }
        : {}),
    };
    const mergeOpts: MergeWorkflowProjectBundlesOptions = {
      sameKey: options.merge?.sameKey ?? { kind: 'timestamp-wins' },
      pendingKeyedBy: options.merge?.pendingKeyedBy ?? 'asset-action',
    };
    const { merged, conflicts } = mergeWorkflowProjectBundles(local, remoteBundle, mergeOpts);
    return { bundle: merged, fetchedRemote, didMerge: true, conflicts };
  } catch (e) {
    console.warn('[workspace cloud] reconcileWorkflowBundleWithCloud', e);
    return { bundle: local, fetchedRemote, didMerge: false, conflicts: [] };
  }
}
