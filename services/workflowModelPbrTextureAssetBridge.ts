/**
 * PBR 贴图升格为正式资产：Viewer 不直接改 setAssets，经事件由 WorkflowSection 创建并落盘。
 */

import type {
  WorkflowModelPbrSlot,
  WorkflowModelPbrTexturePromoteSource,
} from './workflowModelPbrEdits';

export const WORKFLOW_MODEL_PBR_TEXTURE_PROMOTE_REQUEST_EVENT =
  'asset-preview:model3d-pbr-texture-promote-request';
export const WORKFLOW_MODEL_PBR_TEXTURE_RELEASE_REQUEST_EVENT =
  'asset-preview:model3d-pbr-texture-release-request';

export type WorkflowModelPbrTexturePromoteRequestDetail = {
  requestId: string;
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
  hostAssetId: string;
  materialId?: string;
  slot?: WorkflowModelPbrSlot;
  source: WorkflowModelPbrTexturePromoteSource;
  presetId?: string;
};

export type WorkflowModelPbrTexturePromoteResult =
  | { ok: true; assetId: string; previewSrc: string }
  | { ok: false; error: string };

export type WorkflowModelPbrTextureReleaseRequestDetail = {
  requestId: string;
  assetIds: string[];
};

export type WorkflowModelPbrTextureReleaseResult = { ok: true } | { ok: false; error: string };

type PendingPromote = {
  resolve: (value: WorkflowModelPbrTexturePromoteResult) => void;
  started: boolean;
  unhandledTimer: ReturnType<typeof setTimeout> | null;
};

type PendingRelease = {
  resolve: (value: WorkflowModelPbrTextureReleaseResult) => void;
  started: boolean;
  unhandledTimer: ReturnType<typeof setTimeout> | null;
};

const pendingPromote = new Map<string, PendingPromote>();
const pendingRelease = new Map<string, PendingRelease>();

function newRequestId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clearTimer(entry: { unhandledTimer: ReturnType<typeof setTimeout> | null }): void {
  if (entry.unhandledTimer != null) {
    clearTimeout(entry.unhandledTimer);
    entry.unhandledTimer = null;
  }
}

/** Viewer：升格一张贴图为隐藏图资产并落盘 */
export function requestPromotePbrTextureAsset(input: {
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
  hostAssetId: string;
  materialId?: string;
  slot?: WorkflowModelPbrSlot;
  source: WorkflowModelPbrTexturePromoteSource;
  presetId?: string;
}): Promise<WorkflowModelPbrTexturePromoteResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: '当前环境无法创建贴图资产' });
  }
  const dataUrl = String(input.dataUrl || '').trim();
  const hostAssetId = String(input.hostAssetId || '').trim();
  if (!dataUrl) return Promise.resolve({ ok: false, error: '贴图数据为空' });
  if (!hostAssetId) return Promise.resolve({ ok: false, error: '缺少宿主 3D 资产' });

  const requestId = newRequestId('pbr-promote');
  return new Promise((resolve) => {
    const entry: PendingPromote = {
      resolve,
      started: false,
      unhandledTimer: null,
    };
    entry.unhandledTimer = setTimeout(() => {
      const pending = pendingPromote.get(requestId);
      if (!pending || pending.started) return;
      completePromotePbrTextureAsset(requestId, {
        ok: false,
        error: '贴图资产服务未就绪，请确认已打开工作区后重试',
      });
    }, 8_000);
    pendingPromote.set(requestId, entry);
    const detail: WorkflowModelPbrTexturePromoteRequestDetail = {
      requestId,
      dataUrl,
      hostAssetId,
      source: input.source,
      ...(input.fileName?.trim() ? { fileName: input.fileName.trim() } : {}),
      ...(input.mimeType?.trim() ? { mimeType: input.mimeType.trim() } : {}),
      ...(input.materialId?.trim() ? { materialId: input.materialId.trim() } : {}),
      ...(input.slot ? { slot: input.slot } : {}),
      ...(input.presetId?.trim() ? { presetId: input.presetId.trim() } : {}),
    };
    window.dispatchEvent(
      new CustomEvent<WorkflowModelPbrTexturePromoteRequestDetail>(
        WORKFLOW_MODEL_PBR_TEXTURE_PROMOTE_REQUEST_EVENT,
        { detail }
      )
    );
  });
}

export function acknowledgePromotePbrTextureAsset(requestId: string): void {
  const pending = pendingPromote.get(String(requestId || '').trim());
  if (!pending) return;
  pending.started = true;
  clearTimer(pending);
}

export function completePromotePbrTextureAsset(
  requestId: string,
  result: WorkflowModelPbrTexturePromoteResult
): void {
  const id = String(requestId || '').trim();
  const pending = pendingPromote.get(id);
  if (!pending) return;
  clearTimer(pending);
  pendingPromote.delete(id);
  pending.resolve(result);
}

/** Viewer：释放不再被 modelPbrEdits 引用的贴图资产 */
export function requestReleasePbrTextureAssets(assetIds: string[]): Promise<WorkflowModelPbrTextureReleaseResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: '当前环境无法释放贴图资产' });
  }
  const ids = [...new Set(assetIds.map((x) => String(x || '').trim()).filter(Boolean))];
  if (ids.length === 0) return Promise.resolve({ ok: true });

  const requestId = newRequestId('pbr-release');
  return new Promise((resolve) => {
    const entry: PendingRelease = {
      resolve,
      started: false,
      unhandledTimer: null,
    };
    entry.unhandledTimer = setTimeout(() => {
      const pending = pendingRelease.get(requestId);
      if (!pending || pending.started) return;
      completeReleasePbrTextureAssets(requestId, {
        ok: false,
        error: '贴图资产释放服务未就绪',
      });
    }, 8_000);
    pendingRelease.set(requestId, entry);
    window.dispatchEvent(
      new CustomEvent<WorkflowModelPbrTextureReleaseRequestDetail>(
        WORKFLOW_MODEL_PBR_TEXTURE_RELEASE_REQUEST_EVENT,
        { detail: { requestId, assetIds: ids } }
      )
    );
  });
}

export function acknowledgeReleasePbrTextureAssets(requestId: string): void {
  const pending = pendingRelease.get(String(requestId || '').trim());
  if (!pending) return;
  pending.started = true;
  clearTimer(pending);
}

export function completeReleasePbrTextureAssets(
  requestId: string,
  result: WorkflowModelPbrTextureReleaseResult
): void {
  const id = String(requestId || '').trim();
  const pending = pendingRelease.get(id);
  if (!pending) return;
  clearTimer(pending);
  pendingRelease.delete(id);
  pending.resolve(result);
}
