import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { fetchProviderArtifactBlob } from './providerArtifactFetch';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';
import {
  fetchWorkflowModelFromCompanionAsObjectUrl,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  putWorkflowModelBlobToCompanion,
  putWorkflowResultImageToCompanion,
} from './workflowCompanionAssets';
import type { Persist3dModelsResult } from './workflowModelSlots';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

export function inferWorkflowModelFormatFromUrl(url: string, mime = ''): WorkflowModelSlotFormat {
  const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();
  const contentType = String(mime || '').toLowerCase();
  if (clean.endsWith('.fbx') || contentType.includes('fbx')) return 'fbx';
  if (clean.endsWith('.gltf') || contentType.includes('gltf+json')) return 'gltf';
  if (clean.endsWith('.obj') || contentType.includes('model/obj')) return 'obj';
  if (clean.endsWith('.stl') || contentType.includes('model/stl')) return 'stl';
  if (clean.endsWith('.usdz') || contentType.includes('usdz')) return 'usdz';
  if (clean.endsWith('.zip') || contentType.includes('zip')) return 'zip';
  return 'glb';
}

function uniqueHttpUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function findExistingSlot(params: {
  format: WorkflowModelSlotFormat;
  urls: string[];
  companionKeys: string[];
  formats: WorkflowModelSlotFormat[];
}): { url: string; companionKey: string } | null {
  const idx = params.formats.indexOf(params.format);
  if (idx < 0) return null;
  const url = String(params.urls[idx] || '').trim();
  const companionKey = String(params.companionKeys[idx] || '').trim();
  if (!url && !companionKey) return null;
  return { url, companionKey };
}

export async function persistProviderModelArtifactsForWorkflowAsset(params: {
  providerId: string;
  taskId?: string;
  assetId: string;
  resultKey: string;
  modelUrls: string[];
  previewUrl?: string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  existing?: {
    urls?: string[];
    companionKeys?: string[];
    formats?: WorkflowModelSlotFormat[];
  };
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
}): Promise<Persist3dModelsResult> {
  const providerId = String(params.providerId || '').trim();
  const assetId = String(params.assetId || '').trim();
  const urls = uniqueHttpUrls(params.modelUrls);
  if (!providerId) throw new Error('Missing provider id');
  if (!assetId) throw new Error('Missing workflow asset id');
  if (urls.length === 0) throw new Error('Provider 3D task completed without downloadable model URLs');

  const baseRaw = String(params.companionBaseUrl || '').trim();
  const pid = String(params.companionProjectId || '').trim();
  const base = baseRaw ? normalizeCompanionBaseUrl(baseRaw) : '';
  const useCompanion = Boolean(base && pid && pid !== 'default');
  const log = params.onLog;
  const existingFormats = params.existing?.formats || [];
  const existingUrls = params.existing?.urls || [];
  const existingKeys = params.existing?.companionKeys || [];

  const modelUrls: string[] = [];
  const modelCompanionKeys: string[] = [];
  const stepModelFormats: WorkflowModelSlotFormat[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!;
    const guessedFormat = inferWorkflowModelFormatFromUrl(url);
    const existing = findExistingSlot({
      format: guessedFormat,
      urls: existingUrls,
      companionKeys: existingKeys,
      formats: existingFormats,
    });
    if (existing) {
      modelUrls.push(existing.url);
      if (existing.companionKey) modelCompanionKeys.push(existing.companionKey);
      stepModelFormats.push(guessedFormat);
      continue;
    }

    log?.('info', `[${providerId} 3D archive] Fetching model file ${i + 1}/${urls.length}`, { url });
    const blob = await fetchProviderArtifactBlob({ providerId, url });
    const format = inferWorkflowModelFormatFromUrl(url, blob.type);
    const fileNameHint = `${providerId}_${params.taskId || 'model'}_${format}`;
    if (useCompanion) {
      const put = await putWorkflowModelBlobToCompanion(base, pid, assetId, i, blob, fileNameHint);
      if (put.ok === false) throw new Error(`Failed to write model file to local companion: ${put.error}`);
      const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, put.key, fileNameHint);
      if (got.ok === false) throw new Error(`Failed to read model file from local companion: ${got.error}`);
      modelUrls.push(got.objectUrl);
      modelCompanionKeys.push(put.key);
    } else {
      modelUrls.push(
        URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: blob.type || 'application/octet-stream' }))
      );
    }
    stepModelFormats.push(format);
  }

  let preview: Persist3dModelsResult['preview'];
  const previewUrl = String(params.previewUrl || '').trim();
  if (/^https?:\/\//i.test(previewUrl)) {
    try {
      const blob = await fetchProviderArtifactBlob({ providerId, url: previewUrl });
      if (useCompanion) {
        const dataUrl = await blobToDataUrl(blob);
        const put = await putWorkflowResultImageToCompanion(base, pid, assetId, params.resultKey, dataUrl);
        if (put.ok === false) throw new Error(`Failed to write preview image to local companion: ${put.error}`);
        const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
        if (got.ok === false) throw new Error(`Failed to read preview image from local companion: ${got.error}`);
        preview = { objectUrl: got.objectUrl, companionKey: put.key };
      } else {
        preview = {
          objectUrl: URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: blob.type || 'image/png' })),
        };
      }
    } catch (error) {
      log?.('warn', `[${providerId} 3D archive] Preview archive failed; model files were kept`, error);
    }
  }

  return {
    modelUrls,
    modelCompanionKeys,
    stepModelFormats,
    modelSourceName: modelCompanionKeys[0] || urls[0],
    preview,
  };
}
