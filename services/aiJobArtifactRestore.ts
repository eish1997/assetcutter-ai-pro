import type { WorkflowAsset } from '../types';
import type { RestorableAiJobArtifact } from './aiJobArtifacts';
import {
  fetchWorkflowModelFromCompanionAsObjectUrl,
  imageSrcToDataUrlForCompanion,
  parseDataUrlToBlob,
  putWorkflowModelBlobToCompanion,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
} from './workflowCompanionAssets';

export type BuildAiJobRestoreAssetsOptions = {
  jobId: string;
  artifacts: RestorableAiJobArtifact[];
  now?: number;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

export type BuildAiJobRestoreAssetsResult = {
  assets: WorkflowAsset[];
  persistedCount: number;
  failedPersistCount: number;
};

export function aiJobArtifactResultKey(kind: RestorableAiJobArtifact['kind']): string {
  if (kind === 'video') return 'ai_job_video';
  if (kind === 'model3d') return 'ai_job_model3d';
  return 'ai_job_image';
}

export function buildAiJobModelPlaceholder(label: string): string {
  const safeLabel = String(label || 'AI model').replace(/[<>&"]/g, '');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#111827"/><path d="M480 126 672 236v168L480 514 288 404V236l192-110Z" fill="#1f2937" stroke="#60a5fa" stroke-width="18"/><path d="M288 236 480 348l192-112M480 348v166" stroke="#93c5fd" stroke-width="14" fill="none"/><text x="480" y="584" fill="#dbeafe" font-family="Arial,sans-serif" font-size="34" text-anchor="middle">${safeLabel}</text></svg>`
  )}`;
}

function modelFormatFromUrl(url: string): 'glb' | 'fbx' {
  return url.toLowerCase().includes('.fbx') ? 'fbx' : 'glb';
}

async function fetchArtifactBlob(url: string): Promise<Blob | null> {
  const parsed = parseDataUrlToBlob(url);
  if (parsed) return parsed.blob;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'include' });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export async function buildAiJobRestoreAssets(
  options: BuildAiJobRestoreAssetsOptions
): Promise<BuildAiJobRestoreAssetsResult> {
  const now = options.now ?? Date.now();
  const base = String(options.companionBaseUrl || '').trim();
  const projectId = String(options.companionProjectId || '').trim();
  const canUseCompanion = Boolean(base && projectId && projectId !== 'default');
  let persistedCount = 0;
  let failedPersistCount = 0;

  const restorable = options.artifacts.filter(
    (artifact) => artifact.kind === 'image' || artifact.kind === 'video' || artifact.kind === 'model3d'
  );

  const assets: WorkflowAsset[] = [];
  for (let index = 0; index < restorable.length; index += 1) {
    const artifact = restorable[index]!;
    const id = `wf_aijob_${now}_${index}_${Math.random().toString(36).slice(2, 8)}`;
    const resultKey = aiJobArtifactResultKey(artifact.kind);
    const original = artifact.kind === 'model3d' ? buildAiJobModelPlaceholder(artifact.label) : artifact.url;
    const asset: WorkflowAsset = {
      id,
      assetKind: 'image',
      original,
      displayKey: artifact.kind === 'image' ? 'original' : resultKey,
      results: artifact.kind === 'image' ? {} : { [resultKey]: original },
      modelUrls: artifact.kind === 'model3d' ? [artifact.url] : undefined,
      stepModelUrls: artifact.kind === 'model3d' ? { [resultKey]: [artifact.url] } : undefined,
      stepModelFormats: artifact.kind === 'model3d' ? { [resultKey]: [modelFormatFromUrl(artifact.url)] } : undefined,
      resultOrder: artifact.kind === 'image' ? [] : [resultKey],
      resultMeta: {
        [resultKey]: {
          executedAt: now,
          displayStepLabel: 'AI 任务回填',
          mediaKind: artifact.kind === 'video' ? 'video' : artifact.kind === 'model3d' ? 'model3d' : 'image',
          aiGatewayJobId: options.jobId,
        },
      },
      groupId: null,
      archived: false,
      hiddenInGrid: false,
      createdAt: now,
    };

    if (canUseCompanion) {
      if (artifact.kind === 'image') {
        const dataUrl = await imageSrcToDataUrlForCompanion(artifact.url);
        if (dataUrl) {
          const put = await putWorkflowOriginalImageToCompanion(base, projectId, id, dataUrl);
          if (put.ok) {
            asset.original = dataUrl;
            asset.originalCompanionKey = put.key;
            persistedCount += 1;
          } else {
            failedPersistCount += 1;
          }
        } else {
          failedPersistCount += 1;
        }
      } else if (artifact.kind === 'video') {
        const dataUrl = await imageSrcToDataUrlForCompanion(artifact.url);
        if (dataUrl) {
          const put = await putWorkflowResultImageToCompanion(base, projectId, id, resultKey, dataUrl);
          if (put.ok) {
            asset.results = { [resultKey]: dataUrl };
            asset.resultsCompanionKeys = { [resultKey]: put.key };
            persistedCount += 1;
          } else {
            failedPersistCount += 1;
          }
        } else {
          failedPersistCount += 1;
        }
      } else if (artifact.kind === 'model3d') {
        const blob = await fetchArtifactBlob(artifact.url);
        if (blob) {
          const put = await putWorkflowModelBlobToCompanion(base, projectId, id, 0, blob, artifact.url);
          if (put.ok) {
            const hydrated = await fetchWorkflowModelFromCompanionAsObjectUrl(base, projectId, put.key, artifact.url);
            asset.modelCompanionKeys = [put.key];
            asset.stepModelCompanionKeys = { [resultKey]: [put.key] };
            if (hydrated.ok) {
              asset.modelUrls = [hydrated.objectUrl];
              asset.stepModelUrls = { [resultKey]: [hydrated.objectUrl] };
            }
            persistedCount += 1;
          } else {
            failedPersistCount += 1;
          }
        } else {
          failedPersistCount += 1;
        }
      }
    }

    assets.push(asset);
  }

  return { assets, persistedCount, failedPersistCount };
}
