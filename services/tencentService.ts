/**
 * 腾讯云混元生3D API（ai3d）实现
 * 文档：https://cloud.tencent.com/document/product/1804
 * 接口：SubmitHunyuanTo3DProJob / QueryHunyuanTo3DProJob
 */

export interface TencentCredentials {
  secretId: string;
  secretKey: string;
  proxyUrl?: string;
}

/** 3D 生成任务进度回调 */
export interface TaskResponse {
  jobId: string;
  status: 'WAIT' | 'RUN' | 'FAIL' | 'DONE' | 'PENDING';
  progress: number;
}

/** 查询结果中的 3D 文件 */
export interface File3D {
  Type?: string;
  Url?: string;
  PreviewImageUrl?: string;
}

/** 专业版支持的视角（多视图时按此顺序传图，3.1 支持八视图） */
export const PRO_VIEW_IDS = ['front', 'rightFront', 'right', 'rightBack', 'back', 'leftBack', 'left', 'leftFront'] as const;
export const PRO_VIEW_LABELS: Record<(typeof PRO_VIEW_IDS)[number], string> = {
  front: '前',
  rightFront: '右前',
  right: '右',
  rightBack: '右后',
  back: '后',
  leftBack: '左后',
  left: '左',
  leftFront: '左前',
};

/** 提交专业版任务的输入：文生3D 或 图生3D（单图/多图） */
export interface Submit3DProInput {
  /** 文生3D 描述，最多 1024 字符 */
  prompt?: string;
  /** 图生3D 单图：图片 Base64（不含 data:xxx 前缀），单边 128–5000，≤6MB */
  imageBase64?: string;
  /** 图生3D 单图：图片 URL，单边 128–5000，≤8MB */
  imageUrl?: string;
  /** 图生3D 多视图（2–8 张）：按 PRO_VIEW_IDS 顺序的 Base64 数组（不含 data: 前缀），3.1 支持八视图 */
  multiViewImageBase64?: string[];
  /** 模型版本 3.0 | 3.1，默认 3.0 */
  model?: '3.0' | '3.1';
  /** 是否开启 PBR 材质，默认 false */
  enablePBR?: boolean;
  /** 面数，默认 500000，范围 10000–1500000（LowPoly 时 3000–1500000） */
  faceCount?: number;
  /** Normal | LowPoly | Geometry | Sketch，默认 Normal */
  generateType?: 'Normal' | 'LowPoly' | 'Geometry' | 'Sketch';
  /** LowPoly 时：triangle | quadrilateral，默认 triangle */
  polygonType?: 'triangle' | 'quadrilateral';
  /** 额外格式：STL | USDZ | FBX（仅一种）；默认返回 obj+glb */
  resultFormat?: string;
}

/** 专业版任务查询返回 */
export interface ProJobResult {
  jobId: string;
  status: 'WAIT' | 'RUN' | 'DONE' | 'FAIL';
  errorCode?: string;
  errorMessage?: string;
  resultFile3Ds: File3D[];
}

// ---------- 签名与请求 ----------
async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: string | Uint8Array, message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return new Uint8Array(signature);
}

async function getAuthHeader(
  secretId: string,
  secretKey: string,
  payload: Record<string, unknown>,
  timestamp: number,
  date: string,
  service: string,
  host: string
): Promise<string> {
  const contentType = 'application/json; charset=utf-8';
  const httpMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = await sha256(JSON.stringify(payload));
  const canonicalRequest = `${httpMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = await sha256(canonicalRequest);
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

  const kDate = await hmacSha256(`TC3${secretKey}`, date);
  const kService = await hmacSha256(kDate, service);
  const kSigning = await hmacSha256(kService, 'tc3_request');
  const signatureBuffer = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(signatureBuffer).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

const AI3D_HOST = 'ai3d.tencentcloudapi.com';
const AI3D_SERVICE = 'ai3d';
const AI3D_VERSION = '2025-05-13';
const AI3D_REGION = 'ap-guangzhou';

async function callAi3d(action: string, payload: Record<string, unknown>, creds: TencentCredentials): Promise<Record<string, unknown> & { _isError?: boolean; code?: string; message?: string }> {
  const proxyUrl = creds.proxyUrl?.replace(/\/$/, '');

  if (proxyUrl) {
    try {
      const response = await fetch(`${proxyUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      const data = await response.json();
      if (data.error) {
        const code = data.code || 'PROXY_ERROR';
        const message = data.code ? `[${data.code}] ${data.error}` : data.error;
        return { _isError: true, code, message, _raw: data };
      }
      const resp = data.Response ?? data;
      if (resp.Error) {
        const code = resp.Error.Code ?? 'Unknown';
        const message = resp.Error.Message ?? '';
        return { _isError: true, code, message, _raw: resp.Error };
      }
      return resp;
    } catch (e) {
      const err = e as Error;
      return { _isError: true, code: 'NETWORK_ERROR', message: err.message, _raw: err.message };
    }
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];
  const host = AI3D_HOST;
  const auth = await getAuthHeader(creds.secretId, creds.secretKey, payload, timestamp, date, AI3D_SERVICE, host);

  const headers: Record<string, string> = {
    'Authorization': auth,
    'Content-Type': 'application/json; charset=utf-8',
    'X-TC-Action': action,
    'X-TC-Timestamp': timestamp.toString(),
    'X-TC-Version': AI3D_VERSION,
    'X-TC-Region': AI3D_REGION,
  };

  try {
    const response = await fetch(`https://${host}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    const resp = data.Response ?? data;
    if (resp.Error) {
      const code = resp.Error.Code ?? 'Unknown';
      const message = resp.Error.Message ?? '';
      return { _isError: true, code, message, _raw: resp.Error };
    }
    return resp;
  } catch (e) {
    const err = e as Error;
    return { _isError: true, code: 'NETWORK_ERROR', message: err.message, _raw: err.message };
  }
}

/**
 * 提交混元生3D专业版任务（支持单图或多视图 2–8 张，3.1 支持八视图）
 */
export async function submitHunyuanTo3DProJob(input: Submit3DProInput, creds: TencentCredentials): Promise<string> {
  const hasPrompt = !!input.prompt?.trim();
  const hasSingle = !!(input.imageBase64 || input.imageUrl);
  const multi = input.multiViewImageBase64?.filter(Boolean) ?? [];
  const hasMulti = multi.length >= 2;
  if (!hasPrompt && !hasSingle && !hasMulti) {
    throw new Error('请提供文本描述（prompt）、单图或多视图图片（至少 2 张）');
  }
  if (hasPrompt && (hasSingle || hasMulti)) {
    throw new Error('文生3D 与 图生3D 不能同时使用');
  }
  if (hasSingle && hasMulti) {
    throw new Error('单图与多视图不能同时使用');
  }
  if (hasMulti && multi.length > 8) {
    throw new Error('多视图最多 8 张');
  }

  const body: Record<string, unknown> = {};
  if (input.prompt) body.Prompt = input.prompt.trim();
  if (hasMulti) {
    const rawList = multi.map((s) => s.replace(/^data:image\/\w+;base64,/, ''));
    body.ImageBase64s = rawList;
  } else if (input.imageBase64) {
    const raw = input.imageBase64.replace(/^data:image\/\w+;base64,/, '');
    body.ImageBase64 = raw;
  }
  if (!hasMulti && input.imageUrl) body.ImageUrl = input.imageUrl;
  if (input.model) body.Model = input.model;
  if (input.enablePBR != null) body.EnablePBR = input.enablePBR;
  if (input.faceCount != null) body.FaceCount = input.faceCount;
  if (input.generateType) body.GenerateType = input.generateType;
  if (input.polygonType) body.PolygonType = input.polygonType;
  if (input.resultFormat) body.ResultFormat = input.resultFormat;

  const res = await callAi3d('SubmitHunyuanTo3DProJob', body, creds);
  if (res._isError) {
    throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  }
  const jobId = res.JobId as string;
  if (!jobId) throw new Error('未返回 JobId');
  return jobId;
}

/**
 * 查询混元生3D专业版任务
 */
export async function queryHunyuanTo3DProJob(jobId: string, creds: TencentCredentials): Promise<ProJobResult> {
  const res = await callAi3d('QueryHunyuanTo3DProJob', { JobId: jobId }, creds);
  if (res._isError) {
    throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  }
  const status = ((res.Status as string) || 'WAIT') as ProJobResult['status'];
  const resultFile3Ds = (res.ResultFile3Ds as File3D[]) || [];
  return {
    jobId,
    status,
    errorCode: res.ErrorCode as string | undefined,
    errorMessage: res.ErrorMessage as string | undefined,
    resultFile3Ds,
  };
}

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 120; // 约 10 分钟

/**
 * 提交专业版任务并轮询直到完成，通过 onProgress 回调进度；可选 onLog 输出调试日志；成功返回结果文件列表，失败抛错。
 */
export async function startTencent3DProJob(
  input: Submit3DProInput,
  creds: TencentCredentials,
  onProgress: (task: TaskResponse) => void,
  onLog?: (message: string, detail?: unknown) => void
): Promise<File3D[]> {
  const log = (msg: string, d?: unknown) => { onLog?.(msg, d); };

  log('[混元生3D] 开始提交任务', { input: { ...input, imageBase64: input.imageBase64 ? '(已省略)' : undefined, imageUrl: input.imageUrl } });
  let jobId: string;
  try {
    jobId = await submitHunyuanTo3DProJob(input, creds);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log('[混元生3D] 提交失败', { error: err, hint: '若为 CORS/Network 错误，请通过后端代理调用 API' });
    throw e;
  }
  log('[混元生3D] 提交成功', { jobId });
  onProgress({ jobId, status: 'PENDING', progress: 5 });

  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;
    log(`[混元生3D] 轮询 #${attempts} 查询任务状态`, { jobId });
    let result: ProJobResult;
    try {
      result = await queryHunyuanTo3DProJob(jobId, creds);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log(`[混元生3D] 查询失败 #${attempts}`, { error: err });
      throw e;
    }
    const apiStatus = result.status;
    log(`[混元生3D] 状态`, { status: apiStatus, progress: apiStatus === 'DONE' ? 100 : apiStatus === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90), resultFile3DsCount: result.resultFile3Ds?.length });
    const taskStatus: TaskResponse['status'] = apiStatus === 'RUN' ? 'RUN' : apiStatus === 'WAIT' ? 'WAIT' : apiStatus === 'DONE' ? 'DONE' : 'FAIL';
    const progress = apiStatus === 'DONE' ? 100 : apiStatus === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90);
    onProgress({ jobId, status: taskStatus, progress });

    if (apiStatus === 'DONE') {
      log('[混元生3D] 任务完成', { resultFile3Ds: result.resultFile3Ds });
      return result.resultFile3Ds;
    }
    if (apiStatus === 'FAIL') {
      const msg = result.errorMessage || result.errorCode || '任务失败';
      log('[混元生3D] 任务失败', { errorCode: result.errorCode, errorMessage: result.errorMessage });
      throw new Error(msg);
    }
  }

  log('[混元生3D] 轮询超时', { attempts: POLL_MAX_ATTEMPTS });
  throw new Error('任务超时（约 10 分钟）');
}

/** 极速版输入：文生/图生，参数较专业版少，ResultFormat 可选 OBJ/GLB/STL/USDZ/FBX/MP4 */
export interface Submit3DRapidInput {
  prompt?: string;
  imageBase64?: string;
  imageUrl?: string;
  resultFormat?: string;
  enablePBR?: boolean;
}

/** 提交极速版任务 */
export async function submitHunyuanTo3DRapidJob(input: Submit3DRapidInput, creds: TencentCredentials): Promise<string> {
  const hasPrompt = !!input.prompt?.trim();
  const hasImage = !!(input.imageBase64 || input.imageUrl);
  if (!hasPrompt && !hasImage) throw new Error('请提供文本描述或图片之一');
  if (hasPrompt && hasImage) throw new Error('文生3D 与 图生3D 不能同时使用');

  const body: Record<string, unknown> = {};
  if (input.prompt) body.Prompt = input.prompt.trim();
  if (input.imageBase64) body.ImageBase64 = input.imageBase64.replace(/^data:image\/\w+;base64,/, '');
  if (input.imageUrl) body.ImageUrl = input.imageUrl;
  if (input.resultFormat) body.ResultFormat = input.resultFormat;
  if (input.enablePBR != null) body.EnablePBR = input.enablePBR;

  const res = await callAi3d('SubmitHunyuanTo3DRapidJob', body, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const jobId = res.JobId as string;
  if (!jobId) throw new Error('未返回 JobId');
  return jobId;
}

/** 查询极速版任务 */
export async function queryHunyuanTo3DRapidJob(jobId: string, creds: TencentCredentials): Promise<ProJobResult> {
  const res = await callAi3d('QueryHunyuanTo3DRapidJob', { JobId: jobId }, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const status = ((res.Status as string) || 'WAIT') as ProJobResult['status'];
  const resultFile3Ds = (res.ResultFile3Ds as File3D[]) || [];
  return {
    jobId,
    status,
    errorCode: res.ErrorCode as string | undefined,
    errorMessage: res.ErrorMessage as string | undefined,
    resultFile3Ds,
  };
}

/** 极速版任务并轮询直到完成 */
export async function startTencent3DRapidJob(
  input: Submit3DRapidInput,
  creds: TencentCredentials,
  onProgress: (task: TaskResponse) => void,
  onLog?: (message: string, detail?: unknown) => void
): Promise<File3D[]> {
  const log = (msg: string, d?: unknown) => { onLog?.(msg, d); };
  log('[极速版3D] 开始提交', input.prompt ? { prompt: input.prompt.slice(0, 50) } : { image: true });
  const jobId = await submitHunyuanTo3DRapidJob(input, creds);
  log('[极速版3D] 提交成功', { jobId });
  onProgress({ jobId, status: 'PENDING', progress: 5 });

  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;
    const result = await queryHunyuanTo3DRapidJob(jobId, creds);
    log(`[极速版3D] 轮询 #${attempts}`, { status: result.status });
    const progress = result.status === 'DONE' ? 100 : result.status === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90);
    onProgress({ jobId, status: result.status as TaskResponse['status'], progress });

    if (result.status === 'DONE') return result.resultFile3Ds;
    if (result.status === 'FAIL') throw new Error(result.errorMessage || result.errorCode || '任务失败');
  }
  throw new Error('任务超时');
}

/** 模型格式转换：输入 fbx/obj/glb URL，输出 STL/USDZ/FBX/MP4/GIF */
export async function convert3DFormat(
  input: { fileUrl: string; format: string },
  creds: TencentCredentials
): Promise<{ resultUrl: string }> {
  const res = await callAi3d('Convert3DFormat', { File3D: input.fileUrl, Format: input.format }, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const resultUrl = res.ResultFile3D as string;
  if (!resultUrl) throw new Error('未返回转换结果地址');
  return { resultUrl };
}

/** 从文件 URL 推断 3D 类型：OBJ/GLB/FBX */
function inferFileTypeFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('.glb') || u.endsWith('.glb')) return 'GLB';
  if (u.includes('.fbx') || u.endsWith('.fbx')) return 'FBX';
  return 'OBJ';
}

// ---------- 智能拓扑（ReduceFace）----------
/** 智能拓扑输入：高模 URL，可选减面档位与多边形类型 */
export interface SubmitReduceFaceInput {
  fileUrl: string;
  polygonType?: 'triangle' | 'quadrilateral';
  faceLevel?: 'high' | 'medium' | 'low';
}

export async function submitReduceFaceJob(input: SubmitReduceFaceInput, creds: TencentCredentials): Promise<string> {
  const body: Record<string, unknown> = {
    File3D: { Type: inferFileTypeFromUrl(input.fileUrl), Url: input.fileUrl.trim() },
  };
  if (input.polygonType) body.PolygonType = input.polygonType;
  if (input.faceLevel) body.FaceLevel = input.faceLevel;
  const res = await callAi3d('SubmitReduceFaceJob', body, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const jobId = res.JobId as string;
  if (!jobId) throw new Error('未返回 JobId');
  return jobId;
}

export async function describeReduceFaceJob(jobId: string, creds: TencentCredentials): Promise<ProJobResult> {
  const res = await callAi3d('DescribeReduceFaceJob', { JobId: jobId }, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const status = ((res.Status as string) || 'WAIT') as ProJobResult['status'];
  const resultFile3Ds = (res.ResultFile3Ds as File3D[]) || [];
  return { jobId, status, errorCode: res.ErrorCode as string | undefined, errorMessage: res.ErrorMessage as string | undefined, resultFile3Ds };
}

export async function startReduceFaceJob(
  input: SubmitReduceFaceInput,
  creds: TencentCredentials,
  onProgress: (task: TaskResponse) => void,
  onLog?: (message: string, detail?: unknown) => void
): Promise<File3D[]> {
  const log = (msg: string, d?: unknown) => { onLog?.(msg, d); };
  log('[智能拓扑] 提交任务', { fileUrl: input.fileUrl });
  const jobId = await submitReduceFaceJob(input, creds);
  onProgress({ jobId, status: 'PENDING', progress: 5 });
  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;
    const result = await describeReduceFaceJob(jobId, creds);
    const progress = result.status === 'DONE' ? 100 : result.status === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90);
    onProgress({ jobId, status: result.status as TaskResponse['status'], progress });
    if (result.status === 'DONE') return result.resultFile3Ds;
    if (result.status === 'FAIL') throw new Error(result.errorMessage || result.errorCode || '任务失败');
  }
  throw new Error('任务超时');
}

// ---------- 纹理生成（TextureTo3D）----------
/** 纹理生成输入：几何模型 URL + 参考图 Base64 或文字描述二选一 */
export interface SubmitTextureTo3DInput {
  modelUrl: string;
  prompt?: string;
  imageBase64?: string;
  enablePBR?: boolean;
}

export async function submitTextureTo3DJob(input: SubmitTextureTo3DInput, creds: TencentCredentials): Promise<string> {
  if (!input.modelUrl?.trim()) throw new Error('请提供几何模型 URL');
  const hasPrompt = !!input.prompt?.trim();
  const hasImage = !!input.imageBase64?.trim();
  if (!hasPrompt && !hasImage) throw new Error('请提供文字描述（prompt）或参考图（imageBase64）之一');
  if (hasPrompt && hasImage) throw new Error('prompt 与参考图不能同时使用');
  const body: Record<string, unknown> = {
    File3D: { Type: inferFileTypeFromUrl(input.modelUrl), Url: input.modelUrl.trim() },
  };
  if (hasPrompt) body.Prompt = input.prompt!.trim();
  if (hasImage) body.Image = { Base64: input.imageBase64!.replace(/^data:image\/\w+;base64,/, '') };
  if (input.enablePBR != null) body.EnablePBR = input.enablePBR;
  const res = await callAi3d('SubmitTextureTo3DJob', body, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const jobId = res.JobId as string;
  if (!jobId) throw new Error('未返回 JobId');
  return jobId;
}

export async function describeTextureTo3DJob(jobId: string, creds: TencentCredentials): Promise<ProJobResult> {
  const res = await callAi3d('DescribeTextureTo3DJob', { JobId: jobId }, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const status = ((res.Status as string) || 'WAIT') as ProJobResult['status'];
  const resultFile3Ds = (res.ResultFile3Ds as File3D[]) || [];
  return { jobId, status, errorCode: res.ErrorCode as string | undefined, errorMessage: res.ErrorMessage as string | undefined, resultFile3Ds };
}

export async function startTextureTo3DJob(
  input: SubmitTextureTo3DInput,
  creds: TencentCredentials,
  onProgress: (task: TaskResponse) => void,
  onLog?: (message: string, detail?: unknown) => void
): Promise<File3D[]> {
  const log = (msg: string, d?: unknown) => { onLog?.(msg, d); };
  log('[纹理生成] 提交任务', { modelUrl: input.modelUrl });
  const jobId = await submitTextureTo3DJob(input, creds);
  onProgress({ jobId, status: 'PENDING', progress: 5 });
  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;
    const result = await describeTextureTo3DJob(jobId, creds);
    const progress = result.status === 'DONE' ? 100 : result.status === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90);
    onProgress({ jobId, status: result.status as TaskResponse['status'], progress });
    if (result.status === 'DONE') return result.resultFile3Ds;
    if (result.status === 'FAIL') throw new Error(result.errorMessage || result.errorCode || '任务失败');
  }
  throw new Error('任务超时');
}

// ---------- UV 展开 ----------
export async function submitHunyuanTo3DUVJob(fileUrl: string, creds: TencentCredentials): Promise<string> {
  const body = { File: { Type: inferFileTypeFromUrl(fileUrl), Url: fileUrl.trim() } };
  const res = await callAi3d('SubmitHunyuanTo3DUVJob', body, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const jobId = res.JobId as string;
  if (!jobId) throw new Error('未返回 JobId');
  return jobId;
}

export async function describeHunyuanTo3DUVJob(jobId: string, creds: TencentCredentials): Promise<ProJobResult> {
  const res = await callAi3d('DescribeHunyuanTo3DUVJob', { JobId: jobId }, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const status = ((res.Status as string) || 'WAIT') as ProJobResult['status'];
  const resultFile3Ds = (res.ResultFile3Ds as File3D[]) || [];
  return { jobId, status, errorCode: res.ErrorCode as string | undefined, errorMessage: res.ErrorMessage as string | undefined, resultFile3Ds };
}

export async function startUVJob(
  fileUrl: string,
  creds: TencentCredentials,
  onProgress: (task: TaskResponse) => void,
  onLog?: (message: string, detail?: unknown) => void
): Promise<File3D[]> {
  const log = (msg: string, d?: unknown) => { onLog?.(msg, d); };
  log('[UV展开] 提交任务', { fileUrl });
  const jobId = await submitHunyuanTo3DUVJob(fileUrl, creds);
  onProgress({ jobId, status: 'PENDING', progress: 5 });
  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;
    const result = await describeHunyuanTo3DUVJob(jobId, creds);
    const progress = result.status === 'DONE' ? 100 : result.status === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90);
    onProgress({ jobId, status: result.status as TaskResponse['status'], progress });
    if (result.status === 'DONE') return result.resultFile3Ds;
    if (result.status === 'FAIL') throw new Error(result.errorMessage || result.errorCode || '任务失败');
  }
  throw new Error('任务超时');
}

// ---------- 组件生成（Hunyuan3DPart）----------
/** 组件生成输入：3D 模型 URL，仅支持 FBX；可选模型版本 1.0/1.5 */
export interface SubmitPartInput {
  fileUrl: string;
  model?: '1.0' | '1.5';
}

export async function submitHunyuan3DPartJob(input: SubmitPartInput, creds: TencentCredentials): Promise<string> {
  const body: Record<string, unknown> = { File: { Type: 'FBX', Url: input.fileUrl.trim() } };
  if (input.model) body.Model = input.model;
  const res = await callAi3d('SubmitHunyuan3DPartJob', body, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const jobId = res.JobId as string;
  if (!jobId) throw new Error('未返回 JobId');
  return jobId;
}

export async function queryHunyuan3DPartJob(jobId: string, creds: TencentCredentials): Promise<ProJobResult> {
  const res = await callAi3d('QueryHunyuan3DPartJob', { JobId: jobId }, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const status = ((res.Status as string) || 'WAIT') as ProJobResult['status'];
  const resultFile3Ds = (res.ResultFile3Ds as File3D[]) || [];
  return { jobId, status, errorCode: res.ErrorCode as string | undefined, errorMessage: res.ErrorMessage as string | undefined, resultFile3Ds };
}

export async function startPartJob(
  input: SubmitPartInput,
  creds: TencentCredentials,
  onProgress: (task: TaskResponse) => void,
  onLog?: (message: string, detail?: unknown) => void
): Promise<File3D[]> {
  const log = (msg: string, d?: unknown) => { onLog?.(msg, d); };
  log('[组件生成] 提交任务', { fileUrl: input.fileUrl });
  const jobId = await submitHunyuan3DPartJob(input, creds);
  onProgress({ jobId, status: 'PENDING', progress: 5 });
  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;
    const result = await queryHunyuan3DPartJob(jobId, creds);
    const progress = result.status === 'DONE' ? 100 : result.status === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90);
    onProgress({ jobId, status: result.status as TaskResponse['status'], progress });
    if (result.status === 'DONE') return result.resultFile3Ds;
    if (result.status === 'FAIL') throw new Error(result.errorMessage || result.errorCode || '任务失败');
  }
  throw new Error('任务超时');
}

// ---------- 3D 人物生成（ProfileTo3D）----------
/** 3D 人物生成输入：头像 Base64 或 URL，可选模板 */
export interface SubmitProfileTo3DInput {
  imageBase64?: string;
  imageUrl?: string;
  template?: string;
}

export async function submitProfileTo3DJob(input: SubmitProfileTo3DInput, creds: TencentCredentials): Promise<string> {
  const hasBase64 = !!input.imageBase64?.trim();
  const hasUrl = !!input.imageUrl?.trim();
  if (!hasBase64 && !hasUrl) throw new Error('请提供头像图片（Base64 或 URL）');
  const body: Record<string, unknown> = {};
  if (hasBase64) body.Profile = { Base64: input.imageBase64!.replace(/^data:image\/\w+;base64,/, '') };
  if (hasUrl) body.Profile = { Url: input.imageUrl!.trim() };
  if (input.template) body.Template = input.template;
  const res = await callAi3d('SubmitProfileTo3DJob', body, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const jobId = res.JobId as string;
  if (!jobId) throw new Error('未返回 JobId');
  return jobId;
}

export async function describeProfileTo3DJob(jobId: string, creds: TencentCredentials): Promise<ProJobResult> {
  const res = await callAi3d('DescribeProfileTo3DJob', { JobId: jobId }, creds);
  if (res._isError) throw new Error(`[TencentError] ${res.code}: ${res.message}`);
  const status = ((res.Status as string) || 'WAIT') as ProJobResult['status'];
  const resultFile3Ds = (res.ResultFile3Ds as File3D[]) || [];
  return { jobId, status, errorCode: res.ErrorCode as string | undefined, errorMessage: res.ErrorMessage as string | undefined, resultFile3Ds };
}

export async function startProfileTo3DJob(
  input: SubmitProfileTo3DInput,
  creds: TencentCredentials,
  onProgress: (task: TaskResponse) => void,
  onLog?: (message: string, detail?: unknown) => void
): Promise<File3D[]> {
  const log = (msg: string, d?: unknown) => { onLog?.(msg, d); };
  log('[3D人物] 提交任务');
  const jobId = await submitProfileTo3DJob(input, creds);
  onProgress({ jobId, status: 'PENDING', progress: 5 });
  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;
    const result = await describeProfileTo3DJob(jobId, creds);
    const progress = result.status === 'DONE' ? 100 : result.status === 'FAIL' ? 0 : Math.min(20 + attempts * 2, 90);
    onProgress({ jobId, status: result.status as TaskResponse['status'], progress });
    if (result.status === 'DONE') return result.resultFile3Ds;
    if (result.status === 'FAIL') throw new Error(result.errorMessage || result.errorCode || '任务失败');
  }
  throw new Error('任务超时');
}

/** 从环境或参数获取凭证；环境变量由 Vite 注入：TENCENT_SECRET_ID, TENCENT_SECRET_KEY, VITE_TENCENT_PROXY */
export function getTencentCredsFromEnv(): TencentCredentials | null {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const secretId = (env.TENCENT_SECRET_ID as string)?.trim();
  const secretKey = (env.TENCENT_SECRET_KEY as string)?.trim();
  const proxyUrl = (env.VITE_TENCENT_PROXY as string)?.trim();
  if (proxyUrl) {
    return { secretId: secretId || '', secretKey: secretKey || '', proxyUrl };
  }
  if (secretId && secretKey) return { secretId, secretKey };
  return null;
}
