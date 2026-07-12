import { insertUsageEvents } from '../usage-billing-store.js';
import { actualCreditsFromAiGatewayPlan } from './settlement.js';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function creditsGate(plan) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  return metadata.creditsGate && typeof metadata.creditsGate === 'object' ? metadata.creditsGate : null;
}

function resolveBillingSku(job, route) {
  const explicit =
    text(job?.input?.billingSku) ||
    text(job?.metadata?.billingSku) ||
    text(job?.metadata?.usage?.billingSku) ||
    text(job?.metadata?.metering?.billingSku);
  if (explicit) return explicit;

  const model = String(job?.model || job?.input?.model || '').toLowerCase();
  if (job?.modality === 'image') {
    return model.includes('pro') && !model.includes('flash') ? 'image.gemini.pro' : 'image.gemini.flash';
  }
  if (job?.modality === 'video') return 'video.workflow.task';
  if (job?.modality === 'model3d') return '3d.tripo.task';
  if (route?.providerId === 'vertex-gemini' || model.includes('gemini')) {
    return model.includes('pro') && !model.includes('flash') ? 'llm.gemini.pro' : 'llm.gemini.flash';
  }
  return `${job?.modality || 'ai'}.gateway.task`.slice(0, 120);
}

function meterKindForModality(modality) {
  if (modality === 'text') return 'token';
  if (modality === 'image') return 'image';
  if (modality === 'video') return 'second';
  return 'task';
}

function unitForMeter(meterKind) {
  if (meterKind === 'token') return 'token';
  if (meterKind === 'image') return 'image';
  if (meterKind === 'second') return 'second';
  return 'task';
}

function resolveActualOrEstimatedCredits(plan) {
  const actual = actualCreditsFromAiGatewayPlan(plan);
  if (actual.credits > 0) return { credits: actual.credits, source: actual.source || 'job_usage' };
  const gate = creditsGate(plan);
  const estimated = positiveInt(gate?.estimatedCredits || gate?.reserveAmount || plan?.job?.estimatedCredits);
  if (estimated > 0) return { credits: estimated, source: 'estimated' };
  return { credits: 0, source: null };
}

export function buildAiGatewayUsageEvent(plan) {
  const job = plan?.job;
  if (!job || job.status !== 'succeeded') return null;
  const userId = text(job.userId);
  const correlationId = text(job.correlationId);
  if (!userId || !correlationId) return null;
  const gate = creditsGate(plan);
  if (gate?.mode !== 'reserve') return null;

  const resolved = resolveActualOrEstimatedCredits(plan);
  if (resolved.credits <= 0) return null;

  const route = plan?.route && typeof plan.route === 'object' ? plan.route : {};
  const billingSku = resolveBillingSku(job, route);
  const meterKind = meterKindForModality(job.modality);
  const proxyJobId = text(job.metadata?.proxyJobId);
  const model = text(job.model || job.input?.model);
  const event = {
    idempotencyKey: `aijob:usage:${job.id}`.slice(0, 200),
    provider: text(route.providerId) || text(job.provider) || 'ai-gateway',
    registryId: model || undefined,
    billingSku,
    meterKind,
    quantity: meterKind === 'token' ? 0 : 1,
    unit: unitForMeter(meterKind),
    costConfidence: resolved.source === 'estimated' ? 'estimated' : 'exact',
    status: 'succeeded',
    upstreamTaskId: correlationId,
    requestId: proxyJobId || job.id,
    jobKind: job.capability || `${job.modality}.generate`,
    creditsCharged: resolved.credits,
    meta: {
      taskId: correlationId,
      correlationId,
      aiGatewayJobId: job.id,
      proxyJobId: proxyJobId || undefined,
      modality: job.modality,
      capability: job.capability,
      model: model || undefined,
      settlementSource: resolved.source,
      externalCreditSettlement: true,
    },
  };
  return { userId, event, credits: resolved.credits, source: resolved.source };
}

export async function recordAiGatewayUsageEvent(plan) {
  const built = buildAiGatewayUsageEvent(plan);
  if (!built) return { recorded: false, reason: 'not_recordable' };
  const result = await insertUsageEvents(built.userId, built.event);
  return {
    recorded: result.inserted > 0 || result.skipped > 0,
    inserted: result.inserted,
    skipped: result.skipped,
    credits: built.credits,
    source: built.source,
    idempotencyKey: built.event.idempotencyKey,
  };
}
