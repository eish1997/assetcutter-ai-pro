export type UploadedFile = {
  url: string;
  storageKey?: string;
  width?: number;
  height?: number;
  bytes: number;
  mimeType: string;
  durationMs?: number;
};

export async function uploadMediaFile(_file?: unknown): Promise<UploadedFile> {
  throw new Error('front-hall-generation-disabled');
}
export function resolveMediaUrl(url?: string | null): string {
  return String(url || '');
}
export async function getMediaBlob(_key?: string): Promise<Blob | null> {
  return null;
}
export async function cleanupUnusedMedia(_keys?: string[]): Promise<void> {}
