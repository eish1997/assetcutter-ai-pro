function extensionFromMime(mime: string): string {
  const ct = String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (!ct) return 'bin';
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/pjpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/x-ms-bmp': 'bmp',
    'image/svg+xml': 'svg',
    'text/plain': 'txt',
    'text/plain;charset=utf-8': 'txt',
    'model/gltf-binary': 'glb',
    'model/gltf+json': 'gltf',
    'model/stl': 'stl',
    'model/obj': 'obj',
    'application/octet-stream': 'bin',
  };
  if (map[ct]) return map[ct];
  if (ct.startsWith('image/')) {
    const sub = ct.slice(6).split('+')[0].trim();
    if (sub === 'jpeg') return 'jpg';
    if (sub && /^[a-z0-9]{2,8}$/i.test(sub)) return sub;
  }
  if (ct.includes('gltf-binary')) return 'glb';
  if (ct.includes('gltf+json')) return 'gltf';
  if (ct.includes('fbx')) return 'fbx';
  return 'bin';
}

export function sniffImageMimeFromHead(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return '';
}

function sanitizeDownloadFilenameBase(name: string): string {
  const base = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180);
  return base || 'download';
}

export function hasDownloadFilenameExtension(name: string): boolean {
  return /\.[a-z0-9]{2,8}$/i.test(String(name || '').trim());
}

/** 文件名无扩展名时，按 MIME / 文件头补全。 */
export async function ensureDownloadFilenameExtension(
  filename: string,
  opts?: { mime?: string; blob?: Blob; headBytes?: Uint8Array }
): Promise<string> {
  const safe = sanitizeDownloadFilenameBase(filename);
  if (hasDownloadFilenameExtension(safe)) return safe;

  let mime = String(opts?.mime || opts?.blob?.type || '').trim();
  if ((!mime || mime === 'application/octet-stream') && opts?.headBytes?.length) {
    mime = sniffImageMimeFromHead(opts.headBytes) || mime;
  }
  if ((!mime || mime === 'application/octet-stream') && opts?.blob) {
    const head = new Uint8Array(await opts.blob.slice(0, 16).arrayBuffer());
    mime = sniffImageMimeFromHead(head) || mime;
  }

  const ext = extensionFromMime(mime);
  return `${safe}.${ext}`;
}

export function ensureDownloadFilenameExtensionSync(
  filename: string,
  opts?: { mime?: string; headBytes?: Uint8Array }
): string {
  const safe = sanitizeDownloadFilenameBase(filename);
  if (hasDownloadFilenameExtension(safe)) return safe;
  let mime = String(opts?.mime || '').trim();
  if ((!mime || mime === 'application/octet-stream') && opts?.headBytes?.length) {
    mime = sniffImageMimeFromHead(opts.headBytes) || mime;
  }
  return `${safe}.${extensionFromMime(mime)}`;
}
