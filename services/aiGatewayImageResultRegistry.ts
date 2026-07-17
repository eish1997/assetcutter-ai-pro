const MAX_RESULT_BINDINGS = 50;

const imageResultJobIds = new Map<string, string>();
const IMAGE_URL_RE = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;

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

function isBindableImageResult(value: string): boolean {
  const src = String(value || '').trim();
  return /^data:image\//i.test(src) || (/^https?:\/\//i.test(src) && IMAGE_URL_RE.test(src));
}

export function rememberAiGatewayImageResult(imageDataUrl: string, jobId: unknown): void {
  const id = nonEmptyString(jobId);
  if (!id || !isBindableImageResult(imageDataUrl)) return;
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
  if (!isBindableImageResult(imageDataUrl)) return null;
  const key = aiGatewayImageResultKey(imageDataUrl);
  const id = imageResultJobIds.get(key) || null;
  if (id) imageResultJobIds.delete(key);
  return id;
}

export function clearAiGatewayImageResultRegistryForTest(): void {
  imageResultJobIds.clear();
}
