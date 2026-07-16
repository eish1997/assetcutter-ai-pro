import { extractTripoModelAndPreviewUrls } from './generate3d/tripoWorkflow';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import {
  createTripoConvertModelTask,
  fetchTripoRemoteFileBlob,
  waitTripoTaskDone,
} from './tripoService';
import {
  fetchWorkflowModelFromCompanionAsObjectUrl,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  putWorkflowModelBlobToCompanion,
  putWorkflowResultImageToCompanion,
} from './workflowCompanionAssets';

export type WorkflowModelSlotFormat = 'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'usdz' | 'zip';

export type PersistTripoModelsResult = {
  modelUrls: string[];
  modelCompanionKeys: string[];
  stepModelFormats: WorkflowModelSlotFormat[];
  modelSourceName?: string;
  preview?: {
    objectUrl: string;
    companionKey?: string;
  };
};

function extractExt(url: string, contentType: string, fallback: string): string {
  const cleanUrl = String(url || '').split('?')[0].split('#')[0];
  const dot = cleanUrl.lastIndexOf('.');
  if (dot >= 0 && dot < cleanUrl.length - 1) {
    const ext = cleanUrl.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{2,8}$/.test(ext)) return `.${ext}`;
  }
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('model/gltf+json')) return '.gltf';
  if (ct.includes('model/gltf-binary')) return '.glb';
  if (ct.includes('fbx')) return '.fbx';
  if (ct.includes('model/stl')) return '.stl';
  if (ct.includes('image/png')) return '.png';
  if (ct.includes('image/webp')) return '.webp';
  if (ct.includes('image/jpeg')) return '.jpg';
  return fallback;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function persistModelBlobToSlot(params: {
  apiKey: string;
  url: string;
  assetId: string;
  slotIndex: number;
  format: WorkflowModelSlotFormat;
  useCompanion: boolean;
  base: string;
  pid: string;
  fileNameHint?: string;
}): Promise<{ objectUrl: string; companionKey?: string }> {
  const blob = await fetchTripoRemoteFileBlob(params.apiKey, params.url);
  if (params.useCompanion) {
    const put = await putWorkflowModelBlobToCompanion(
      params.base,
      params.pid,
      params.assetId,
      params.slotIndex,
      blob,
      params.fileNameHint || `${params.format}`
    );
    if (put.ok === false) {
      throw new Error(`写入本地伴侣失败：${put.error}`);
    }
    const got = await fetchWorkflowModelFromCompanionAsObjectUrl(
      params.base,
      params.pid,
      put.key,
      params.fileNameHint
    );
    if (got.ok === false) {
      throw new Error(`读取本地伴侣模型失败：${got.error}`);
    }
    return { objectUrl: got.objectUrl, companionKey: put.key };
  }
  return {
    objectUrl: URL.createObjectURL(
      new Blob([await blob.arrayBuffer()], { type: blob.type || 'application/octet-stream' })
    ),
  };
}

/**
 * Tripo 生成成功后：GLB 落本地伴侣（预览用）+ FBX 归档（防 Tripo 直链/任务过期）。
 * 已有槽位时可跳过重复下载，仅补缺失格式。
 */
export async function persistTripoModelsForWorkflowAsset(params: {
  apiKey: string;
  tripoTaskId: string;
  assetId: string;
  resultKey: string;
  glbSourceUrls: string[];
  previewUrl?: string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  existing?: {
    urls?: string[];
    companionKeys?: string[];
    formats?: WorkflowModelSlotFormat[];
  };
  includeFbxArchive?: boolean;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
}): Promise<PersistTripoModelsResult> {
  const apiKey = String(params.apiKey || '').trim();
  const tripoTaskId = String(params.tripoTaskId || '').trim();
  const assetId = String(params.assetId || '').trim();
  const glbUrl = String(params.glbSourceUrls[0] || '').trim();
  if (!apiKey) throw new Error('缺少 Tripo API Key');
  if (!tripoTaskId) throw new Error('缺少 tripoTaskId');
  if (!glbUrl) throw new Error('缺少 GLB 下载地址');

  const baseRaw = String(params.companionBaseUrl || '').trim();
  const pid = String(params.companionProjectId || '').trim();
  const base = baseRaw ? normalizeCompanionBaseUrl(baseRaw) : '';
  const useCompanion = Boolean(base && pid);
  const includeFbx = params.includeFbxArchive !== false;
  const log = params.onLog;

  const existingFormats = params.existing?.formats || [];
  const existingUrls = params.existing?.urls || [];
  const existingKeys = params.existing?.companionKeys || [];

  const modelUrls: string[] = [];
  const modelCompanionKeys: string[] = [];
  const stepModelFormats: WorkflowModelSlotFormat[] = [];

  const hasGlb = existingFormats.includes('glb') && Boolean(existingUrls[existingFormats.indexOf('glb')]);
  if (hasGlb) {
    const glbIdx = existingFormats.indexOf('glb');
    modelUrls.push(existingUrls[glbIdx]!);
    if (existingKeys[glbIdx]) modelCompanionKeys.push(existingKeys[glbIdx]!);
    stepModelFormats.push('glb');
    log?.('info', '[Tripo 归档] 已存在 GLB 本地副本，跳过重复落盘');
  } else {
    log?.('info', '[Tripo 归档] 落盘 GLB 到本地伴侣', { slot: 0 });
    const glb = await persistModelBlobToSlot({
      apiKey,
      url: glbUrl,
      assetId,
      slotIndex: 0,
      format: 'glb',
      useCompanion,
      base,
      pid,
      fileNameHint: `tripo_${tripoTaskId}_glb`,
    });
    modelUrls.push(glb.objectUrl);
    if (glb.companionKey) modelCompanionKeys.push(glb.companionKey);
    stepModelFormats.push('glb');
  }

  const hasFbx = existingFormats.includes('fbx') && Boolean(existingUrls[existingFormats.indexOf('fbx')]);
  if (includeFbx && !hasFbx) {
    try {
      log?.('info', '[Tripo 归档] 提交 FBX 格式转换（convert_model）', { tripoTaskId });
      const convertTaskId = await createTripoConvertModelTask(apiKey, tripoTaskId, 'FBX');
      const converted = await waitTripoTaskDone(apiKey, convertTaskId, {
        timeoutMs: 8 * 60_000,
        onProgress: (s) => log?.('info', `[Tripo 归档] FBX 转换中：${s}`),
      });
      if (converted.status !== 'success') {
        throw new Error(`FBX 转换失败：${converted.status}`);
      }
      const { modelUrls: fbxUrls } = extractTripoModelAndPreviewUrls(converted);
      const fbxUrl = fbxUrls.find((u) => /\.fbx(\?|#|$)/i.test(u)) || fbxUrls[0];
      if (!fbxUrl) {
        log?.('warn', '[Tripo 归档] FBX 转换完成但未解析到下载链接，仅保留 GLB');
      } else {
        log?.('info', '[Tripo 归档] 落盘 FBX 到本地伴侣', { slot: 1 });
        const fbx = await persistModelBlobToSlot({
          apiKey,
          url: fbxUrl,
          assetId,
          slotIndex: 1,
          format: 'fbx',
          useCompanion,
          base,
          pid,
          fileNameHint: `tripo_${tripoTaskId}_fbx`,
        });
        modelUrls.push(fbx.objectUrl);
        if (fbx.companionKey) modelCompanionKeys.push(fbx.companionKey);
        stepModelFormats.push('fbx');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log?.('warn', '[Tripo 归档] FBX 转换/落盘失败，已保留 GLB 本地副本', msg);
    }
  } else if (hasFbx) {
    const fbxIdx = existingFormats.indexOf('fbx');
    modelUrls.push(existingUrls[fbxIdx]!);
    if (existingKeys[fbxIdx]) modelCompanionKeys.push(existingKeys[fbxIdx]!);
    stepModelFormats.push('fbx');
  }

  const firstKey = modelCompanionKeys[0];
  const modelSourceName = firstKey || `tripo_${tripoTaskId}${extractExt(glbUrl, '', '.glb')}`;

  let preview: PersistTripoModelsResult['preview'];
  const previewUrl = String(params.previewUrl || '').trim();
  if (previewUrl && /^https?:\/\//i.test(previewUrl)) {
    const prevBlob = await fetchTripoRemoteFileBlob(apiKey, previewUrl);
    if (useCompanion) {
      const dataUrl = await blobToDataUrl(prevBlob);
      const put = await putWorkflowResultImageToCompanion(base, pid, assetId, params.resultKey, dataUrl);
      if (put.ok === false) {
        throw new Error(`预览图写入本地伴侣失败：${put.error}`);
      }
      const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
      if (got.ok === false) {
        throw new Error(`预览图从本地伴侣读取失败：${got.error}`);
      }
      preview = { objectUrl: got.objectUrl, companionKey: put.key };
    } else {
      preview = {
        objectUrl: URL.createObjectURL(
          new Blob([await prevBlob.arrayBuffer()], { type: prevBlob.type || 'image/png' })
        ),
      };
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
