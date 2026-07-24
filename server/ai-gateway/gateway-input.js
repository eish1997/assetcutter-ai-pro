function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inlineImageToDataUrl(part) {
  const data = nonEmptyString(part?.inlineData?.data);
  if (!data) return '';
  const mime = nonEmptyString(part.inlineData.mimeType) || 'image/png';
  return `data:${mime};base64,${data}`;
}

function contentParts(input) {
  const contents = Array.isArray(input?.contents) ? input.contents : [];
  return contents.flatMap((turn) => (Array.isArray(turn?.parts) ? turn.parts : []));
}

export function promptFromGatewayInput(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const direct = nonEmptyString(raw.prompt) || nonEmptyString(raw.text);
  if (direct) return direct;
  return contentParts(raw)
    .map((part) => nonEmptyString(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function referenceImagesFromGatewayInput(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const refs = [];
  const push = (value) => {
    const url = nonEmptyString(value);
    if (url && !refs.includes(url)) refs.push(url);
  };
  if (Array.isArray(raw.referenceImages)) raw.referenceImages.forEach(push);
  if (Array.isArray(raw.images)) raw.images.forEach(push);
  push(raw.imageUrl);
  push(raw.imageBase64DataUrl);
  for (const part of contentParts(raw)) {
    push(part?.imageUrl);
    push(inlineImageToDataUrl(part));
  }
  return refs;
}

function normalizedVideoFields(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    durationSeconds: positiveNumber(raw.durationSeconds ?? raw.duration),
    aspectRatio: nonEmptyString(raw.aspectRatio || raw.ratio) || null,
    resolution: nonEmptyString(raw.resolution) || null,
    seed: raw.seed !== undefined && raw.seed !== null && raw.seed !== '' ? Number(raw.seed) : null,
  };
}

function normalizedModel3dFields(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    format: nonEmptyString(raw.format) || null,
    quality: nonEmptyString(raw.quality) || null,
    texture: typeof raw.texture === 'boolean' ? raw.texture : null,
    seed: raw.seed !== undefined && raw.seed !== null && raw.seed !== '' ? Number(raw.seed) : null,
  };
}

export function normalizeGatewayInput(jobOrInput, fallbackModality = '') {
  const rawJob = jobOrInput && typeof jobOrInput === 'object' ? jobOrInput : {};
  const input = rawJob.input && typeof rawJob.input === 'object' ? rawJob.input : rawJob;
  const modality = nonEmptyString(rawJob.modality || fallbackModality || input.modality).toLowerCase();
  const base = {
    modality,
    prompt: promptFromGatewayInput(input),
    referenceImages: referenceImagesFromGatewayInput(input),
    systemInstruction: nonEmptyString(input.systemInstruction) || null,
    responseMimeType: nonEmptyString(input.responseMimeType) || null,
  };
  if (modality === 'video') return { ...base, ...normalizedVideoFields(input) };
  if (modality === 'model3d') return { ...base, ...normalizedModel3dFields(input) };
  if (modality === 'image') {
    return {
      ...base,
      aspectRatio: nonEmptyString(input.aspectRatio || input.ratio) || null,
      size: nonEmptyString(input.size) || null,
      seed: input.seed !== undefined && input.seed !== null && input.seed !== '' ? Number(input.seed) : null,
    };
  }
  return base;
}
