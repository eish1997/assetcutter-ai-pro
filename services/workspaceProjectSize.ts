import type { WorkflowAsset } from '../types';
import type { CompanionManifestV1 } from './companionClient/storage';
import {
  loadWorkflowBundle,
  type WorkflowProjectBundle,
  type WorkspacePersistUserId,
} from './workspaceProjectStore';

/** 持久化字符串体积：data URL 按 base64 估算，其余按 UTF-16 长度近似 */
export function estimatePersistedStringBytes(value: string): number {
  if (!value) return 0;
  const v = String(value);
  if (v.startsWith('data:')) {
    const comma = v.indexOf(',');
    if (comma >= 0 && comma < v.length - 1) {
      const payload = v.slice(comma + 1);
      return Math.floor((payload.length * 3) / 4);
    }
  }
  return v.length;
}

export function estimateWorkflowBundleMediaBytes(assets: WorkflowAsset[]): number {
  let total = 0;
  for (const asset of assets) {
    total += estimatePersistedStringBytes(String(asset.original || ''));
    for (const v of Object.values(asset.results || {})) {
      total += estimatePersistedStringBytes(String(v || ''));
    }
    for (const v of asset.cutImageGroup || []) {
      total += estimatePersistedStringBytes(String(v || ''));
    }
    for (const url of asset.modelUrls || []) {
      total += estimatePersistedStringBytes(String(url || ''));
    }
    for (const urls of Object.values(asset.stepModelUrls || {})) {
      if (!Array.isArray(urls)) continue;
      for (const url of urls) {
        total += estimatePersistedStringBytes(String(url || ''));
      }
    }
  }
  return total;
}

export function estimateWorkflowBundleJsonBytes(bundle: WorkflowProjectBundle): number {
  try {
    return new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
  } catch {
    return 0;
  }
}

export function sumCompanionManifestBytes(manifest: CompanionManifestV1 | null | undefined): number {
  if (!manifest || !Array.isArray(manifest.entries)) return 0;
  return manifest.entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.byteSize) || 0), 0);
}

export function computeWorkspaceProjectTotalBytes(
  bundle: WorkflowProjectBundle,
  manifestBytes: number | null = null
): number {
  const jsonBytes = estimateWorkflowBundleJsonBytes(bundle);
  const inlineMedia = estimateWorkflowBundleMediaBytes(bundle.assets ?? []);
  const mediaBytes = manifestBytes != null ? Math.max(manifestBytes, inlineMedia) : inlineMedia;
  return jsonBytes + mediaBytes;
}

export function formatWorkspaceProjectByteSize(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

export function loadWorkspaceProjectTotalBytes(
  projectId: string,
  persistUserId: WorkspacePersistUserId = null
): number {
  const bundle = loadWorkflowBundle(projectId, persistUserId);
  return computeWorkspaceProjectTotalBytes(bundle);
}
