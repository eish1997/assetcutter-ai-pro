import type { WorkflowAsset } from '../types';
import type { RestorableAiJobArtifact } from './aiJobArtifacts';
import { r2ApiUrl } from './apiBase';
import { requestJson } from './httpClient';
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
  cloudUserId?: string | null;
  cloudUsername?: string | null;
  cloudProjectId?: string | null;
  cloudAssetPersistenceEnabled?: boolean;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

export type BuildAiJobRestoreAssetsResult = {
  assets: WorkflowAsset[];
  persistedCount: number;
  failedPersistCount: number;
};

type UploadUrlResponse = { uploadUrl: string; objectKey: string };

function mimeToExt(mime: string, fallback = 'bin'): string {
  const m = String(mime || '').split(';')[0]!.trim().toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('gltf-binary')) return 'glb';
  if (m.includes('gltf')) return 'gltf';
  return fallback;
}

function sanitizePathSegment(s: string, fallback = 'x'): string {
  return (
    String(s || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 96) || fallback
  );
}

function userStorageDirName(userId: string, username?: string | null): string {
  const uid = sanitizePathSegment(userId, 'user');
  const name = sanitizePathSegment(username || '', '');
  return name ? `${name}-${uid}` : uid;
}

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

async function uploadBlobToR2(objectKey: string, blob: Blob): Promise<string> {
  const contentType = (blob.type && blob.type.split(';')[0]!.trim()) || 'application/octet-stream';
  const { uploadUrl } = await requestJson<UploadUrlResponse>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, contentType, contentLength: blob.size, expiresIn: 900 }),
  });
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`R2 PUT failed (${put.status})`);
  await requestJson<{ ok?: boolean }>(r2ApiUrl('/register-upload'), {
    method: 'POST',
    body: JSON.stringify({ objectKey }),
  });
  return objectKey;
}

async function uploadDataUrlToR2(objectKey: string, dataUrl: string): Promise<string | null> {
  const parsed = parseDataUrlToBlob(dataUrl);
  if (!parsed) return null;
  return uploadBlobToR2(objectKey, parsed.blob);
}

function r2ObjectSitePath(objectKey: string): string {
  return `/api/r2/objects/${objectKey}`;
}

export async function buildAiJobRestoreAssets(
  options: BuildAiJobRestoreAssetsOptions
): Promise<BuildAiJobRestoreAssetsResult> {
  const now = options.now ?? Date.now();
  const cloudUserId = String(options.cloudUserId || '').trim();
  const cloudProjectId = String(options.cloudProjectId || '').trim();
  const canUseCloud = Boolean(options.cloudAssetPersistenceEnabled && cloudUserId && cloudProjectId);
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

    if (artifact.kind === 'image') {
      const dataUrl = await imageSrcToDataUrlForCompanion(artifact.url);
      if (canUseCloud && dataUrl) {
        try {
          const parsed = parseDataUrlToBlob(dataUrl);
          const ext = mimeToExt(parsed?.mime || artifact.mimeType || 'image/png', 'png');
          const key = `users/${userStorageDirName(cloudUserId, options.cloudUsername)}/workspace/projects/${sanitizePathSegment(cloudProjectId, 'project')}/assets/${id}/original.${ext}`;
          const objectKey = await uploadDataUrlToR2(key, dataUrl);
          if (objectKey) {
            asset.original = '';
            asset.originalObjectKey = objectKey;
            persistedCount += 1;
            assets.push(asset);
            continue;
          }
        } catch {
          failedPersistCount += 1;
        }
      }
      if (canUseCompanion) {
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
      }
    } else if (artifact.kind === 'video') {
      const dataUrl = await imageSrcToDataUrlForCompanion(artifact.url);
      if (canUseCloud && dataUrl) {
        try {
          const parsed = parseDataUrlToBlob(dataUrl);
          const ext = mimeToExt(parsed?.mime || artifact.mimeType || 'video/mp4', 'mp4');
          const key = `users/${userStorageDirName(cloudUserId, options.cloudUsername)}/workspace/projects/${sanitizePathSegment(cloudProjectId, 'project')}/assets/${id}/results/${resultKey}.${ext}`;
          const objectKey = await uploadDataUrlToR2(key, dataUrl);
          if (objectKey) {
            asset.results = {};
            asset.resultsObjectKeys = { [resultKey]: objectKey };
            persistedCount += 1;
            assets.push(asset);
            continue;
          }
        } catch {
          failedPersistCount += 1;
        }
      }
      if (canUseCompanion) {
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
      }
    } else if (artifact.kind === 'model3d') {
      const blob = await fetchArtifactBlob(artifact.url);
      if (canUseCloud && blob) {
        try {
          const ext = artifact.url.toLowerCase().includes('.fbx')
            ? 'fbx'
            : artifact.url.toLowerCase().includes('.gltf')
              ? 'gltf'
              : mimeToExt(blob.type || artifact.mimeType || 'model/gltf-binary', 'glb');
          const key = `users/${userStorageDirName(cloudUserId, options.cloudUsername)}/workspace/projects/${sanitizePathSegment(cloudProjectId, 'project')}/assets/${id}/models/model-0.${ext}`;
          const objectKey = await uploadBlobToR2(key, blob);
          const sitePath = r2ObjectSitePath(objectKey);
          asset.modelUrls = [sitePath];
          asset.stepModelUrls = { [resultKey]: [sitePath] };
          persistedCount += 1;
          assets.push(asset);
          continue;
        } catch {
          failedPersistCount += 1;
        }
      }
      if (canUseCompanion) {
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
