/**
 * 3D 预览贴图生成桥：Viewer 侧不直接 import capabilityExecutor（易触发循环依赖栈溢出），
 * 由 WorkflowSection 监听请求并执行后回传结果。
 *
 * 注意：生成生命周期独立于浮层挂载；面板卸载不得 abort（否则会秒报 Aborted）。
 */

export const WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT =
  'asset-preview:model3d-pbr-slot-generate-request';

export type WorkflowModelPbrSlotGenerateRequestDetail = {
  requestId: string;
  presetId: string;
  sourceDataUrl: string;
  /** 贴图正式资产 id（有则走 companion 兜底物化） */
  sourceTextureAssetId?: string;
  count: number;
  inputText?: string;
};

export type WorkflowModelPbrSlotGenerateImage = {
  dataUrl: string;
  fileName: string;
  mimeType?: string;
  presetId: string;
};

export type WorkflowModelPbrSlotGenerateResult =
  | { ok: true; images: WorkflowModelPbrSlotGenerateImage[] }
  | { ok: false; error: string };

type PendingEntry = {
  resolve: (value: WorkflowModelPbrSlotGenerateResult) => void;
  /** 仅显式 cancel 时 abort；与面板 unmount 解耦 */
  abort: AbortController;
  onProgress?: (remaining: number) => void;
  /** 每完成一张立刻回调（用于列表逐张填入） */
  onImage?: (image: WorkflowModelPbrSlotGenerateImage, index: number) => void;
  started: boolean;
  unhandledTimer: ReturnType<typeof setTimeout> | null;
};

const pendingByRequestId = new Map<string, PendingEntry>();

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pbr-gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Viewer 面板调用：派发请求并等待 WorkflowSection 回传 */
export function requestWorkflowModelPbrSlotGenerate(input: {
  presetId: string;
  sourceDataUrl: string;
  sourceTextureAssetId?: string;
  count: number;
  inputText?: string;
  onProgress?: (remaining: number) => void;
  onImage?: (image: WorkflowModelPbrSlotGenerateImage, index: number) => void;
}): Promise<WorkflowModelPbrSlotGenerateResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: '当前环境无法执行生成' });
  }
  const requestId = newRequestId();

  return new Promise((resolve) => {
    const entry: PendingEntry = {
      resolve,
      abort: new AbortController(),
      onProgress: input.onProgress,
      onImage: input.onImage,
      started: false,
      unhandledTimer: null,
    };
    entry.unhandledTimer = setTimeout(() => {
      const pending = pendingByRequestId.get(requestId);
      if (!pending || pending.started) return;
      completeWorkflowModelPbrSlotGenerate(requestId, {
        ok: false,
        error: '生成服务未就绪，请确认已打开工作区后重试',
      });
    }, 8_000);
    pendingByRequestId.set(requestId, entry);
    const textureAssetId = String(input.sourceTextureAssetId || '').trim();
    const detail: WorkflowModelPbrSlotGenerateRequestDetail = {
      requestId,
      presetId: String(input.presetId || '').trim(),
      sourceDataUrl: String(input.sourceDataUrl || '').trim(),
      ...(textureAssetId ? { sourceTextureAssetId: textureAssetId } : {}),
      count: Math.max(1, Math.floor(Number(input.count) || 1)),
      ...(input.inputText?.trim() ? { inputText: input.inputText.trim() } : {}),
    };
    window.dispatchEvent(
      new CustomEvent<WorkflowModelPbrSlotGenerateRequestDetail>(WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT, {
        detail,
      })
    );
  });
}

/** WorkflowSection：接手请求（清除「无人接单」超时） */
export function acknowledgeWorkflowModelPbrSlotGenerate(requestId: string): void {
  const pending = pendingByRequestId.get(String(requestId || '').trim());
  if (!pending) return;
  pending.started = true;
  if (pending.unhandledTimer != null) {
    clearTimeout(pending.unhandledTimer);
    pending.unhandledTimer = null;
  }
}

/** WorkflowSection：取本请求的 AbortSignal（仅显式 cancel 会 abort） */
export function takeWorkflowModelPbrSlotGenerateAbortSignal(requestId: string): AbortSignal | undefined {
  return pendingByRequestId.get(String(requestId || '').trim())?.abort.signal;
}

/** 显式取消（用户点取消时调用；面板卸载不要调用） */
export function cancelWorkflowModelPbrSlotGenerate(requestId: string): void {
  const pending = pendingByRequestId.get(String(requestId || '').trim());
  if (!pending) return;
  pending.abort.abort();
}

/** WorkflowSection：回报剩余待生成数量（用于面板占位） */
export function reportWorkflowModelPbrSlotGenerateProgress(requestId: string, remaining: number): void {
  pendingByRequestId.get(String(requestId || '').trim())?.onProgress?.(Math.max(0, Math.floor(remaining)));
}

/** WorkflowSection：单张完成时立刻回传（列表逐张填入） */
export function reportWorkflowModelPbrSlotGenerateImage(
  requestId: string,
  image: WorkflowModelPbrSlotGenerateImage,
  index: number
): void {
  pendingByRequestId
    .get(String(requestId || '').trim())
    ?.onImage?.(image, Math.max(0, Math.floor(index)));
}

/** WorkflowSection：完成请求 */
export function completeWorkflowModelPbrSlotGenerate(
  requestId: string,
  result: WorkflowModelPbrSlotGenerateResult
): void {
  const id = String(requestId || '').trim();
  const pending = pendingByRequestId.get(id);
  if (!pending) return;
  if (pending.unhandledTimer != null) {
    clearTimeout(pending.unhandledTimer);
    pending.unhandledTimer = null;
  }
  pendingByRequestId.delete(id);
  pending.resolve(result);
}
