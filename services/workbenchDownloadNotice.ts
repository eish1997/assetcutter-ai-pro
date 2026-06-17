/**
 * 桌面壳 / 工作台下载完成提示：CustomEvent → 根层 `DownloadSavedFloatingNotice`。
 * 避免 `workbenchDownloadBridge` 内联 DOM 与托盘气泡叠在一起。
 */

export const AC_WORKBENCH_DOWNLOAD_NOTICE_EVENT = 'ac:workbench-download-notice' as const;

export type WorkbenchDownloadNoticeLevel = 'info' | 'warn';

export type WorkbenchDownloadNoticeDetail = {
  level: WorkbenchDownloadNoticeLevel;
  title: string;
  detail?: string;
};

const NOTICE_MIN_GAP_MS = 1200;
let lastNoticeKey = '';
let lastNoticeAt = 0;

function noticeDedupeKey(detail: WorkbenchDownloadNoticeDetail): string {
  const title = String(detail.title || '').trim();
  const body = String(detail.detail || '').trim();
  return `${detail.level}|${title}|${body}`;
}

export function clipWorkbenchDownloadDetail(text: string, maxLen = 180): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

/** 同内容短时间去重，避免 IPC 回调与页面侧重复派发叠两条。 */
export function dispatchWorkbenchDownloadNotice(detail: WorkbenchDownloadNoticeDetail): void {
  if (typeof window === 'undefined') return;
  const title = String(detail.title || '').trim();
  if (!title) return;
  const normalized: WorkbenchDownloadNoticeDetail = {
    level: detail.level === 'warn' ? 'warn' : 'info',
    title,
    detail: detail.detail ? clipWorkbenchDownloadDetail(detail.detail) : undefined,
  };
  const key = noticeDedupeKey(normalized);
  const now = Date.now();
  if (key === lastNoticeKey && now - lastNoticeAt < NOTICE_MIN_GAP_MS) return;
  lastNoticeKey = key;
  lastNoticeAt = now;
  try {
    window.dispatchEvent(
      new CustomEvent(AC_WORKBENCH_DOWNLOAD_NOTICE_EVENT, { detail: normalized }),
    );
  } catch {
    /* ignore */
  }
}
