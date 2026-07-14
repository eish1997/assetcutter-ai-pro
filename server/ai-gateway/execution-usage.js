function positiveInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function estimateCreditsFromPlan(plan) {
  const job = plan?.job || {};
  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  const gate = metadata.creditsGate && typeof metadata.creditsGate === 'object' ? metadata.creditsGate : {};
  return positiveInt(job.input?.estimatedCredits) || positiveInt(gate.estimatedCredits || gate.reserveAmount) || positiveInt(job.estimatedCredits);
}

export function collectByteSize(value, depth = 0) {
  if (depth > 5 || value == null) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + collectByteSize(item, depth + 1), 0);
  if (typeof value !== 'object') return 0;
  let total = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (/^(bytes|byteSize|size|fileSize|contentLength)$/i.test(key)) {
      total += positiveInt(raw);
    } else {
      total += collectByteSize(raw, depth + 1);
    }
  }
  return total;
}

export function buildProviderTaskUsage(plan, input = {}) {
  const estimatedCredits = estimateCreditsFromPlan(plan);
  const actualCredits = positiveInt(input.actualCredits) || estimatedCredits;
  const quantity = positiveInt(input.quantity) || 1;
  const startedAtMs = Number(input.startedAtMs || 0);
  const completedAtMs = Number(input.completedAtMs || Date.now());
  const durationMs = startedAtMs > 0 ? Math.max(0, Math.round(completedAtMs - startedAtMs)) : null;
  const outputBytes = positiveInt(input.outputBytes);
  return {
    provider: nonEmptyString(input.provider) || nonEmptyString(plan?.route?.providerId) || nonEmptyString(plan?.job?.provider) || 'ai-gateway',
    upstreamTaskId: nonEmptyString(input.upstreamTaskId) || nonEmptyString(plan?.job?.metadata?.upstreamTaskId) || null,
    billingSku: nonEmptyString(input.billingSku) || nonEmptyString(plan?.job?.metadata?.billingSku) || `${plan?.job?.modality || 'ai'}.gateway.task`,
    meterKind: nonEmptyString(input.meterKind) || (plan?.job?.modality === 'video' ? 'second' : 'task'),
    unit: nonEmptyString(input.unit) || (plan?.job?.modality === 'video' ? 'second' : 'task'),
    quantity,
    outputBytes,
    artifactCount: positiveInt(input.artifactCount),
    durationMs,
    actualCredits,
    creditsCharged: actualCredits,
    estimatedCredits,
    settlementSource: actualCredits > 0 ? 'provider_task_usage' : 'estimated',
  };
}
