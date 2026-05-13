import { companionFetchJson } from './fetch';

export type CompanionJobRecordV1 = {
  jobId: string;
  type: string;
  projectId?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  result?: { note?: string; adapterId?: string; samMultimaskKeys?: string[] };
  error?: { code: string; message?: string };
};

export type CompanionJobEventV1 = {
  seq: number;
  at: number;
  jobId: string;
  type:
    | 'task.accepted'
    | 'task.running'
    | 'reply.delta'
    | 'reply.completed'
    | 'task.failed'
    | 'task.cancelled';
  payload?: Record<string, unknown>;
};

export type CompanionSubmitJobBody = {
  protocolVersion?: number;
  type: string;
  jobId?: string;
  projectId?: string;
  inputs?: unknown;
  params?: unknown;
};

/** 与宿主 `seam_repair` Job 的 `inputs` 对象一致（资产须已 PUT 至 projectId）。 */
export type CompanionSeamRepairInputsV1 = {
  objKey: string;
  textureKey: string;
  maskKey?: string;
  outputKey?: string;
};

/** SamSegmentPromptV1 — 与 `docs/本地伴侣SAM分割-产品开发规格.md`、伴侣 `samSegmentAdapter` 一致 */
export type CompanionSamSegmentPromptPointV1 = { x: number; y: number; label: number };

export type CompanionSamSegmentPromptBoxV1 = { x1: number; y1: number; x2: number; y2: number };

export type CompanionSamSegmentPromptV1 = {
  coordSpace: 'pixel';
  width: number;
  height: number;
  /** 全图自动拆分（SamAutomaticMaskGenerator） */
  autoSegment?: boolean;
  points?: CompanionSamSegmentPromptPointV1[];
  box?: CompanionSamSegmentPromptBoxV1 | null;
  multimaskOutput?: boolean;
  /** 为 true 时 SamLocal 返回 JSON 多图，伴侣写入主键 + _m1… */
  returnAllMasks?: boolean;
};

/** 与宿主 `sam_segment` Job 的 `inputs` 一致（`params.prompt` 必填） */
export type CompanionSamSegmentInputsV1 = {
  imageKey: string;
  outputKey: string;
};

export async function submitCompanionJob(baseUrl: string, body: CompanionSubmitJobBody | { job: CompanionSubmitJobBody }) {
  return companionFetchJson<{ jobId: string; status: string; job: CompanionJobRecordV1 }>(baseUrl, '/v1/compute/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function submitCompanionSeamRepairJob(
  baseUrl: string,
  projectId: string,
  inputs: CompanionSeamRepairInputsV1,
  params?: Record<string, unknown>,
) {
  return submitCompanionJob(baseUrl, {
    protocolVersion: 1,
    type: 'seam_repair',
    projectId,
    inputs,
    params: params ?? {},
  });
}

export async function submitCompanionSamSegmentJob(
  baseUrl: string,
  projectId: string,
  inputs: CompanionSamSegmentInputsV1,
  params: { prompt: CompanionSamSegmentPromptV1 },
) {
  return submitCompanionJob(baseUrl, {
    protocolVersion: 1,
    type: 'sam_segment',
    projectId,
    inputs,
    params,
  });
}

/** 与宿主 `remove_bg` Job 的 `inputs` 一致 */
export type CompanionRembgInputsV1 = {
  imageKey: string;
  outputKey: string;
};

/** 可选：`model` 为伴侣白名单内 id；`alphaMatting` 较慢但更细腻 */
export type CompanionRembgParamsV1 = {
  model?: string;
  alphaMatting?: boolean;
};

export async function submitCompanionRembgJob(
  baseUrl: string,
  projectId: string,
  inputs: CompanionRembgInputsV1,
  params?: CompanionRembgParamsV1,
) {
  return submitCompanionJob(baseUrl, {
    protocolVersion: 1,
    type: 'remove_bg',
    projectId,
    inputs,
    params: params ?? {},
  });
}

/** 与伴侣 `host_bundle.probe` / `host_bundle.exec` 的 `inputs` 一致 */
export type CompanionHostBundleJobInputsV1 = { dirName: string };

export async function submitCompanionHostBundleProbeJob(
  baseUrl: string,
  dirName: string,
  opts?: { projectId?: string },
) {
  return submitCompanionJob(baseUrl, {
    protocolVersion: 1,
    type: 'host_bundle.probe',
    projectId: opts?.projectId,
    inputs: { dirName },
  });
}

export async function submitCompanionHostBundleExecJob(
  baseUrl: string,
  dirName: string,
  opts?: { projectId?: string },
) {
  return submitCompanionJob(baseUrl, {
    protocolVersion: 1,
    type: 'host_bundle.exec',
    projectId: opts?.projectId,
    inputs: { dirName },
  });
}

export async function listCompanionJobs(baseUrl: string) {
  return companionFetchJson<{ jobs: CompanionJobRecordV1[] }>(baseUrl, '/v1/compute/jobs');
}

export async function getCompanionJob(baseUrl: string, jobId: string) {
  const id = encodeURIComponent(jobId);
  return companionFetchJson<{ job: CompanionJobRecordV1 }>(baseUrl, `/v1/compute/jobs/${id}`);
}

export async function cancelCompanionJob(baseUrl: string, jobId: string) {
  const id = encodeURIComponent(jobId);
  return companionFetchJson<{ ok: boolean; jobId: string }>(baseUrl, `/v1/compute/jobs/${id}`, {
    method: 'DELETE',
  });
}

export async function listCompanionJobEvents(baseUrl: string, jobId: string, afterSeq = 0, limit = 100) {
  const id = encodeURIComponent(jobId);
  const p = new URLSearchParams();
  if (afterSeq > 0) p.set('afterSeq', String(Math.floor(afterSeq)));
  if (limit > 0) p.set('limit', String(Math.floor(limit)));
  const qs = p.toString();
  return companionFetchJson<{ jobId: string; events: CompanionJobEventV1[]; nextAfterSeq: number }>(
    baseUrl,
    `/v1/compute/jobs/${id}/events${qs ? `?${qs}` : ''}`,
  );
}

export function createCompanionJobEventStream(baseUrl: string, jobId: string, afterSeq = 0) {
  const id = encodeURIComponent(jobId);
  const p = new URLSearchParams();
  if (afterSeq > 0) p.set('afterSeq', String(Math.floor(afterSeq)));
  const qs = p.toString();
  const root = baseUrl.replace(/\/+$/, '');
  return new EventSource(`${root}/v1/compute/jobs/${id}/stream${qs ? `?${qs}` : ''}`);
}
