export type UploadedImage = {
  url: string;
  storageKey?: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

const previewListeners = new Set<() => void>();

export function previewUrlFor(key?: string | null): string {
  return String(key || '');
}
export function subscribeImagePreviews(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}
export function getImagePreviewRevision(): number {
  return 0;
}
export async function ensureImagePreview(_key?: string): Promise<string> {
  return '';
}
export async function uploadImage(_file?: unknown): Promise<UploadedImage> {
  throw new Error('front-hall-generation-disabled');
}
export async function imageToDataUrl(url?: string): Promise<string> {
  return String(url || '');
}
export async function getImageBlob(_key?: string): Promise<Blob | null> {
  return null;
}
export async function cleanupUnusedImages(_keys?: string[]): Promise<void> {}
export function resolveImageUrl(url?: string | null): string {
  return String(url || '');
}
