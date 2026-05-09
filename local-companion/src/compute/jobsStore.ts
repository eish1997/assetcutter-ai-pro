import { randomUUID } from 'node:crypto';
import {
  resolveSeamRepairKeys,
  runSeamRepairJob,
  SEAM_ADAPTER_ID,
} from './seamRepairAdapter.js';
import {
  resolveSamSegmentKeys,
  runSamSegmentJob,
  SAM_SEGMENT_ADAPTER_ID,
} from './samSegmentAdapter.js';
import { HOST_BUNDLE_ADAPTER_ID, runHostBundlePhase } from './hostBundleExecAdapter.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type JobRecordV1 = {
  jobId: string;
  type: string;
  projectId?: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  result?: { note?: string; adapterId?: string; samMultimaskKeys?: string[] };
  error?: { code: string; message?: string };
};

export type JobEventType =
  | 'task.accepted'
  | 'task.running'
  | 'reply.delta'
  | 'reply.completed'
  | 'task.failed'
  | 'task.cancelled';

export type JobEventV1 = {
  seq: number;
  at: number;
  jobId: string;
  type: JobEventType;
  payload?: Record<string, unknown>;
};

const ADAPTER_STUB = 'stub.ping@v0.1.0';

const jobs = new Map<string, JobRecordV1>();
const jobEvents = new Map<string, JobEventV1[]>();
const jobSeq = new Map<string, number>();

export const REGISTERED_COMPUTE_TYPES: Record<string, { adapterId: string; description: string }> = {
  'stub.ping': {
    adapterId: ADAPTER_STUB,
    description: 'P0 冒烟：立即完成，用于联调 HTTP 与 Job 信封',
  },
  seam_repair: {
    adapterId: SEAM_ADAPTER_ID,
    description: '贴图修缝：读 Volume 内 OBJ/贴图/Mask，调用 WebSeamRepair /api/repair',
  },
  sam_segment: {
    adapterId: SAM_SEGMENT_ADAPTER_ID,
    description: '本机分割：读 Volume 内图像与 params.prompt，调用 SamLocal /v1/segment/predict，写回 mask PNG',
  },
  'host_bundle.exec': {
    adapterId: HOST_BUNDLE_ADAPTER_ID,
    description:
      '宿主插件包 run.json 的 exec：inputs.dirName 为 host-bundles 下目录名；命令仅来自磁盘 run.json',
  },
  'host_bundle.probe': {
    adapterId: HOST_BUNDLE_ADAPTER_ID,
    description: '宿主插件包 run.json 的 probe；inputs 同上',
  },
};

type SubmitInput = {
  type?: string;
  jobId?: string;
  projectId?: string;
  protocolVersion?: number;
  inputs?: unknown;
  params?: unknown;
};

function nextSeq(jobId: string): number {
  const n = (jobSeq.get(jobId) ?? 0) + 1;
  jobSeq.set(jobId, n);
  return n;
}

function emitJobEvent(jobId: string, type: JobEventType, payload?: Record<string, unknown>): void {
  const list = jobEvents.get(jobId) ?? [];
  list.push({
    seq: nextSeq(jobId),
    at: Date.now(),
    jobId,
    type,
    payload,
  });
  // 仅保留最近 200 条，避免内存无限增长
  if (list.length > 200) list.splice(0, list.length - 200);
  jobEvents.set(jobId, list);
}

export async function submitJob(
  body: unknown,
): Promise<{ ok: true; job: JobRecordV1 } | { error: string; code: string }> {
  if (!body || typeof body !== 'object') {
    return { error: 'invalid_json', code: 'COMPUTE_INVALID_BODY' };
  }
  const b = body as SubmitInput;
  if (b.protocolVersion !== undefined && b.protocolVersion !== 1) {
    return { error: 'unsupported protocolVersion', code: 'COMPUTE_BAD_PROTOCOL' };
  }
  const type = typeof b.type === 'string' ? b.type : '';
  if (!type) return { error: 'missing type', code: 'COMPUTE_BAD_JOB' };
  const jobId = typeof b.jobId === 'string' && b.jobId ? b.jobId : randomUUID();
  if (jobs.has(jobId)) {
    return { error: 'jobId already exists', code: 'COMPUTE_DUPLICATE' };
  }
  const projectId = typeof b.projectId === 'string' ? b.projectId : undefined;

  const rec: JobRecordV1 = {
    jobId,
    type,
    projectId,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  emitJobEvent(jobId, 'task.accepted', { type, projectId: projectId ?? null });

  if (type === 'stub.ping') {
    rec.status = 'completed';
    rec.result = { adapterId: ADAPTER_STUB, note: 'stub: accepted and finished synchronously' };
    emitJobEvent(jobId, 'reply.completed', {
      adapterId: ADAPTER_STUB,
      note: rec.result.note ?? '',
    });
  } else if (type === 'seam_repair') {
    const resolved = resolveSeamRepairKeys(projectId, b.inputs);
    if ('error' in resolved) {
      rec.status = 'failed';
      rec.error = { code: resolved.code, message: resolved.error };
      emitJobEvent(jobId, 'task.failed', { code: resolved.code, message: resolved.error });
    } else {
      rec.status = 'running';
      rec.updatedAt = Date.now();
      jobs.set(jobId, rec);
      emitJobEvent(jobId, 'task.running', {
        adapterId: SEAM_ADAPTER_ID,
        stage: 'start',
      });
      const pid = projectId as string;
      emitJobEvent(jobId, 'reply.delta', {
        stage: 'dispatch',
        text: 'seam_repair dispatched to local backend',
      });
      const run = await runSeamRepairJob(pid, resolved.ok, b.params ?? {});
      if ('error' in run) {
        rec.status = 'failed';
        rec.error = { code: run.code, message: run.error };
        emitJobEvent(jobId, 'task.failed', { code: run.code, message: run.error });
      } else {
        rec.status = 'completed';
        rec.result = {
          adapterId: SEAM_ADAPTER_ID,
          note: run.outputKey
            ? `PNG → asset key=${run.outputKey} (${run.bytesOut} bytes)`
            : `PNG ${run.bytesOut} bytes（未设置 outputKey 则未写入 Volume）`,
        };
        emitJobEvent(jobId, 'reply.completed', {
          adapterId: SEAM_ADAPTER_ID,
          outputKey: run.outputKey ?? null,
          bytesOut: run.bytesOut,
          note: rec.result.note ?? '',
        });
      }
    }
  } else if (type === 'sam_segment') {
    const resolved = resolveSamSegmentKeys(projectId, b.inputs, b.params ?? {});
    if ('error' in resolved) {
      rec.status = 'failed';
      rec.error = { code: resolved.code, message: resolved.error };
      emitJobEvent(jobId, 'task.failed', { code: resolved.code, message: resolved.error });
    } else {
      rec.status = 'running';
      rec.updatedAt = Date.now();
      jobs.set(jobId, rec);
      emitJobEvent(jobId, 'task.running', {
        adapterId: SAM_SEGMENT_ADAPTER_ID,
        stage: 'start',
      });
      const pid = projectId as string;
      emitJobEvent(jobId, 'reply.delta', {
        stage: 'dispatch',
        text: 'sam_segment dispatched to local SamLocal',
      });
      const run = await runSamSegmentJob(pid, resolved.ok);
      if ('error' in run) {
        rec.status = 'failed';
        rec.error = { code: run.code, message: run.error };
        emitJobEvent(jobId, 'task.failed', { code: run.code, message: run.error });
      } else {
        rec.status = 'completed';
        rec.result = {
          adapterId: SAM_SEGMENT_ADAPTER_ID,
          note: `PNG → asset key=${run.outputKey} (${run.bytesOut} bytes)`,
          ...(run.samMultimaskKeys?.length ? { samMultimaskKeys: run.samMultimaskKeys } : {}),
        };
        emitJobEvent(jobId, 'reply.completed', {
          adapterId: SAM_SEGMENT_ADAPTER_ID,
          outputKey: run.outputKey,
          bytesOut: run.bytesOut,
          note: rec.result.note ?? '',
          ...(run.samMultimaskKeys?.length ? { samMultimaskKeys: run.samMultimaskKeys } : {}),
        });
      }
    }
  } else if (type === 'host_bundle.exec' || type === 'host_bundle.probe') {
    rec.status = 'running';
    rec.updatedAt = Date.now();
    jobs.set(jobId, rec);
    emitJobEvent(jobId, 'task.running', {
      adapterId: HOST_BUNDLE_ADAPTER_ID,
      phase: type,
    });
    const phase = type === 'host_bundle.exec' ? 'exec' : 'probe';
    const run = await runHostBundlePhase({ phase, inputs: b.inputs });
    if ('error' in run) {
      rec.status = 'failed';
      rec.error = { code: run.code, message: run.error };
      emitJobEvent(jobId, 'task.failed', { code: run.code, message: run.error });
    } else {
      const { exitCode, signal, stdout, stderr, bundleDir } = run.ok;
      const okExit = exitCode === 0;
      rec.status = okExit ? 'completed' : 'failed';
      const tail = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…`);
      if (okExit) {
        rec.result = {
          adapterId: HOST_BUNDLE_ADAPTER_ID,
          note: `bundle=${bundleDir} exit=0 stdout=${tail(stdout, 400)}`,
        };
      } else {
        rec.error = {
          code: 'HOST_BUNDLE_NONZERO_EXIT',
          message: tail(stderr || stdout || String(exitCode), 800),
        };
      }
      emitJobEvent(jobId, okExit ? 'reply.completed' : 'task.failed', {
        adapterId: HOST_BUNDLE_ADAPTER_ID,
        bundleDir,
        exitCode,
        signal,
        stdoutTail: tail(stdout, 2000),
        stderrTail: tail(stderr, 2000),
        ...(okExit ? {} : { code: rec.error?.code, message: rec.error?.message }),
      });
    }
  } else if (REGISTERED_COMPUTE_TYPES[type]) {
    rec.status = 'failed';
    rec.error = { code: 'COMPUTE_ADAPTER_NOT_READY', message: `type "${type}" has no runnable adapter` };
    emitJobEvent(jobId, 'task.failed', {
      code: rec.error.code,
      message: rec.error.message,
    });
  } else {
    rec.status = 'failed';
    rec.error = { code: 'COMPUTE_UNKNOWN_TYPE', message: `unknown type "${type}"` };
    emitJobEvent(jobId, 'task.failed', {
      code: rec.error.code,
      message: rec.error.message,
    });
  }

  rec.updatedAt = Date.now();
  jobs.set(jobId, rec);
  return { ok: true, job: rec };
}

export function getJob(jobId: string): JobRecordV1 | undefined {
  return jobs.get(jobId);
}

export function deleteJob(jobId: string): boolean {
  const had = jobs.delete(jobId);
  if (had) {
    emitJobEvent(jobId, 'task.cancelled', { reason: 'deleted_from_memory' });
  }
  return had;
}

export function listRecentJobs(max = 50): JobRecordV1[] {
  return [...jobs.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
}

export function listAdapterIds(): string[] {
  const s = new Set<string>();
  s.add(ADAPTER_STUB);
  s.add(SEAM_ADAPTER_ID);
  s.add(SAM_SEGMENT_ADAPTER_ID);
  s.add(HOST_BUNDLE_ADAPTER_ID);
  for (const v of Object.values(REGISTERED_COMPUTE_TYPES)) {
    s.add(v.adapterId);
  }
  return [...s].sort();
}

export function listJobEvents(jobId: string, afterSeq = 0, limit = 100): JobEventV1[] {
  const list = jobEvents.get(jobId) ?? [];
  const a = Number.isFinite(afterSeq) && afterSeq > 0 ? Math.floor(afterSeq) : 0;
  const l = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 100;
  return list.filter((e) => e.seq > a).slice(0, l);
}
