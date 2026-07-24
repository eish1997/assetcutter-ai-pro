import { insertUsageEvents } from '../usage-billing-store.js';
import { priceUsageQuote } from '../pricing-engine.js';
import { actualCreditsFromAiGatewayPlan } from './settlement.js';
import { withAiGatewayPostgresRetry } from './postgres-transient-retry.js';
import {
  meterKindForAiGatewayModality,
  resolveAiGatewayBillingSku,
  unitForAiGatewayMeter,
} from './route-billing.js';

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

function usageMetadataFromJob(job) {
  const raw =
    job?.metadata?.usage?.usageMetadata ||
    job?.metadata?.usageMetadata ||
    job?.output?.usageMetadata ||
    job?.output?.usage?.usageMetadata ||
    null;
  if (!raw || typeof raw !== 'object') return null;
  const promptTokenCount = positiveInt(raw.promptTokenCount ?? raw.prompt_token_count ?? raw.prompt_tokens ?? raw.input_tokens);
  const candidatesTokenCount = positiveInt(
    raw.candidatesTokenCount ?? raw.candidates_token_count ?? raw.completion_tokens ?? raw.output_tokens
  );
  const totalTokenCount = positiveInt(raw.totalTokenCount ?? raw.total_token_count ?? raw.total_tokens) || promptTokenCount + candidatesTokenCount;
  if (!promptTokenCount && !candidatesTokenCount && !totalTokenCount) return null;
  return { promptTokenCount, candidatesTokenCount, totalTokenCount };
}

function quoteCreditsFromUsage({ billingSku, meterKind, usageMetadata, imageOutput }) {
  if (!usageMetadata) return { credits: 0, costUsdEst: null, source: null };
  const quote = priceUsageQuote({
    billingSku,
    meterKind,
    quantityIn: usageMetadata.promptTokenCount,
    quantityOut: usageMetadata.candidatesTokenCount,
    quantity: usageMetadata.totalTokenCount,
    usagePart: imageOutput ? 'output' : undefined,
    outputKind: imageOutput ? 'image' : undefined,
    imageOutputTokens: imageOutput,
  });
  return quote.creditsCharge > 0
    ? { credits: quote.creditsCharge, costUsdEst: quote.costUsdEst, source: 'usage_metadata' }
    : { credits: 0, costUsdEst: quote.costUsdEst, source: null };
}

function resolveActualOrEstimatedCredits(plan, usageContext) {
  const actual = actualCreditsFromAiGatewayPlan(plan);
  if (actual.credits > 0) return { credits: actual.credits, source: actual.source || 'job_usage' };
  const quoted = quoteCreditsFromUsage(usageContext);
  if (quoted.credits > 0) return quoted;
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

  const route = plan?.route && typeof plan.route === 'object' ? plan.route : {};
  const billingSku = resolveAiGatewayBillingSku(plan);
  const usageMetadata = usageMetadataFromJob(job);
  const meterKind = meterKindForAiGatewayModality(job.modality, usageMetadata);
  const proxyJobId = text(job.metadata?.proxyJobId);
  const upstreamTaskId = text(job.metadata?.upstreamTaskId) || text(job.metadata?.tripoTaskId) || text(job.metadata?.jimengTaskId) || correlationId;
  const model = text(job.model || job.input?.model);
  const imageOutput = job.modality === 'image';
  const resolved = resolveActualOrEstimatedCredits(plan, { billingSku, meterKind, usageMetadata, imageOutput });
  if (resolved.credits <= 0) return null;

  const event = {
    idempotencyKey: `aijob:usage:${job.id}`.slice(0, 200),
    provider: text(route.providerId) || text(job.provider) || 'ai-gateway',
    registryId: model || undefined,
    billingSku,
    meterKind,
    quantityIn: usageMetadata?.promptTokenCount,
    quantityOut: usageMetadata?.candidatesTokenCount,
    quantity: usageMetadata?.totalTokenCount ?? (meterKind === 'token' ? 0 : 1),
    unit: unitForAiGatewayMeter(meterKind),
    costUsdEst: resolved.costUsdEst ?? undefined,
    costConfidence: resolved.source === 'estimated' ? 'estimated' : 'exact',
    status: 'succeeded',
    upstreamTaskId,
    requestId: proxyJobId || upstreamTaskId || job.id,
    jobKind: job.capability || `${job.modality}.generate`,
    creditsCharged: resolved.credits,
    meta: {
      taskId: correlationId,
      upstreamTaskId,
      correlationId,
      aiGatewayJobId: job.id,
      proxyJobId: proxyJobId || undefined,
      modality: job.modality,
      capability: job.capability,
      model: model || undefined,
      usageMetadata: usageMetadata || undefined,
      usagePart: usageMetadata && imageOutput ? 'output' : undefined,
      outputKind: usageMetadata && imageOutput ? 'image' : undefined,
      settlementSource: resolved.source,
      externalCreditSettlement: true,
    },
  };
  return { userId, event, credits: resolved.credits, source: resolved.source };
}

export async function recordAiGatewayUsageEvent(plan) {
  const built = buildAiGatewayUsageEvent(plan);
  if (!built) return { recorded: false, reason: 'not_recordable' };
  const result = await withAiGatewayPostgresRetry('aiGatewayUsage.insertUsageEvents', () =>
    insertUsageEvents(built.userId, built.event)
  );
  return {
    recorded: result.inserted > 0 || result.skipped > 0,
    inserted: result.inserted,
    skipped: result.skipped,
    credits: built.credits,
    source: built.source,
    idempotencyKey: built.event.idempotencyKey,
  };
}
