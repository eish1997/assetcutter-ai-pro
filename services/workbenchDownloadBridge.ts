import { ensureDownloadFilenameExtension } from './downloadFilename';
import { dispatchWorkbenchDownloadNotice } from './workbenchDownloadNotice';

type WorkbenchDownloadBridge = {
  saveBlob?: (payload: {
    filename: string;
    mimeType?: string;
    bytes: ArrayBuffer;
    title?: string;
  }) => Promise<{ ok: boolean; path?: string; filename?: string; error?: string; canceled?: boolean }>;
  onDownloadSaved?: (
    handler: (payload: { path?: string; filename?: string; title?: string }) => void
  ) => () => void;
};

declare global {
  interface Window {
    assetCutterWorkbench?: WorkbenchDownloadBridge;
  }
}

let downloadListenerRegistered = false;

function registerWorkbenchDownloadListener(): void {
  if (downloadListenerRegistered || typeof window === 'undefined') return;
  const bridge = window.assetCutterWorkbench;
  if (!bridge || typeof bridge.onDownloadSaved !== 'function') return;
  downloadListenerRegistered = true;
  bridge.onDownloadSaved((payload) => {
    showDownloadNotice('info', payload?.title || '下载已完成', payload?.path || payload?.filename);
  });
}

export function showDownloadNotice(level: 'info' | 'warn', title: string, detail?: string): void {
  dispatchWorkbenchDownloadNotice({ level, title, detail });
}

function sanitizeDownloadFilename(name: string): string {
  const base = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180);
  return base || 'download';
}

export function triggerBrowserBlobDownload(blob: Blob, filename: string): void {
  const safeName = sanitizeDownloadFilename(filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  a.setAttribute('download', safeName);
  document.body.appendChild(a);
  window.requestAnimationFrame(() => {
    try {
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch {
      try {
        a.click();
      } catch {
        /* ignore */
      }
    }
    window.setTimeout(() => {
      try {
        a.remove();
      } catch {
        /* ignore */
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 30_000);
  });
}

export type WorkbenchBlobDownloadResult =
  | { ok: true; mode: 'workbench'; filename: string; path?: string }
  | { ok: false; canceled?: boolean };

export async function tryWorkbenchBlobDownload(
  blob: Blob,
  filename: string,
  options?: { noticeTitle?: string }
): Promise<WorkbenchBlobDownloadResult | null> {
  registerWorkbenchDownloadListener();
  const bridge = typeof window !== 'undefined' ? window.assetCutterWorkbench : undefined;
  if (!bridge || typeof bridge.saveBlob !== 'function') return null;
  try {
    const resolvedFilename = await ensureDownloadFilenameExtension(filename, { blob });
    const bytes = await blob.arrayBuffer();
    const r = await bridge.saveBlob({
      filename: sanitizeDownloadFilename(resolvedFilename),
      mimeType: blob.type || 'application/octet-stream',
      bytes,
      title: options?.noticeTitle,
    });
    if (r?.canceled) return { ok: false, canceled: true };
    if (r?.ok) {
      return {
        ok: true as const,
        mode: 'workbench' as const,
        filename: r.filename || sanitizeDownloadFilename(resolvedFilename),
        path: r.path,
      };
    }
    console.warn('[workbenchDownloadBridge] save failed', r?.error || 'unknown error');
  } catch (e) {
    console.warn('[workbenchDownloadBridge] save failed', e);
  }
  return null;
}

/** 桌面壳优先保存并提示；失败时回退浏览器下载。返回是否已成功触发保存/下载。 */
export async function downloadBlobPreferWorkbench(
  blob: Blob,
  filename: string,
  options?: { noticeTitle?: string; fallbackBrowser?: boolean }
): Promise<boolean> {
  const hasWorkbenchBridge =
    typeof window !== 'undefined' && typeof window.assetCutterWorkbench?.saveBlob === 'function';
  const resolvedFilename = await ensureDownloadFilenameExtension(filename, { blob });
  const workbench = await tryWorkbenchBlobDownload(blob, resolvedFilename, {
    noticeTitle: options?.noticeTitle,
  });
  if (workbench?.ok) return true;
  if (workbench?.canceled) {
    showDownloadNotice('warn', '已取消下载', sanitizeDownloadFilename(resolvedFilename));
    return false;
  }
  if (options?.fallbackBrowser === false) return false;
  triggerBrowserBlobDownload(blob, resolvedFilename);
  if (!hasWorkbenchBridge) {
    showDownloadNotice('info', '下载已开始', sanitizeDownloadFilename(resolvedFilename));
  }
  return true;
}
