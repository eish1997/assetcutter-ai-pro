import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { QuickComposeMentionCandidate, QuickComposeSegment } from '../../services/quickComposeMention';
import {
  createQuickComposeMention,
  draftFromSegments,
  ensureQuickComposeEditableBoundaries,
  insertMentionInSegments,
  mentionsFromSegments,
  newQuickComposeTextSegment,
  relocateMentionSegment,
  removeMentionFromSegments,
  updateTextSegmentValue,
} from '../../services/quickComposeMention';
import { resolveDropAnchorAtPoint, type DropCaretPreview } from './quickComposeDropAnchor';

export type QuickComposeMentionFieldHandle = {
  insertMentionCandidate: (candidate: QuickComposeMentionCandidate) => void;
  stashCaretBeforeBlur: () => void;
};

export type QuickComposeMentionFieldProps = {
  segments: QuickComposeSegment[];
  onSegmentsChange: (next: QuickComposeSegment[]) => void;
  mentionCandidates: QuickComposeMentionCandidate[];
  maxMentions: number;
  placeholder: string;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  ariaLabel: string;
  onSubmit?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
};

const INLINE_THUMB = 28;

type ActiveCaret = { segmentId: string; offset: number };

function MentionThumb({
  src,
  alt,
  size = INLINE_THUMB,
  className = '',
}: {
  src?: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  const box = `inline-block shrink-0 overflow-hidden rounded-md align-middle ring-1 ring-white/[0.12] ${className}`;
  if (src && (src.startsWith('data:image/') || src.startsWith('blob:') || /^https?:\/\//i.test(src))) {
    return (
      <img
        src={src}
        alt={alt}
        className={`${box} object-cover`}
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  return (
    <span
      className={`${box} inline-grid place-items-center bg-white/[0.06] text-[8px] font-bold text-gray-500`}
      style={{ width: size, height: size }}
      title={alt}
    >
      @
    </span>
  );
}

/** 不渲染段首空 text（避免 @ 图左侧大块留白）；保留段尾空 text 供继续输入 */
function shouldRenderTextSegment(segments: QuickComposeSegment[], index: number): boolean {
  const seg = segments[index];
  if (!seg || seg.type !== 'text') return false;
  if (seg.value.length > 0) return true;
  if (index === segments.length - 1) return true;
  const prev = segments[index - 1];
  const next = segments[index + 1];
  if (prev?.type === 'mention' && next?.type === 'mention') return true;
  return false;
}

function pickDefaultActive(segments: QuickComposeSegment[]): ActiveCaret | null {
  const lastText = [...segments].reverse().find((s) => s.type === 'text');
  if (lastText?.type === 'text') return { segmentId: lastText.id, offset: lastText.value.length };
  return null;
}

function AutoWidthTextInput({
  segmentId,
  value,
  multiline,
  rows,
  disabled,
  ariaLabel,
  fillRemaining = false,
  inputRefs,
  onChange,
  onKeyDown,
  onFocus,
  onCaretSync,
}: {
  segmentId: string;
  value: string;
  multiline: boolean;
  rows: number;
  disabled: boolean;
  ariaLabel: string;
  /** 末段文本占满行内剩余宽度，便于点击空白区聚焦 */
  fillRemaining?: boolean;
  inputRefs: React.MutableRefObject<Map<string, HTMLInputElement | HTMLTextAreaElement>>;
  onChange: (value: string, el: HTMLInputElement | HTMLTextAreaElement) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus: (el: HTMLInputElement | HTMLTextAreaElement) => void;
  onCaretSync: (el: HTMLInputElement | HTMLTextAreaElement) => void;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const isEmpty = value.length === 0;

  useLayoutEffect(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    if (fillRemaining) {
      input.style.width = '';
      input.style.minWidth = '';
      return;
    }
    if (isEmpty) {
      input.style.width = '1px';
      input.style.minWidth = '1px';
      return;
    }
    const w = Math.ceil(mirror.getBoundingClientRect().width) + 2;
    input.style.width = `${w}px`;
    input.style.minWidth = '0';
  }, [fillRemaining, value, isEmpty, segmentId]);

  const scheduleCaretSync = (el: HTMLInputElement | HTMLTextAreaElement) => {
    onCaretSync(el);
    requestAnimationFrame(() => onCaretSync(el));
  };

  const registerRef = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    inputRef.current = el;
    if (el) inputRefs.current.set(segmentId, el);
    else inputRefs.current.delete(segmentId);
  };

  const textCls =
    'm-0 inline-block max-w-full border-0 bg-transparent p-0 align-middle text-[13px] leading-7 text-gray-100 outline-none disabled:opacity-45';
  const inputCls = fillRemaining ? `${textCls} w-full min-w-[4rem]` : textCls;
  const wrapperCls = fillRemaining
    ? 'relative inline-flex min-w-[4rem] flex-1 max-w-full align-middle'
    : 'relative inline-block w-fit max-w-full align-middle';

  const mirror = (
    <span
      ref={mirrorRef}
      className="pointer-events-none invisible absolute left-0 top-0 -z-10 whitespace-pre text-[13px] leading-7"
      aria-hidden
    >
      {value || '\u00a0'}
    </span>
  );

  const inputEventHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      scheduleCaretSync(e.currentTarget);
    },
    onMouseDown: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      scheduleCaretSync(e.currentTarget);
    },
    onClick: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      scheduleCaretSync(e.currentTarget);
    },
    onSelect: (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      scheduleCaretSync(e.currentTarget);
    },
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      scheduleCaretSync(e.currentTarget);
    },
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onFocus(e.currentTarget);
    },
  };

  if (multiline) {
    const lineRows = Math.min(rows, Math.max(1, value.split('\n').length));
    return (
      <span className={wrapperCls}>
        {fillRemaining ? null : mirror}
        <textarea
          ref={registerRef as React.Ref<HTMLTextAreaElement>}
          value={value}
          disabled={disabled}
          rows={lineRows}
          onChange={(e) => onChange(e.target.value, e.target)}
          onKeyDown={onKeyDown}
          className={`${inputCls} resize-none overflow-visible`}
          style={fillRemaining ? undefined : { width: isEmpty ? 1 : undefined }}
          aria-label={ariaLabel}
          {...inputEventHandlers}
        />
      </span>
    );
  }

  return (
    <span className={wrapperCls}>
      {fillRemaining ? null : mirror}
      <input
        ref={registerRef as React.Ref<HTMLInputElement>}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value, e.target)}
        onKeyDown={onKeyDown}
        className={inputCls}
        style={fillRemaining ? undefined : { width: isEmpty ? 1 : undefined }}
        aria-label={ariaLabel}
        {...inputEventHandlers}
      />
    </span>
  );
}

const QuickComposeMentionField = forwardRef<QuickComposeMentionFieldHandle, QuickComposeMentionFieldProps>(
  function QuickComposeMentionField(
    {
      segments,
      onSegmentsChange,
      mentionCandidates,
      maxMentions,
      placeholder,
      disabled = false,
      multiline = false,
      rows = 5,
      ariaLabel,
      onSubmit,
      onDragOver,
      onDrop,
    },
    ref
  ) {
  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const activeCaretRef = useRef<ActiveCaret | null>(null);
  const focusAfterIdRef = useRef<{ id: string; offset: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerIndex, setPickerIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<{ left: number; top: number; width: number } | null>(
    null
  );
  const [mentionPointerDragId, setMentionPointerDragId] = useState<string | null>(null);
  const [dropCaret, setDropCaret] = useState<DropCaretPreview | null>(null);
  const mentionDragListenersRef = useRef<(() => void) | null>(null);

  const mentions = useMemo(() => mentionsFromSegments(segments), [segments]);
  const lastTextSegmentId = useMemo(() => {
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const s = segments[i];
      if (s?.type === 'text') return s.id;
    }
    return null;
  }, [segments]);
  const showPlaceholder = !draftFromSegments(segments) && mentions.length === 0;

  const filtered = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return mentionCandidates.filter((c) => {
      if (c.disabled) return false;
      if (!q) return true;
      return c.label.toLowerCase().includes(q);
    });
  }, [mentionCandidates, pickerQuery]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerQuery('');
    setPickerIndex(0);
    setPickerAnchor(null);
  }, []);

  const syncActiveFromEl = useCallback((segmentId: string, el: HTMLInputElement | HTMLTextAreaElement) => {
    activeCaretRef.current = { segmentId, offset: el.selectionStart ?? 0 };
  }, []);

  /** 插入 @ 时以当前焦点输入框的光标为准，避免沿用上一次位置 */
  const resolveActiveCaret = useCallback((): ActiveCaret | null => {
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
      for (const [segmentId, el] of inputRefs.current.entries()) {
        if (el === focused) {
          return { segmentId, offset: focused.selectionStart ?? 0 };
        }
      }
    }
    return activeCaretRef.current;
  }, []);

  const stashCaretBeforeBlur = useCallback(() => {
    const caret = resolveActiveCaret();
    if (caret) activeCaretRef.current = caret;
  }, [resolveActiveCaret]);

  const focusTextSegment = useCallback((segmentId: string, offset: number) => {
    focusAfterIdRef.current = { id: segmentId, offset };
    activeCaretRef.current = { segmentId, offset };
  }, []);

  const positionPicker = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setPickerAnchor({ left: rect.left, top: rect.bottom + 4, width: Math.min(300, Math.max(200, rect.width)) });
  }, []);

  const updatePickerFromText = useCallback(
    (segmentId: string, text: string, offset: number, el: HTMLElement) => {
      const before = text.slice(0, offset);
      const at = before.lastIndexOf('@');
      if (at < 0) {
        closePicker();
        return;
      }
      const tail = before.slice(at + 1);
      if (/\s/.test(tail)) {
        closePicker();
        return;
      }
      setPickerQuery(tail);
      setPickerOpen(true);
      setPickerIndex(0);
      positionPicker(el);
    },
    [closePicker, positionPicker]
  );

  const commitSegments = useCallback(
    (next: QuickComposeSegment[]) => {
      onSegmentsChange(ensureQuickComposeEditableBoundaries(next));
    },
    [onSegmentsChange]
  );

  const insertMention = useCallback(
    (candidate: QuickComposeMentionCandidate) => {
      if (mentions.length >= maxMentions) return;
      const m = createQuickComposeMention(candidate, mentions);
      if (!m) return;

      const active = resolveActiveCaret() ?? pickDefaultActive(segmentsRef.current);
      if (!active) {
        const empty = newQuickComposeTextSegment('');
        const next = insertMentionInSegments([empty], empty.id, 0, m, { stripAtQuery: true });
        const mIdx = next.findIndex((s) => s.type === 'mention' && s.mention.id === m.id);
        const after = mIdx >= 0 ? next[mIdx + 1] : null;
        if (after?.type === 'text') focusTextSegment(after.id, 0);
        commitSegments(next);
        closePicker();
        return;
      }

      const next = insertMentionInSegments(segmentsRef.current, active.segmentId, active.offset, m, {
        stripAtQuery: true,
      });
      const mIdx = next.findIndex((s) => s.type === 'mention' && s.mention.id === m.id);
      const afterText = mIdx >= 0 ? next[mIdx + 1] : null;
      if (afterText?.type === 'text') focusTextSegment(afterText.id, 0);
      commitSegments(next);
      closePicker();
    },
    [closePicker, commitSegments, focusTextSegment, maxMentions, mentions, resolveActiveCaret]
  );

  useImperativeHandle(
    ref,
    () => ({
      insertMentionCandidate: insertMention,
      stashCaretBeforeBlur,
    }),
    [insertMention, stashCaretBeforeBlur]
  );

  const ensureTextBeforeMention = useCallback(
    (mentionIndex: number): QuickComposeSegment[] => {
      const prev = segments[mentionIndex - 1];
      if (prev?.type === 'text') return segments;
      const inserted = newQuickComposeTextSegment('');
      return [...segments.slice(0, mentionIndex), inserted, ...segments.slice(mentionIndex)];
    },
    [segments]
  );

  const focusAdjacentText = useCallback(
    (fromSegmentId: string, direction: 'prev' | 'next') => {
      const idx = segments.findIndex((s) => s.id === fromSegmentId);
      if (idx < 0) return;
      if (direction === 'prev') {
        for (let i = idx - 1; i >= 0; i -= 1) {
          const s = segments[i]!;
          if (s.type === 'text') {
            focusTextSegment(s.id, s.value.length);
            return;
          }
        }
        const first = segments[0];
        if (first?.type === 'mention') {
          const nextSegs = ensureTextBeforeMention(0);
          commitSegments(nextSegs);
          const lead = nextSegs[0];
          if (lead?.type === 'text') focusTextSegment(lead.id, 0);
        }
        return;
      }
      for (let i = idx + 1; i < segments.length; i += 1) {
        const s = segments[i]!;
        if (s.type === 'text') {
          focusTextSegment(s.id, 0);
          return;
        }
      }
    },
    [commitSegments, ensureTextBeforeMention, focusTextSegment, segments]
  );

  const focusAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const row = rowRef.current;
      if (!row) return;
      const resolved = resolveDropAnchorAtPoint(
        clientX,
        clientY,
        row,
        segmentsRef.current,
        inputRefs.current
      );
      if (resolved?.anchor.mode === 'text') {
        focusTextSegment(resolved.anchor.segmentId, resolved.anchor.offset);
        requestAnimationFrame(() => {
          const el = inputRefs.current.get(resolved.anchor.segmentId);
          if (!el || resolved.anchor.mode !== 'text') return;
          el.focus();
          el.setSelectionRange(resolved.anchor.offset, resolved.anchor.offset);
        });
        return;
      }
      if (resolved?.anchor.mode === 'before') {
        focusAdjacentText(resolved.anchor.segmentId, 'prev');
        return;
      }
      if (resolved?.anchor.mode === 'after') {
        focusAdjacentText(resolved.anchor.segmentId, 'next');
        return;
      }
      const fallback = pickDefaultActive(segmentsRef.current);
      if (fallback) focusTextSegment(fallback.segmentId, fallback.offset);
    },
    [focusAdjacentText, focusTextSegment]
  );

  const onTextChange = useCallback(
    (segmentId: string, value: string, el: HTMLInputElement | HTMLTextAreaElement) => {
      const offset = el.selectionStart ?? value.length;
      activeCaretRef.current = { segmentId, offset };
      commitSegments(updateTextSegmentValue(segments, segmentId, value));
      updatePickerFromText(segmentId, value, offset, el);
    },
    [commitSegments, segments, updatePickerFromText]
  );

  const onTextKeyDown = useCallback(
    (segmentId: string, value: string, e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const caret = el.selectionStart ?? 0;
      syncActiveFromEl(segmentId, el);

      if (pickerOpen && filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPickerIndex((i) => (i + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPickerIndex((i) => (i - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const c = filtered[pickerIndex] ?? filtered[0];
          if (c) insertMention(c);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closePicker();
          return;
        }
      }

      const segIdx = segments.findIndex((s) => s.id === segmentId);

      if (e.key === 'ArrowLeft' && caret === 0) {
        const prev = segIdx > 0 ? segments[segIdx - 1] : null;
        if (prev?.type === 'mention') {
          e.preventDefault();
          focusAdjacentText(segmentId, 'prev');
          return;
        }
      }

      if (e.key === 'ArrowRight' && caret >= value.length) {
        const next = segIdx >= 0 ? segments[segIdx + 1] : null;
        if (next?.type === 'mention') {
          e.preventDefault();
          focusAdjacentText(segmentId, 'next');
          return;
        }
      }

      if (e.key === 'Backspace' && value === '' && caret === 0) {
        const prev = segIdx > 0 ? segments[segIdx - 1] : null;
        if (prev?.type === 'mention') {
          e.preventDefault();
          commitSegments(removeMentionFromSegments(segments, prev.mention.id));
          return;
        }
      }

      if (multiline) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          if (!disabled) onSubmit?.();
        }
      } else if (e.key === 'Enter' && !e.shiftKey && !pickerOpen) {
        e.preventDefault();
        if (!disabled) onSubmit?.();
      }
    },
    [
      closePicker,
      commitSegments,
      disabled,
      filtered,
      focusAdjacentText,
      insertMention,
      multiline,
      onSubmit,
      pickerIndex,
      pickerOpen,
      segments,
      syncActiveFromEl,
    ]
  );

  const onMentionKeyDown = useCallback(
    (mentionId: string, e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const idx = segments.findIndex((s) => s.type === 'mention' && s.mention.id === mentionId);
        if (idx < 0) return;
        focusAdjacentText(segments[idx]!.id, 'prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = segments.findIndex((s) => s.type === 'mention' && s.mention.id === mentionId);
        if (idx < 0) return;
        focusAdjacentText(segments[idx]!.id, 'next');
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        commitSegments(removeMentionFromSegments(segments, mentionId));
      }
    },
    [commitSegments, focusAdjacentText, segments]
  );

  useEffect(
    () => () => {
      mentionDragListenersRef.current?.();
      mentionDragListenersRef.current = null;
    },
    []
  );

  const startMentionPointerDrag = useCallback(
    (mentionId: string, e: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      setMentionPointerDragId(mentionId);

      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        const row = rowRef.current;
        if (!row) return;
        const resolved = resolveDropAnchorAtPoint(
          ev.clientX,
          ev.clientY,
          row,
          segmentsRef.current,
          inputRefs.current
        );
        setDropCaret(resolved?.caret ?? null);
      };

      const onEnd = (ev: PointerEvent) => {
        const row = rowRef.current;
        try {
          if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        const resolved =
          row &&
          resolveDropAnchorAtPoint(
            ev.clientX,
            ev.clientY,
            row,
            segmentsRef.current,
            inputRefs.current
          );
        if (resolved) {
          commitSegments(
            relocateMentionSegment(segmentsRef.current, mentionId, resolved.anchor)
          );
        }
        setMentionPointerDragId(null);
        setDropCaret(null);
        cleanup();
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        mentionDragListenersRef.current = null;
      };

      mentionDragListenersRef.current?.();
      mentionDragListenersRef.current = cleanup;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [commitSegments, disabled]
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      for (const el of inputRefs.current.values()) {
        if (el.contains(t)) return;
      }
      const pickerEl = document.getElementById('qc-mention-picker-root');
      if (pickerEl?.contains(t)) return;
      closePicker();
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [closePicker, pickerOpen]);

  useEffect(() => {
    const focus = focusAfterIdRef.current;
    if (!focus) return;
    focusAfterIdRef.current = null;
    requestAnimationFrame(() => {
      const el = inputRefs.current.get(focus.id);
      el?.focus();
      if (el) el.setSelectionRange(focus.offset, focus.offset);
    });
  }, [segments]);

  const picker =
    pickerOpen && pickerAnchor && typeof document !== 'undefined'
      ? createPortal(
          <div
            id="qc-mention-picker-root"
            className="fixed z-[2700] max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-[#121216] py-1 shadow-xl ring-1 ring-black/40"
            style={{ left: pickerAnchor.left, top: pickerAnchor.top, width: pickerAnchor.width }}
            role="listbox"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-gray-500">请先将资产拖入输入框，再输入 @ 选择</div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={`${c.kind}-${c.assetId ?? 'cv'}-${c.label}`}
                  type="button"
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                    i === pickerIndex ? 'bg-white/[0.12]' : 'hover:bg-white/[0.06]'
                  }`}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    stashCaretBeforeBlur();
                    insertMention(c);
                  }}
                >
                  <MentionThumb src={c.previewSrc} alt={c.label} size={32} />
                </button>
              ))
            )}
          </div>,
          document.body
        )
      : null;

  const dropCaretLine =
    dropCaret && mentionPointerDragId && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="pointer-events-none fixed z-[2701] w-0.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]"
            style={{ left: dropCaret.left, top: dropCaret.top, height: dropCaret.height }}
            aria-hidden
          />,
          document.body
        )
      : null;

  const handleRowMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,button')) return;
      focusAtClientPoint(e.clientX, e.clientY);
    },
    [focusAtClientPoint]
  );

  return (
    <div className="relative min-w-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <div
        ref={rowRef}
        className={`flex w-full flex-wrap items-center gap-x-0.5 gap-y-1 py-0.5 ${
          multiline ? 'min-h-[5.5rem] content-start' : 'min-h-[2rem]'
        } ${mentionPointerDragId ? 'select-none' : ''}`}
        role="group"
        aria-label={ariaLabel}
        onMouseDown={handleRowMouseDown}
      >
        {showPlaceholder ? (
          <span className="pointer-events-none absolute left-0 top-0.5 z-0 text-[13px] leading-7 text-gray-500">
            {placeholder}
          </span>
        ) : null}

        {segments.map((seg, index) => {
          if (seg.type === 'mention') {
            const m = seg.mention;
            const isDragging = mentionPointerDragId === m.id;
            return (
              <span
                key={seg.id}
                data-qc-seg-id={seg.id}
                tabIndex={0}
                onPointerDown={(e) => startMentionPointerDrag(m.id, e)}
                onKeyDown={(e) => onMentionKeyDown(m.id, e)}
                className={`relative inline-flex max-h-7 shrink-0 touch-none select-none align-middle rounded-md ring-1 ring-white/[0.14] outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 ${
                  isDragging ? 'z-10 cursor-grabbing opacity-40' : 'cursor-grab'
                }`}
                style={{ touchAction: 'none' }}
                title={`${m.kind === 'current_view' ? '当前画面（提交时截取）' : m.label} — 按住拖动到目标位置`}
              >
                <MentionThumb src={m.previewSrc} alt={m.label} />
                <button
                  type="button"
                  disabled={disabled}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    commitSegments(removeMentionFromSegments(segments, m.id));
                  }}
                  className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-black/85 text-[9px] leading-none text-white ring-1 ring-white/20 hover:bg-red-900/90"
                  aria-label="移除引用"
                >
                  ×
                </button>
              </span>
            );
          }

          if (!shouldRenderTextSegment(segments, index)) return null;

          const fillRemaining = seg.id === lastTextSegmentId;

          return (
            <span
              key={seg.id}
              data-qc-seg-id={seg.id}
              className={
                fillRemaining
                  ? 'inline-flex min-w-0 flex-1 max-w-full align-middle'
                  : 'inline w-fit max-w-full align-middle'
              }
            >
              <AutoWidthTextInput
                segmentId={seg.id}
                value={seg.value}
                multiline={multiline}
                rows={rows}
                disabled={disabled}
                ariaLabel={ariaLabel}
                fillRemaining={fillRemaining}
                inputRefs={inputRefs}
                onChange={(v, el) => onTextChange(seg.id, v, el)}
                onKeyDown={(e) => onTextKeyDown(seg.id, seg.value, e)}
                onFocus={(el) => syncActiveFromEl(seg.id, el)}
                onCaretSync={(el) => syncActiveFromEl(seg.id, el)}
              />
            </span>
          );
        })}

        {mentions.length >= maxMentions ? (
          <span className="shrink-0 text-[10px] leading-7 text-amber-200/80">已达 {maxMentions} 张</span>
        ) : null}
      </div>
      {picker}
      {dropCaretLine}
    </div>
  );
}
);

export default QuickComposeMentionField;
