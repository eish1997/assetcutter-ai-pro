import type { AssetSetComponentView, CustomAppModule } from '../../types';
import type { AssetSetComponent } from '../../types';
import {
  tripoWorkflowCreateOrResumeTaskId,
  tripoWorkflowPollUntilDone,
  extractTripoModelAndPreviewUrls,
} from '../generate3d/tripoWorkflow';
import { normalizeApiErrorMessage } from '../geminiService';
import { resolveAssetSetComponentViewSrc } from './assetSetAsset';

export function pickAssetSet3dPreset(
  views: AssetSetComponentView[],
  singlePreset: CustomAppModule | null,
  multiPreset: CustomAppModule | null
): CustomAppModule | null {
  const count = views.filter((v) => resolveAssetSetComponentViewSrc(v)).length;
  if (count <= 0) return null;
  if (count === 1) return singlePreset;
  return multiPreset ?? singlePreset;
}

const TRIPO_ROLE_MAP: Record<string, 'front' | 'back' | 'left' | 'right'> = {
  perspective: 'front',
  front: 'front',
  back: 'back',
  left: 'left',
  right: 'right',
};

export function mapAssetSetViewsToTripoMultiview(
  views: AssetSetComponentView[]
): Partial<Record<'front' | 'back' | 'left' | 'right', string>> | undefined {
  const out: Partial<Record<'front' | 'back' | 'left' | 'right', string>> = {};
  for (const view of views) {
    const src = resolveAssetSetComponentViewSrc(view);
    if (!src) continue;
    const role = String(view.role || '').trim().toLowerCase();
    const slot = TRIPO_ROLE_MAP[role];
    if (slot && !out[slot]) {
      out[slot] = src;
      continue;
    }
    if (!out.front) {
      out.front = src;
    } else if (!out.back) {
      out.back = src;
    } else if (!out.left) {
      out.left = src;
    } else if (!out.right) {
      out.right = src;
    }
  }
  const keys = Object.keys(out);
  return keys.length >= 2 ? out : undefined;
}

export function resolveAssetSet3dPrimaryImage(views: AssetSetComponentView[]): string {
  const perspective = views.find((v) => String(v.role).toLowerCase() === 'perspective');
  const perspectiveSrc = perspective ? resolveAssetSetComponentViewSrc(perspective) : '';
  if (perspectiveSrc) return perspectiveSrc;
  const front = views.find((v) => String(v.role).toLowerCase() === 'front');
  const frontSrc = front ? resolveAssetSetComponentViewSrc(front) : '';
  if (frontSrc) return frontSrc;
  for (const view of views) {
    const src = resolveAssetSetComponentViewSrc(view);
    if (src) return src;
  }
  return '';
}

export type RunAssetSetComponent3dResult =
  | {
      ok: true;
      jobId: string;
      files: string[];
      previewUrl: string;
    }
  | { ok: false; error: string };

export async function runAssetSetComponent3d(params: {
  apiKey: string;
  preset: CustomAppModule;
  component: AssetSetComponent;
  onStatus?: (status: 'queued' | 'running') => void;
  existingJobId?: string;
  forceNewTask?: boolean;
}): Promise<RunAssetSetComponent3dResult> {
  const views = params.component.views ?? [];
  const multiview = mapAssetSetViewsToTripoMultiview(views);
  const primary = resolveAssetSet3dPrimaryImage(views);
  if (!primary) {
    return { ok: false, error: '组件尚无可用视角图' };
  }
  try {
    const { taskId } = await tripoWorkflowCreateOrResumeTaskId({
      apiKey: params.apiKey,
      preset: params.preset,
      imageDataUrl: primary,
      multiviewImageDataUrls: multiview,
      existingTaskId: params.existingJobId,
      forceNewTask: params.forceNewTask,
    });
    params.onStatus?.('queued');
    const done = await tripoWorkflowPollUntilDone({
      apiKey: params.apiKey,
      taskId,
      normalizeApiErrorMessage,
      onTripoStatus: params.onStatus,
    });
    if (done.status !== 'success') {
      return { ok: false, error: '3D 生成失败' };
    }
    const { modelUrls, previewUrl } = extractTripoModelAndPreviewUrls(done);
    if (!modelUrls.length) {
      return { ok: false, error: '3D 任务完成但未返回模型文件' };
    }
    return {
      ok: true,
      jobId: taskId,
      files: modelUrls,
      previewUrl,
    };
  } catch (e) {
    return { ok: false, error: normalizeApiErrorMessage(e) };
  }
}
