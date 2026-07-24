function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function compactId(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function explicitAiGatewayBillingSku(job) {
  return (
    text(job?.input?.billingSku) ||
    text(job?.metadata?.billingSku) ||
    text(job?.metadata?.usage?.billingSku) ||
    text(job?.metadata?.metering?.billingSku)
  );
}

export function meterKindForAiGatewayModality(modality, usageMetadata = null) {
  if (usageMetadata) return 'token';
  if (modality === 'text') return 'token';
  if (modality === 'image') return 'image';
  if (modality === 'video') return 'second';
  return 'task';
}

export function unitForAiGatewayMeter(meterKind) {
  if (meterKind === 'token') return 'token';
  if (meterKind === 'image') return 'image';
  if (meterKind === 'second') return 'second';
  return 'task';
}

function geminiSku(modality, model) {
  if (modality === 'image') return model.includes('pro') && !model.includes('flash') ? 'image.gemini.pro' : 'image.gemini.flash';
  return model.includes('pro') && !model.includes('flash') ? 'llm.gemini.pro' : 'llm.gemini.flash';
}

function openAiOfficialSku(modality, model) {
  if (modality === 'image') {
    if (model.includes('gpt-image-2')) return 'image.openai.gpt2';
    if (model.includes('gpt-image-1.5') || model.includes('gpt-image-15')) return 'image.openai.gpt15';
  }
  if (modality === 'text') {
    if (model.includes('gpt-4o-mini')) return 'llm.openai.gpt4o-mini';
    if (model.includes('gpt-4o')) return 'llm.openai.gpt4o';
  }
  return '';
}

export function resolveAiGatewayBillingSku(planOrJob, maybeRoute = null) {
  const job = planOrJob?.job || planOrJob || {};
  const route = maybeRoute || planOrJob?.route || {};
  const explicit = explicitAiGatewayBillingSku(job);
  if (explicit) return explicit.slice(0, 120);

  const modality = text(job.modality) || 'ai';
  const providerId = text(route.providerId) || text(job.provider) || 'gateway';
  const model = text(job.model || job.input?.model).toLowerCase();

  if (modality === 'model3d') {
    if (providerId === 'tencent-hunyuan') return model.includes('rapid') ? '3d.tencent.rapid' : '3d.tencent.pro';
    if (providerId === 'tripo') return '3d.tripo.task';
  }
  if (modality === 'video') {
    if (providerId === 'volcengine-jimeng') return 'video.jimeng.ti2v-v30-pro';
    return 'video.workflow.task';
  }
  if (providerId === 'vertex-site' || providerId === 'vertex-gemini' || model.includes('gemini')) {
    return geminiSku(modality, model);
  }
  const official = providerId === 'openai-official' ? openAiOfficialSku(modality, model) : '';
  if (official) return official;

  const modelPart = compactId(model || job.input?.registryId || job.input?.canonicalModelId || 'task');
  const providerPart = compactId(providerId);
  return `${modality}.${providerPart}.${modelPart || 'task'}`.slice(0, 120);
}
