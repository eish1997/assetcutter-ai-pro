import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AC_GEMINI_FAIRNESS_REJECTED_EVENT,
  type AcGeminiFairnessRejectedDetail,
} from '../services/geminiProxyFairnessError';
import {
  AC_UNIFIED_AI_SOFT_NOTICE_EVENT,
  type AcUnifiedAiSoftNoticeDetail,
} from '../services/unifiedAiSoftNotice';
import { navigateToSettingsSection } from '../services/navigateSettings';
import AppIcon from './ui/AppIcon';

const AUTO_HIDE_MS = 10_000;
const CREDITS_CONSUMED_HIDE_MS = 5_000;

type NoticeVariant = 'fairness' | 'soft_rate' | 'soft_busy' | 'credits_exceeded' | 'credits_consumed';

function variantFromSoftKind(kind: AcUnifiedAiSoftNoticeDetail['kind']): NoticeVariant {
  if (kind === 'credits_exceeded') return 'credits_exceeded';
  if (kind === 'credits_consumed') return 'credits_consumed';
  if (kind === 'rate_limit') return 'soft_rate';
  return 'soft_busy';
}

/**
 * 根层全局提示：① 代理公平拒绝 ② workflow* 限流/繁忙 ③ 积分不足 / 本次消耗
 */
const GeminiFairnessFloatingNotice: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<NoticeVariant>('fairness');
  const [text, setText] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }, []);

  const arm = useCallback((v: NoticeVariant, body: string) => {
    const t = body.trim();
    if (!t) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setVariant(v);
    setText(t);
    setOpen(true);
    const hideMs = v === 'credits_consumed' ? CREDITS_CONSUMED_HIDE_MS : AUTO_HIDE_MS;
    timerRef.current = setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, hideMs);
  }, []);

  useEffect(() => {
    const onFair = (ev: Event) => {
      const ce = ev as CustomEvent<AcGeminiFairnessRejectedDetail>;
      const d = ce.detail;
      if (!d || typeof d.message !== 'string') return;
      arm('fairness', d.message);
    };
    const onSoft = (ev: Event) => {
      const ce = ev as CustomEvent<AcUnifiedAiSoftNoticeDetail>;
      const d = ce.detail;
      if (!d || typeof d.message !== 'string') return;
      arm(variantFromSoftKind(d.kind), d.message);
    };
    window.addEventListener(AC_GEMINI_FAIRNESS_REJECTED_EVENT, onFair);
    window.addEventListener(AC_UNIFIED_AI_SOFT_NOTICE_EVENT, onSoft);
    return () => {
      window.removeEventListener(AC_GEMINI_FAIRNESS_REJECTED_EVENT, onFair);
      window.removeEventListener(AC_UNIFIED_AI_SOFT_NOTICE_EVENT, onSoft);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [arm]);

  if (!open) return null;

  const shell =
    variant === 'fairness'
      ? 'border-amber-700/45 bg-[#141210]/95 ring-amber-500/20 text-amber-100/95'
      : variant === 'credits_exceeded'
        ? 'border-rose-700/45 bg-[#181012]/95 ring-rose-500/25 text-rose-100/95'
        : variant === 'credits_consumed'
          ? 'border-emerald-700/40 bg-[#101814]/95 ring-emerald-500/20 text-emerald-100/95'
          : variant === 'soft_rate'
            ? 'border-sky-700/45 bg-[#101418]/95 ring-sky-500/20 text-sky-100/95'
            : 'border-slate-600/50 bg-[#111114]/95 ring-slate-500/15 text-slate-200/95';

  const btnRing =
    variant === 'fairness'
      ? 'focus-visible:ring-amber-400/60 text-amber-200/80 hover:text-amber-50'
      : variant === 'credits_exceeded'
        ? 'focus-visible:ring-rose-400/55 text-rose-200/80 hover:text-rose-50'
        : variant === 'credits_consumed'
          ? 'focus-visible:ring-emerald-400/50 text-emerald-200/80 hover:text-emerald-50'
          : variant === 'soft_rate'
            ? 'focus-visible:ring-sky-400/50 text-sky-200/80 hover:text-sky-50'
            : 'focus-visible:ring-slate-400/50 text-slate-300/80 hover:text-white';

  const ctaClass =
    variant === 'credits_exceeded'
      ? 'bg-rose-900/45 text-rose-50 hover:bg-rose-800/55'
      : 'bg-white/10 text-inherit hover:bg-white/15';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-auto fixed top-4 left-1/2 z-[2999] max-w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 px-2"
    >
      <div
        className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 shadow-xl backdrop-blur-sm ring-1 ${shell}`}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <p className="whitespace-pre-line text-[11px] leading-relaxed">{text}</p>
          {variant === 'credits_exceeded' ? (
            <button
              type="button"
              onClick={() => {
                navigateToSettingsSection('settings-usage');
                dismiss();
              }}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold ${ctaClass}`}
            >
              查看用量明细
            </button>
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

export default GeminiFairnessFloatingNotice;
