import type { CustomAppModule } from '../../types';
import type { File3D, Submit3DProInput, Submit3DRapidInput, TencentCredentials } from '../tencentService';
import { startTencent3DProJob, startTencent3DRapidJob } from '../tencentService';
import { normalizeGenerate3DPresetForRun } from './normalizePreset';

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

export function buildTencentProInputFromPreset(params: {
  preset: CustomAppModule;
  imageDataUrl: string;
}): Submit3DProInput {
  const g = normalizeGenerate3DPresetForRun(params.preset.generate3D!);
  return {
    imageBase64: stripDataUrlPrefix(params.imageDataUrl),
    model: g.model ?? '3.0',
    enablePBR: g.enablePBR,
    faceCount: g.faceCount,
    generateType: g.generateType,
    polygonType: g.generateType === 'LowPoly' ? g.polygonType : undefined,
    resultFormat: g.resultFormat,
  };
}

export function buildTencentRapidInputFromPreset(params: {
  preset: CustomAppModule;
  imageDataUrl: string;
}): Submit3DRapidInput {
  const g = normalizeGenerate3DPresetForRun(params.preset.generate3D!);
  return {
    imageBase64: stripDataUrlPrefix(params.imageDataUrl),
    resultFormat: g.resultFormat,
    enablePBR: g.enablePBR,
  };
}

function fileTypeRank(file: File3D): number {
  const type = String(file.Type || '').toUpperCase();
  if (type === 'GLB') return 0;
  if (type === 'GLTF') return 1;
  if (type === 'OBJ') return 2;
  if (type === 'FBX') return 3;
  if (type === 'STL') return 4;
  if (type === 'USDZ') return 5;
  return 9;
}

/** 从混元 ResultFile3Ds 拆出模型 URL 与预览图 */
export function extractTencentModelAndPreviewUrls(files: File3D[]): {
  modelUrls: string[];
  previewUrl: string;
  orderedFiles: File3D[];
} {
  const withUrl = files.filter((f) => String(f.Url || '').trim());
  const orderedFiles = [...withUrl].sort((a, b) => fileTypeRank(a) - fileTypeRank(b));
  const modelUrls = orderedFiles.map((f) => String(f.Url).trim());
  const previewFromField = orderedFiles.map((f) => String(f.PreviewImageUrl || '').trim()).find(Boolean) || '';
  const previewFromUrl = modelUrls.find((u) => /\.(png|jpe?g|webp)(\?|#|$)/i.test(u)) || '';
  return {
    modelUrls,
    previewUrl: previewFromField || previewFromUrl,
    orderedFiles,
  };
}

export async function tencentWorkflowRunImageTo3D(params: {
  creds: TencentCredentials;
  preset: CustomAppModule;
  imageDataUrl: string;
  onProgress?: (progress: number) => void;
  onLog?: (message: string, detail?: unknown) => void;
}): Promise<{ jobId: string; files: File3D[] }> {
  const g = normalizeGenerate3DPresetForRun(params.preset.generate3D!);
  let jobId = '';
  const onTaskProgress = (task: { jobId: string; progress: number }) => {
    jobId = task.jobId || jobId;
    params.onProgress?.(task.progress);
  };
  const onLog = (message: string, detail?: unknown) => params.onLog?.(message, detail);

  if (g.module === 'rapid') {
    const input = buildTencentRapidInputFromPreset({
      preset: params.preset,
      imageDataUrl: params.imageDataUrl,
    });
  const files = await startTencent3DRapidJob(input, params.creds, onTaskProgress, onLog);
  if (!jobId) throw new Error('混元极速版未返回 JobId');
  return { jobId, files };
  }

  const input = buildTencentProInputFromPreset({
    preset: params.preset,
    imageDataUrl: params.imageDataUrl,
  });
  const files = await startTencent3DProJob(input, params.creds, onTaskProgress, onLog);
  if (!jobId) throw new Error('混元专业版未返回 JobId');
  return { jobId, files };
}
