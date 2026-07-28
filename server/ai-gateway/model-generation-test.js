import { createAuthAiGatewayJob, publicAuthAiJobDetail } from './auth-api-handler.js';
import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { publicAiGatewayFailureReason, resolveAiGatewayFailureReason } from './failure-reason.js';

const SUPPORTED_MODALITIES = new Set(['text', 'image', 'video', 'model3d']);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

/** Admin Generation Test wait defaults. 3D/video upstream often exceeds 3 minutes (Tripo ~3–5min). */
const DEFAULT_GENERATION_TEST_TIMEOUT_MS = Object.freeze({
  text: 180_000,
  image: 300_000,
  video: 660_000,
  model3d: 660_000,
});

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveAdminGenerationTestTimeoutMs(modality, options = {}) {
  if (options.timeoutMs != null && Number.isFinite(Number(options.timeoutMs))) {
    return Math.max(1000, Number(options.timeoutMs));
  }
  const envRaw = process.env.AI_GATEWAY_ADMIN_GENERATION_TEST_TIMEOUT_MS;
  if (envRaw != null && String(envRaw).trim() !== '' && Number.isFinite(Number(envRaw))) {
    return Math.max(1000, Number(envRaw));
  }
  const key = nonEmptyString(modality).toLowerCase();
  return DEFAULT_GENERATION_TEST_TIMEOUT_MS[key] || DEFAULT_GENERATION_TEST_TIMEOUT_MS.text;
}

function normalizeGenerationTestInput(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const canonicalModelId = nonEmptyString(raw.canonicalModelId || raw.registryId || raw.model);
  const modality = nonEmptyString(raw.modality).toLowerCase();
  return {
    routeId: nonEmptyString(raw.routeId),
    canonicalModelId,
    registryId: nonEmptyString(raw.registryId) || canonicalModelId,
    modality,
    provider: nonEmptyString(raw.providerId || raw.provider),
    executionStatus: nonEmptyString(raw.executionStatus),
    requiresEndpointMapping: raw.requiresEndpointMapping === true,
  };
}

function failedResult(input, code, message, extra = {}) {
  const failureReason = publicAiGatewayFailureReason(
    resolveAiGatewayFailureReason(
      { code, message, ...(extra.jobError && typeof extra.jobError === 'object' ? extra.jobError : {}) },
      { defaultCode: code }
    )
  );
  return {
    ok: false,
    status: 'failed',
    checkKind: 'generation',
    mode: 'real_generation',
    testLayer: 'generation_test',
    createsGenerationTask: extra.createsGenerationTask === true || Boolean(extra.jobId),
    billingNote: 'Generation Test creates a real AI Gateway job and may reserve/charge credits.',
    canonicalModelId: input.canonicalModelId || null,
    providerId: input.provider || null,
    modality: input.modality || null,
    code,
    message,
    jobId: extra.jobId || null,
    aiGatewayJobId: extra.jobId || null,
    jobStatus: extra.jobStatus || null,
    route: extra.route || null,
    fallback: extra.fallback || null,
    artifacts: extra.artifacts || [],
    outputSummary: extra.outputSummary || null,
    nextAction: extra.nextAction || failureReason?.nextAction || null,
    failureReason,
    testedAt: new Date().toISOString(),
  };
}

function summarizeRoute(planOrDetail) {
  const route = planOrDetail?.route || planOrDetail?.job?.metadata?.modelRouteGuard || null;
  if (!route || typeof route !== 'object') return null;
  return {
    ruleId: route.ruleId || null,
    providerId: route.providerId || null,
    workerId: route.workerId || null,
    adapterId: route.adapterId || null,
    gatewayExecutionStatus: route.gatewayExecutionStatus || null,
    executionStatus: route.executionStatus || null,
    platformKeyRequired: route.platformKeyRequired ?? null,
  };
}

function summarizeArtifacts(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .map((artifact) => ({
      kind: nonEmptyString(artifact?.kind) || null,
      hasUrl: Boolean(nonEmptyString(artifact?.url || artifact?.publicUrl || artifact?.downloadUrl || artifact?.src)),
      source: nonEmptyString(artifact?.source) || null,
    }))
    .slice(0, 10);
}

function hasImageOutput(plan) {
  const artifacts = Array.isArray(plan?.job?.artifacts) ? plan.job.artifacts : [];
  if (artifacts.some((artifact) => artifact?.kind === 'image' && nonEmptyString(artifact?.url || artifact?.publicUrl || artifact?.downloadUrl || artifact?.src))) {
    return true;
  }
  const output = plan?.job?.output;
  if (!output || typeof output !== 'object') return false;
  const outputArtifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
  return outputArtifacts.some((artifact) => artifact?.kind === 'image' && nonEmptyString(artifact?.url || artifact?.publicUrl || artifact?.downloadUrl || artifact?.src));
}

function hasArtifactOutput(plan, kind) {
  const artifacts = Array.isArray(plan?.job?.artifacts) ? plan.job.artifacts : [];
  if (artifacts.some((artifact) => artifact?.kind === kind && nonEmptyString(artifact?.url || artifact?.publicUrl || artifact?.downloadUrl || artifact?.src))) {
    return true;
  }
  const output = plan?.job?.output;
  if (!output || typeof output !== 'object') return false;
  const outputArtifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
  return outputArtifacts.some((artifact) => artifact?.kind === kind && nonEmptyString(artifact?.url || artifact?.publicUrl || artifact?.downloadUrl || artifact?.src));
}

function extractTextOutput(output) {
  if (typeof output === 'string') return output.trim();
  if (!output || typeof output !== 'object') return '';
  return (
    nonEmptyString(output.text) ||
    nonEmptyString(output.resultText) ||
    nonEmptyString(output.content) ||
    nonEmptyString(output.message) ||
    nonEmptyString(output.raw?.choices?.[0]?.message?.content)
  );
}

function validateOutput(plan, modality) {
  if (modality === 'text') {
    const text = extractTextOutput(plan?.job?.output);
    if (text) return { ok: true, summary: { kind: 'text', textPreview: text.slice(0, 120) } };
    return { ok: false, code: 'AI_GATEWAY_GENERATION_TEXT_EMPTY', message: 'Generation task succeeded but no text output was found' };
  }
  if (modality === 'image') {
    if (hasImageOutput(plan)) return { ok: true, summary: { kind: 'image' } };
    return { ok: false, code: 'AI_GATEWAY_GENERATION_IMAGE_EMPTY', message: 'Generation task succeeded but no image artifact was found' };
  }
  if (modality === 'video') {
    if (hasArtifactOutput(plan, 'video')) return { ok: true, summary: { kind: 'video' } };
    return { ok: false, code: 'AI_GATEWAY_GENERATION_VIDEO_EMPTY', message: 'Generation task succeeded but no video artifact was found' };
  }
  if (modality === 'model3d') {
    if (hasArtifactOutput(plan, 'model3d')) return { ok: true, summary: { kind: 'model3d' } };
    return { ok: false, code: 'AI_GATEWAY_GENERATION_MODEL3D_EMPTY', message: 'Generation task succeeded but no 3D artifact was found' };
  }
  return { ok: false, code: 'AI_GATEWAY_GENERATION_MODALITY_UNSUPPORTED', message: `Generation Test supports text, image, video, and 3D only, got ${modality || 'empty'}` };
}

function buildJobBody(input) {
  const prompt = input.modality === 'text'
    ? 'Reply with exactly: ok'
    : input.modality === 'image'
      ? 'A simple red square icon centered on a plain white background.'
      : input.modality === 'video'
        ? 'A two second product turntable video of a simple red cube on a plain white background.'
        : 'A simple low-poly red cube 3D model with plain material.';
  const estimatedCredits = input.modality === 'image' ? 50 : input.modality === 'video' ? 100 : input.modality === 'model3d' ? 100 : 1;
  const capability = input.modality === 'image'
    ? 'image.generate'
    : input.modality === 'video'
      ? 'video.generate'
      : input.modality === 'model3d'
        ? 'model3d.generate'
        : 'text.generate';
  return {
    modality: input.modality,
    ...(input.routeId ? { routeId: input.routeId } : {}),
    capability,
    ...(input.provider ? { provider: input.provider } : {}),
    model: input.canonicalModelId,
    canonicalModelId: input.canonicalModelId,
    registryId: input.registryId,
    estimatedCredits,
    input: {
      prompt,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      canonicalModelId: input.canonicalModelId,
      registryId: input.registryId,
      estimatedCredits,
      ...(input.modality === 'video' ? { durationSeconds: 2, aspectRatio: '1:1', resolution: '720p' } : {}),
      ...(input.modality === 'model3d' ? { format: 'glb', quality: 'standard', texture: true } : {}),
      config: input.modality === 'image' ? { imageConfig: { size: '1024x1024', aspectRatio: '1:1' } } : {},
    },
    metadata: {
      adminGenerationTest: true,
      uiSource: 'admin.model_generation_test',
    },
  };
}

async function waitForTerminalJob(jobId, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const timeoutMs = resolveAdminGenerationTestTimeoutMs(options.modality, options);
  const intervalMs = Math.max(250, Number(options.intervalMs || process.env.AI_GATEWAY_ADMIN_GENERATION_TEST_INTERVAL_MS || 1500));
  const startedAt = Date.now();
  let plan = await store.get(jobId);
  while (plan && !TERMINAL_STATUSES.has(plan.job?.status)) {
    if (Date.now() - startedAt >= timeoutMs) return { timedOut: true, plan };
    await sleep(intervalMs);
    plan = await store.get(jobId);
  }
  return { timedOut: false, plan };
}

export async function testAiGatewayModelGeneration(req, input = {}, user = {}, options = {}) {
  const normalized = normalizeGenerationTestInput(input);
  if (!normalized.canonicalModelId) {
    return failedResult(normalized, 'AI_GATEWAY_MODEL_ID_REQUIRED', 'Missing canonical model id');
  }
  if (!SUPPORTED_MODALITIES.has(normalized.modality)) {
    return failedResult(
      normalized,
      'AI_GATEWAY_GENERATION_TEST_MODALITY_UNSUPPORTED',
      'Generation Test supports text, image, video, and 3D only',
      { nextAction: 'Use Route Check until this modality has a real generation probe.' }
    );
  }
  if (normalized.requiresEndpointMapping && normalized.executionStatus === 'requires_endpoint_mapping') {
    return failedResult(
      normalized,
      'AI_GATEWAY_MODEL_PARAMETER_PENDING',
      'Model route still needs parameter or endpoint mapping before it can run a real Generation Test'
    );
  }

  const createJob = options.createJob || createAuthAiGatewayJob;
  const createResult = await createJob(req, buildJobBody(normalized), user, {
    ...(options.createJobOptions || {}),
    store: options.store || persistentAiGatewayJobStore,
  });
  const createdJob = createResult?.body?.job || null;
  const jobId = nonEmptyString(createdJob?.id);
  if (!jobId || createResult.status < 200 || createResult.status >= 300) {
    return failedResult(
      normalized,
      createResult?.body?.error || 'AI_GATEWAY_GENERATION_JOB_CREATE_FAILED',
      createResult?.body?.message || 'Generation Test could not create an AI job',
      { jobStatus: createdJob?.status || null, route: summarizeRoute(createResult?.body) }
    );
  }

  const initialPlan = options.store ? await options.store.get(jobId) : null;
  const initialStatus = initialPlan?.job?.status || createdJob.status;
  const terminal =
    initialPlan && TERMINAL_STATUSES.has(initialStatus)
      ? { timedOut: false, plan: initialPlan }
      : await waitForTerminalJob(jobId, { ...options, modality: normalized.modality });
  const plan = terminal.plan;
  if (!plan) {
    return failedResult(normalized, 'AI_GATEWAY_GENERATION_JOB_NOT_FOUND', 'Generation Test created a job but could not read it back', {
      jobId,
      jobStatus: initialStatus || null,
      createsGenerationTask: true,
    });
  }
  const detail = publicAuthAiJobDetail(plan);
  const route = summarizeRoute(detail);
  const artifacts = summarizeArtifacts(detail.job.artifacts);
  if (terminal.timedOut) {
    return failedResult(normalized, 'AI_GATEWAY_GENERATION_TEST_TIMEOUT', 'Generation Test timed out before the job reached a final state', {
      jobId,
      jobStatus: detail.job.status,
      route,
      fallback: detail.job.fallback || null,
      artifacts,
      nextAction: 'Open the AI jobs panel with this job id and inspect the running worker/upstream status.',
    });
  }
  if (detail.job.status !== 'succeeded') {
    return failedResult(
      normalized,
      detail.job.metadata?.gatewayFailure?.code || detail.job.error?.code || 'AI_GATEWAY_GENERATION_JOB_FAILED',
      detail.job.metadata?.gatewayFailure?.adminMessage ||
        detail.job.error?.message ||
        `Generation task ended as ${detail.job.status}`,
      {
        jobId,
        jobStatus: detail.job.status,
        route,
        fallback: detail.job.fallback || null,
        artifacts,
        jobError: detail.job.metadata?.gatewayFailure || detail.job.error || null,
        nextAction:
          detail.job.metadata?.gatewayFailure?.nextAction ||
          'Check the job detail error, provider key health, and upstream quota/rate limit.',
      }
    );
  }
  const validation = validateOutput(plan, normalized.modality);
  if (!validation.ok) {
    return failedResult(normalized, validation.code, validation.message, {
      jobId,
      jobStatus: detail.job.status,
      route,
      fallback: detail.job.fallback || null,
      artifacts,
      outputSummary: validation.summary || null,
      nextAction: 'The upstream task succeeded; inspect adapter output extraction and workspace restore handling.',
    });
  }
  const proxyJobId =
    nonEmptyString(detail.job.proxyJobId) || nonEmptyString(detail.job.metadata?.proxyJobId) || null;
  return {
    ok: true,
    status: 'passed',
    checkKind: 'generation',
    mode: 'real_generation',
    testLayer: 'generation_test',
    createsGenerationTask: true,
    billingNote: 'Generation Test created a real AI Gateway job and may have reserved/charged credits.',
    canonicalModelId: normalized.canonicalModelId,
    providerId: detail.job.provider || route?.providerId || normalized.provider || null,
    modality: normalized.modality,
    code: 'AI_GATEWAY_GENERATION_READY',
    message: 'Generation Test passed: a real job completed with expected output. This is not the same as Route Check.',
    jobId,
    aiGatewayJobId: jobId,
    proxyJobId,
    jobStatus: detail.job.status,
    route,
    fallback: detail.job.fallback || null,
    artifacts,
    outputSummary: validation.summary,
    nextAction: null,
    testedAt: new Date().toISOString(),
  };
}
