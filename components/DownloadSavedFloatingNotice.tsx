import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AC_WORKBENCH_DOWNLOAD_NOTICE_EVENT,
  type WorkbenchDownloadNoticeDetail,
  type WorkbenchDownloadNoticeLevel,
} from '../services/workbenchDownloadNotice';
import {
  RIGHT_DOCK_PANEL_BOTTOM,
  RIGHT_DOCK_RIGHT,
} from './floatingDockConstants';
import AppIcon from './ui/AppIcon';

const AUTO_HIDE_MS = 6200;
const NOTICE_Z_INDEX = 10080;

function basenameFromPath(text: string): string {
  const t = String(text || '').trim();
  if (!t) return '';
  const parts = t.split(/[/\\]/);
  return parts[parts.length - 1] || t;
}

function formatDetail(detail?: string): { short: string; full: string } {
  const full = String(detail || '').trim();
  if (!full) return { short: '', full: '' };
  const base = basenameFromPath(full);
  return { short: base || full, full };
}

/**
 * 根层下载提示：桌面壳工作台保存 / 浏览器回退下载；右下角、避开运行日志 FAB。
 */
const DownloadSavedFloatingNotice: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<WorkbenchDownloadNoticeLevel>('info');
  const [title, setTitle] = useState('');
  const [detailShort, setDetailShort] = useState('');
  const [detailFull, setDetailFull] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }, []);

  const arm = useCallback((payload: WorkbenchDownloadNoticeDetail) => {
    const nextTitle = String(payload.title || '').trim();
    if (!nextTitle) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const formatted = formatDetail(payload.detail);
    setLevel(payload.level === 'warn' ? 'warn' : 'info');
    setTitle(nextTitle);
    setDetailShort(formatted.short);
    setDetailFull(formatted.full);
    setOpen(true);
    timerRef.current = setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, AUTO_HIDE_MS);
  }, []);

  useEffect(() => {
    const onNotice = (ev: Event) => {
      const ce = ev as CustomEvent<WorkbenchDownloadNoticeDetail>;
      const d = ce.detail;
      if (!d || typeof d.title !== 'string') return;
      arm(d);
    };
    window.addEventListener(AC_WORKBENCH_DOWNLOAD_NOTICE_EVENT, onNotice);
    return () => {
      window.removeEventListener(AC_WORKBENCH_DOWNLOAD_NOTICE_EVENT, onNotice);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [arm]);

  if (!open) return null;

  const shell =
    level === 'warn'
      ? 'border-amber-700/45 bg-[#141210]/95 ring-amber-500/20 text-amber-100/95'
      : 'border-emerald-700/40 bg-[#101412]/95 ring-emerald-500/15 text-emerald-50/95';

  const btnRing =
    level === 'warn'
      ? 'focus-visible:ring-amber-400/60 text-amber-200/80 hover:text-amber-50'
      : 'focus-visible:ring-emerald-400/55 text-emerald-200/80 hover:text-emerald-50';

  const accent = level === 'warn' ? 'text-amber-300/90' : 'text-emerald-300/90';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`pointer-events-auto fixed ${RIGHT_DOCK_PANEL_BOTTOM} ${RIGHT_DOCK_RIGHT} z-[${NOTICE_Z_INDEX}] max-w-[min(360px,calc(100vw-3rem))]`}
      style={{ zIndex: NOTICE_Z_INDEX }}
    >
      <div
        className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-xl backdrop-blur-md ring-1 ${shell}`}
      >
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/[0.08] ${accent}`}
          aria-hidden
        >
          <AppIcon name={level === 'warn' ? 'warning' : 'download'} className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold leading-snug tracking-wide">{title}</p>
          {detailShort ? (
            <p
              className="mt-0.5 truncate text-[10px] leading-relaxed text-white/45"
              title={detailFull !== detailShort ? detailFull : undefined}
            >
              {detailShort}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={`shrink-0 rounded-lg p-1 hover:bg-white/10 outline-none focus-visible:ring-2 ${btnRing}`}
          aria-label="关闭提示"
        >
          <AppIcon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default DownloadSavedFloatingNotice;
