import { companionFetchJson } from '../../../services/companionClient/fetch';
import { companionWorkbenchBase } from './companionWorkbenchClient';

export type ComputeJobCreateResponse = {
  jobId: string;
  status: string;
  job: { jobId: string; type: string; status: string; error?: { code: string; message?: string } };
};

/** 独立类型别名，避免 `companionFetchJson<{ ...` 被 esbuild 误解析为比较运算 */
type CompanionComputeJobGetResponse = {
  job: {
    jobId: string;
    status: string;
    result?: { note?: string };
    error?: { code: string; message?: string };
  };
};

export type SubmitScriptMayaJobPayload =
  | {
      content: string;
      params: Record<string, unknown>;
      mayaHost?: string;
      mayaPort?: number;
      timeoutMs?: number;
    }
  | {
      scriptSource: 'cloud';
      scriptId: string;
      revisionId: string;
      contentJwt: string;
      params: Record<string, unknown>;
      mayaHost?: string;
      mayaPort?: number;
      timeoutMs?: number;
    };

export async function submitScriptMayaJob(payload: SubmitScriptMayaJobPayload): Promise<ComputeJobCreateResponse> {
  const maya =
    payload.mayaHost || payload.mayaPort
      ? { host: payload.mayaHost ?? '127.0.0.1', port: payload.mayaPort ?? 7001 }
      : undefined;
  const cloud =
    'scriptSource' in payload &&
    payload.scriptSource === 'cloud' &&
    payload.scriptId &&
    payload.revisionId &&
    payload.contentJwt;
  const body = {
    protocolVersion: 1,
    type: 'script.maya',
    inputs: {
      ...(cloud
        ? {
            scriptSource: 'cloud' as const,
            scriptId: payload.scriptId,
            revisionId: payload.revisionId,
            contentJwt: payload.contentJwt,
          }
        : { content: 'content' in payload ? payload.content : '' }),
      ...(maya ? { maya } : {}),
      ...(payload.timeoutMs ? { timeoutMs: payload.timeoutMs } : {}),
    },
    params: payload.params,
  };
  const res = await companionFetchJson<ComputeJobCreateResponse>(companionWorkbenchBase(), '/v1/compute/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.data;
}

export async function getComputeJob(jobId: string) {
  const path = `/v1/compute/jobs/${encodeURIComponent(jobId)}`;
  const res = await companionFetchJson<CompanionComputeJobGetResponse>(companionWorkbenchBase(), path, {
    method: 'GET',
  });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export type ComputeJobTerminal = CompanionComputeJobGetResponse['job'];

const MAYA_JOB_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: 'Maya 执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function formatMayaJobStatus(status: string): string {
  return MAYA_JOB_STATUS_LABEL[status] ?? status;
}

/** 轮询伴侣 compute job 直至终态或超时 */
export async function waitForComputeJob(
  jobId: string,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    onStatus?: (job: ComputeJobTerminal) => void;
  },
): Promise<ComputeJobTerminal> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 130_000);
  const pollMs = opts?.pollMs ?? 400;
  while (Date.now() < deadline) {
    const { job } = await getComputeJob(jobId);
    opts?.onStatus?.(job);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('执行超时');
}
