import type { AiJobStatus, AiJobSummary } from './aiJobsClient';

const STATUS_LABELS: Record<AiJobStatus, string> = {
  created: '已创建',
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_TONES: Record<AiJobStatus, string> = {
  created: 'border-gray-600/70 bg-gray-700/20 text-gray-300',
  queued: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  running: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  succeeded: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  failed: 'border-red-500/40 bg-red-500/10 text-red-200',
  cancelled: 'border-zinc-500/60 bg-zinc-600/20 text-zinc-300',
};

export function aiJobStatusLabel(status: AiJobStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function aiJobStatusTone(status: AiJobStatus): string {
  return STATUS_TONES[status] ?? STATUS_TONES.created;
}

export function aiJobRouteLabel(job: AiJobSummary): string {
  const route = job.route;
  return route?.providerId || route?.adapterId || job.provider || route?.upstreamBackend || '未定';
}

export function aiJobCreditsLabel(job: AiJobSummary): string {
  const gate = job.creditsGate;
  if (!gate) return '未记录';
  const amount = Number.isFinite(gate.estimatedCredits) ? gate.estimatedCredits : null;
  const mode = gate.mode || (gate.enabled ? 'enabled' : 'disabled');
  return amount == null ? mode : `${amount} / ${mode}`;
}

export function aiJobModelLabel(job: AiJobSummary): string {
  const parts = [job.capability, job.model].filter(Boolean);
  return parts.length ? parts.join(' · ') : job.modality;
}

export function aiJobTraceLabel(job: AiJobSummary): string {
  return job.proxyJobId || job.correlationId || job.id;
}

export function canCancelAiJobStatus(status: AiJobStatus): boolean {
  return status === 'created' || status === 'queued' || status === 'running';
}

export function canRetryAiJobStatus(status: AiJobStatus): boolean {
  return status === 'failed' || status === 'cancelled';
}
