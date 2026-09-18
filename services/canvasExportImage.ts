/**
 * 把跨域预览图解码成可 `canvas.toDataURL` 的 Image。
 * 生产静态站会把 `/api/r2/...` 映射到外置 API 源，直接 `new Image()` 再导出必脏画布。
 */

export function needsAnonymousCrossOrigin(src: string, pageOrigin?: string): boolean {
  const t = String(src || '').trim();
  if (!/^https?:\/\//i.test(t)) return false;
  const origin = pageOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  if (!origin) return true;
  try {
    return new URL(t).origin !== origin;
  } catch {
    return true;
  }
}

/** fetch 候选：原 URL，以及站内 `/api/r2` 的当前页同源兜底 */
export function candidateFetchUrlsForCanvasExport(src: string, pageOrigin?: string): string[] {
  const t = String(src || '').trim();
  const origin = pageOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const out: string[] = [];
  const push = (s: string) => {
    const x = String(s || '').trim();
    if (x && !out.includes(x)) out.push(x);
  };
  push(t);
  if (!t || t.startsWith('data:') || t.startsWith('blob:')) return out;
  try {
    const u = new URL(t, origin ? `${origin}/` : 'http://canvas-export.invalid/');
    if (/\/api\/r2\//i.test(u.pathname) && origin) {
      push(`${origin}${u.pathname}${u.search}${u.hash}`);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function decodeHtmlImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) {
      try {
        img.crossOrigin = 'anonymous';
      } catch {
        /* ignore */
      }
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('预览图加载失败'));
    img.src = src;
  });
}

async function tryObjectUrlFromFetch(src: string): Promise<string | undefined> {
  if (typeof fetch === 'undefined') return undefined;
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return undefined;
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const urls = candidateFetchUrlsForCanvasExport(src, origin);
  for (const url of urls) {
    for (const credentials of ['omit', 'include'] as const) {
      try {
        const res = await fetch(url, { mode: 'cors', credentials });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size <= 0) continue;
        const type = (blob.type || '').toLowerCase();
        if (type && !type.startsWith('image/') && type !== 'application/octet-stream') continue;
        return URL.createObjectURL(blob);
      } catch {
        /* next candidate */
      }
    }
  }
  return undefined;
}

export async function loadImageForCanvasExport(src: string): Promise<{
  image: HTMLImageElement;
  revoke: () => void;
}> {
  const t = String(src || '').trim();
  if (!t) throw new Error('预览图加载失败');

  const objectUrl = await tryObjectUrlFromFetch(t);
  if (objectUrl) {
    try {
      const image = await decodeHtmlImage(objectUrl, false);
      return {
        image,
        revoke: () => {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch {
            /* ignore */
          }
        },
      };
    } catch {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    }
  }

  const image = await decodeHtmlImage(t, needsAnonymousCrossOrigin(t));
  return { image, revoke: () => undefined };
}
