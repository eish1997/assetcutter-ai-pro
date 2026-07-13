const MAX_RESULT_BINDINGS = 50;

const imageResultJobIds = new Map<string, string>();

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function aiGatewayImageResultKey(imageDataUrl: string): string {
  const src = String(imageDataUrl || '');
  let hash = 2166136261;
  for (let i = 0; i < src.length; i += 1) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${src.length}:${(hash >>> 0).toString(16)}`;
}

export function rememberAiGatewayImageResult(imageDataUrl: string, jobId: unknown): void {
  const id = nonEmptyString(jobId);
  if (!id || !String(imageDataUrl || '').startsWith('data:image/')) return;
  const key = aiGatewayImageResultKey(imageDataUrl);
  imageResultJobIds.delete(key);
  imageResultJobIds.set(key, id);
  while (imageResultJobIds.size > MAX_RESULT_BINDINGS) {
    const oldest = imageResultJobIds.keys().next().value;
    if (!oldest) break;
    imageResultJobIds.delete(oldest);
  }
}

export function consumeAiGatewayJobIdForImage(imageDataUrl: string): string | null {
  if (!String(imageDataUrl || '').startsWith('data:image/')) return null;
  const key = aiGatewayImageResultKey(imageDataUrl);
  const id = imageResultJobIds.get(key) || null;
  if (id) imageResultJobIds.delete(key);
  return id;
}

export function clearAiGatewayImageResultRegistryForTest(): void {
  imageResultJobIds.clear();
}
