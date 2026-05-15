import type { File3D, TencentCredentials } from './tencentService';
import { extractTencentModelAndPreviewUrls } from './generate3d/tencentWorkflow';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import {
  fetchWorkflowModelFromCompanionAsObjectUrl,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  putWorkflowModelBlobToCompanion,
  putWorkflowResultImageToCompanion,
} from './workflowCompanionAssets';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';

export type PersistTencentModelsResult = {
  modelUrls: string[];
  modelCompanionKeys: string[];
  stepModelFormats: WorkflowModelSlotFormat[];
  modelSourceName?: string;
  preview?: {
    objectUrl: string;
    companionKey?: string;
  };
};

function inferSlotFormat(file: File3D): WorkflowModelSlotFormat {
  const type = String(file.Type || '').toUpperCase();
  if (type === 'FBX') return 'fbx';
  return 'glb';
}

function extFromFile(file: File3D): string {
  const type = String(file.Type || '').toLowerCase();
  if (type === 'fbx') return '.fbx';
  if (type === 'obj') return '.obj';
  if (type === 'stl') return '.stl';
  if (type === 'usdz') return '.usdz';
  const url = String(file.Url || '').split('?')[0].split('#')[0];
  const dot = url.lastIndexOf('.');
  if (dot >= 0) return url.slice(dot).toLowerCase();
  return '.glb';
}

async function fetchTencentRemoteFileBlob(url: string, proxyUrl?: string): Promise<Blob> {
  const raw = String(url || '').trim();
  if (!raw) throw new Error('缺少模型下载地址');
  const resolved =
    proxyUrl && /^https?:\/\//i.test(raw)
      ? `${proxyUrl.replace(/\/$/, '')}/model?url=${encodeURIComponent(raw)}`
      : raw;
  const r = await fetch(resolved);
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`混元模型下载失败 (${r.status})${txt ? `：${txt.slice(0, 120)}` : ''}`);
  }
  return await r.blob();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/**
 * 混元任务成功后：将 ResultFile3Ds 落本地伴侣（优先 GLB/OBJ），预览图可选写入。
 */
export async function persistTencentModelsForWorkflowAsset(params: {
  creds: TencentCredentials;
  tencentJobId: string;
  assetId: string;
  resultKey: string;
  files: File3D[];
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  existing?: {
    urls?: string[];
    companionKeys?: string[];
    formats?: WorkflowModelSlotFormat[];
  };
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
}): Promise<PersistTencentModelsResult> {
  const tencentJobId = String(params.tencentJobId || '').trim();
  const assetId = String(params.assetId || '').trim();
  const { orderedFiles, previewUrl } = extractTencentModelAndPreviewUrls(params.files);
  if (!orderedFiles.length) throw new Error('混元任务完成但未返回可下载模型');

  const baseRaw = String(params.companionBaseUrl || '').trim();
  const pid = String(params.companionProjectId || '').trim();
  const base = baseRaw ? normalizeCompanionBaseUrl(baseRaw) : '';
  const useCompanion = Boolean(base && pid);
  const proxyUrl = params.creds.proxyUrl;
  const log = params.onLog;

  const existingFormats = params.existing?.formats || [];
  const existingUrls = params.existing?.urls || [];
  const existingKeys = params.existing?.companionKeys || [];

  const modelUrls: string[] = [];
  const modelCompanionKeys: string[] = [];
  const stepModelFormats: WorkflowModelSlotFormat[] = [];

  for (let i = 0; i < orderedFiles.length; i++) {
    const file = orderedFiles[i]!;
    const format = inferSlotFormat(file);
    const existingIdx = existingFormats.indexOf(format);
    const hasExisting =
      existingIdx >= 0 &&
      Boolean(String(existingUrls[existingIdx] || '').trim() || String(existingKeys[existingIdx] || '').trim());
    if (hasExisting) {
      modelUrls.push(String(existingUrls[existingIdx] || '').trim());
      if (existingKeys[existingIdx]) modelCompanionKeys.push(String(existingKeys[existingIdx]).trim());
      stepModelFormats.push(format);
      log?.('info', `[混元 归档] 已存在 ${format.toUpperCase()} 本地副本，跳过重复落盘`);
      continue;
    }

    const url = String(file.Url || '').trim();
    log?.('info', `[混元 归档] 落盘模型槽位 ${i}`, { type: file.Type, format });
    const blob = await fetchTencentRemoteFileBlob(url, proxyUrl);
    if (useCompanion) {
      const put = await putWorkflowModelBlobToCompanion(
        base,
        pid,
        assetId,
        i,
        blob,
        `tencent_${tencentJobId}_${format}`
      );
      if (put.ok === false) throw new Error(`写入本地伴侣失败：${put.error}`);
      const got = await fetchWorkflowModelFromCompanionAsObjectUrl(
        base,
        pid,
        put.key,
        `tencent_${tencentJobId}${extFromFile(file)}`
      );
      if (got.ok === false) throw new Error(`读取本地伴侣模型失败：${got.error}`);
      modelUrls.push(got.objectUrl);
      modelCompanionKeys.push(put.key);
    } else {
      modelUrls.push(URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: blob.type || 'application/octet-stream' })));
    }
    stepModelFormats.push(format);
  }

  const firstKey = modelCompanionKeys[0];
  const modelSourceName = firstKey || `tencent_${tencentJobId}${extFromFile(orderedFiles[0]!)}`;

  let preview: PersistTencentModelsResult['preview'];
  const previewSrc = String(previewUrl || '').trim();
  if (previewSrc && /^https?:\/\//i.test(previewSrc)) {
    try {
      const prevBlob = await fetchTencentRemoteFileBlob(previewSrc, proxyUrl);
      if (useCompanion) {
        const dataUrl = await blobToDataUrl(prevBlob);
        const put = await putWorkflowResultImageToCompanion(base, pid, assetId, params.resultKey, dataUrl);
        if (put.ok === false) throw new Error(`预览图写入本地伴侣失败：${put.error}`);
        const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
        if (got.ok === false) throw new Error(`预览图从本地伴侣读取失败：${got.error}`);
        preview = { objectUrl: got.objectUrl, companionKey: put.key };
      } else {
        preview = {
          objectUrl: URL.createObjectURL(
            new Blob([await prevBlob.arrayBuffer()], { type: prevBlob.type || 'image/png' })
          ),
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log?.('warn', '[混元 归档] 预览图落盘失败，已保留模型', msg);
    }
  }

  return {
    modelUrls,
    modelCompanionKeys,
    stepModelFormats,
    modelSourceName,
    preview,
  };
}
