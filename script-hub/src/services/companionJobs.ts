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
