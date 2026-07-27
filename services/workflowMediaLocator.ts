/**
 * Resolve local companion handles for reveal / open-folder UX.
 * Preview may come from R2/blob; open-folder must use durable local locators.
 */

import type { WorkflowAsset } from '../types';
import { getCompanionAssetMeta } from './companionClient/storage';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { sanitizeCompanionPathSegment } from './workflowCompanionAssets';
import {
  collectWorkflowAssetCompanionKeys,
  resolveActiveVariantCompanionKey,
} from './workflowMediaRef';

export type WorkflowLocalHandleAvailability = 'keyed' | 'asset_dir_fallback' | 'none';

export type WorkflowAssetLocalHandle = {
  assetId: string;
  projectId: string;
  variantId: string;
  /** Preferred companion key to reveal (current variant or asset-dir fallback). */
  companionKey: string;
  /** True when key belongs to the active display variant. */
  isExactVariant: boolean;
  availability: WorkflowLocalHandleAvailability;
  /** Human-readable disable / fallback reason (zh). */
  reasonZh: string;
  /**
   * Async probe result: true=磁盘确认有文件；false=键存在但磁盘无文件；
   * undefined=未探测（同步 resolve）。
   */
  onDiskConfirmed?: boolean;
};

export function companionAssetDirectoryIdFromKey(key: string): string {
  const k = String(key || '').trim();
  if (!k.includes('/')) return '';
  return sanitizeCompanionPathSegment(k.split('/')[0] || '');
}

export type ResolveWorkflowAssetLocalHandleInput = {
  asset: WorkflowAsset;
  projectId?: string | null;
  companionBaseUrl?: string | null;
  displayKey?: string;
};

/**
 * Sync resolver for menu enablement.
 * Enables open-folder when any local companion key exists on the asset
 * (falls back to other variants under the same assetId).
 */
export function resolveWorkflowAssetLocalHandle(
  input: ResolveWorkflowAssetLocalHandleInput
): WorkflowAssetLocalHandle {
  const asset = input.asset;
  const assetId = String(asset.id || '').trim();
  const projectId = String(input.projectId || '').trim();
  // Explicit null means caller knows companion is unavailable (empty string still maps to default base).
  const companionMissing = input.companionBaseUrl === null;
  const base = companionMissing
    ? ''
    : normalizeCompanionBaseUrl(String(input.companionBaseUrl || '').trim());
  const variantId = String(input.displayKey || asset.displayKey || 'original').trim() || 'original';

  if (!projectId) {
    return {
      assetId,
      projectId: '',
      variantId,
      companionKey: '',
      isExactVariant: false,
      availability: 'none',
      reasonZh: '当前没有本机项目，无法打开资产文件夹',
    };
  }
  if (companionMissing || !base) {
    return {
      assetId,
      projectId,
      variantId,
      companionKey: '',
      isExactVariant: false,
      availability: 'none',
      reasonZh: '本机伴侣未连接，无法打开资产文件夹',
    };
  }

  const exact = resolveActiveVariantCompanionKey(asset, variantId);
  if (exact) {
    return {
      assetId,
      projectId,
      variantId,
      companionKey: exact,
      isExactVariant: true,
      availability: 'keyed',
      reasonZh: '',
    };
  }

  const all = collectWorkflowAssetCompanionKeys(asset);
  const fallback = all.find((x) => String(x.key || '').trim());
  if (fallback) {
    return {
      assetId,
      projectId,
      variantId,
      companionKey: String(fallback.key).trim(),
      isExactVariant: false,
      availability: 'asset_dir_fallback',
      reasonZh: '当前步骤未落本地，将打开该资产的本机目录',
    };
  }

  return {
    assetId,
    projectId,
    variantId,
    companionKey: '',
    isExactVariant: false,
    availability: 'none',
    reasonZh: '当前资产尚未落到本地，无法打开资产文件夹',
  };
}

export function canOpenWorkflowAssetFolder(handle: WorkflowAssetLocalHandle): boolean {
  return Boolean(handle.companionKey) && handle.availability !== 'none';
}

export {
  canAttemptOpenWorkflowAssetFolder,
  workflowAssetHasPersistableOpenFolderRaster,
} from './workflowEnsureCompanionForReveal';

/**
 * Async probe: if preferred key missing on disk, try other keys on the same asset.
 * Disk-present keys are never discarded for reveal.
 */
export async function resolveWorkflowAssetLocalHandleOnDisk(
  input: ResolveWorkflowAssetLocalHandleInput
): Promise<WorkflowAssetLocalHandle> {
  const sync = resolveWorkflowAssetLocalHandle(input);
  if (sync.availability === 'none' || !sync.companionKey) return sync;

  const base = normalizeCompanionBaseUrl(String(input.companionBaseUrl || '').trim());
  const pid = sync.projectId;
  if (!base || !pid) return sync;

  const probe = async (key: string): Promise<boolean> => {
    const meta = await getCompanionAssetMeta(base, pid, key);
    return Boolean(meta.ok && meta.data.onDisk);
  };

  if (await probe(sync.companionKey)) {
    return { ...sync, onDiskConfirmed: true };
  }

  const candidates = collectWorkflowAssetCompanionKeys(input.asset)
    .map((x) => String(x.key || '').trim())
    .filter((k) => k && k !== sync.companionKey);

  for (const key of candidates) {
    if (await probe(key)) {
      return {
        ...sync,
        companionKey: key,
        isExactVariant: false,
        availability: 'asset_dir_fallback',
        onDiskConfirmed: true,
        reasonZh: '当前步骤文件缺失，将打开该资产其它本机文件所在目录',
      };
    }
  }

  // 键在元数据里但磁盘无文件：交给上层 ensure 重写后再 reveal
  return {
    ...sync,
    onDiskConfirmed: false,
    reasonZh: sync.reasonZh || '本地文件缺失，将尝试从预览重新写入',
  };
}
