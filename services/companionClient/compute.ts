import { companionFetchJson } from './fetch';

export type CompanionJobRecordV1 = {
  jobId: string;
  type: string;
  projectId?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  result?: { note?: string; adapterId?: string };
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
