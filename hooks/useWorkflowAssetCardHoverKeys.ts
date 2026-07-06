import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  applyWorkflowCardZoomLift,
  restoreWorkflowCardZoomLift,
} from '../services/workflowAssetCardZoomLift';

export type WorkflowCardHoverControl = {
  /** 与 zoom 高亮绑定的稳定键（资产 id 或 gall:…） */
  controlId: string;
  /** Q/E：上一张 / 下一张预览（版本或组内成员） */
  previewKind?: 'displayKey' | 'groupIndex';
  previewAssetId?: string;
  groupLen?: number;
  /** 悬停 + 按住 W 时放大 */
  zoomEligible?: boolean;
};

export type WorkflowCardPreviewStepHandler = (
  control: WorkflowCardHoverControl,
  delta: -1 | 1
) => void;

function isKeyboardTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return Boolean(t.closest('[contenteditable="true"]'));
}

const HOVER_CLEAR_GRACE_MS = 120;

export function useWorkflowAssetCardHoverKeys(opts?: {
  disabled?: boolean;
  onPreviewStep?: WorkflowCardPreviewStepHandler;
}) {
  const disabled = opts?.disabled ?? false;
  const onPreviewStepRef = useRef(opts?.onPreviewStep);
  onPreviewStepRef.current = opts?.onPreviewStep;

  const hoverRef = useRef<WorkflowCardHoverControl | null>(null);
  /** 按下 W 后锁定目标，移开鼠标仍保持放大直至松开 */
  const zoomTargetRef = useRef<WorkflowCardHoverControl | null>(null);
  const wHeldRef = useRef(false);
  const zoomHostsRef = useRef<Map<string, HTMLElement>>(new Map());
  const hoverClearTimerRef = useRef<number | null>(null);
  const [zoomControlId, setZoomControlId] = useState<string | null>(null);

  const registerCardZoomHost = useCallback((controlId: string, el: HTMLElement | null) => {
    if (el) zoomHostsRef.current.set(controlId, el);
    else zoomHostsRef.current.delete(controlId);
  }, []);

  const setHoveredCard = useCallback((control: WorkflowCardHoverControl | null) => {
    if (hoverClearTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    hoverRef.current = control;
  }, []);

  const clearHoveredCard = useCallback(() => {
    if (hoverClearTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(hoverClearTimerRef.current);
    }
    if (typeof window === 'undefined') {
      hoverRef.current = null;
      return;
    }
    hoverClearTimerRef.current = window.setTimeout(() => {
      hoverClearTimerRef.current = null;
      if (!wHeldRef.current) hoverRef.current = null;
    }, HOVER_CLEAR_GRACE_MS);
  }, []);

  useEffect(() => {
    if (disabled) {
      hoverRef.current = null;
      zoomTargetRef.current = null;
      wHeldRef.current = false;
      setZoomControlId(null);
      if (hoverClearTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }
    }
  }, [disabled]);

  useLayoutEffect(() => {
    if (!zoomControlId) return;
    const el = zoomHostsRef.current.get(zoomControlId);
    if (!el) return;

    const apply = () => {
      applyWorkflowCardZoomLift(el);
    };
    apply();
    window.addEventListener('resize', apply);
    document.addEventListener('scroll', apply, true);
    return () => {
      window.removeEventListener('resize', apply);
      document.removeEventListener('scroll', apply, true);
      restoreWorkflowCardZoomLift(el);
    };
  }, [zoomControlId]);

  useEffect(() => {
    if (disabled) return;

    const activeControl = (): WorkflowCardHoverControl | null => {
      if (wHeldRef.current && zoomTargetRef.current) return zoomTargetRef.current;
      return hoverRef.current ?? zoomTargetRef.current;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isKeyboardTypingTarget(e.target)) return;
      const h = activeControl();
      if (!h) return;

      if (e.code === 'KeyW') {
        if (!h.zoomEligible) return;
        if (!wHeldRef.current) {
          e.preventDefault();
          wHeldRef.current = true;
          zoomTargetRef.current = h;
          setZoomControlId(h.controlId);
        }
        return;
      }

      if (e.code !== 'KeyQ' && e.code !== 'KeyE') return;
      if (!h.previewKind || !h.previewAssetId) return;
      e.preventDefault();
      onPreviewStepRef.current?.(h, e.code === 'KeyE' ? 1 : -1);
    };

    const releaseW = () => {
      if (!wHeldRef.current) return;
      wHeldRef.current = false;
      zoomTargetRef.current = null;
      setZoomControlId(null);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') releaseW();
    };

    const onBlur = () => releaseW();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [disabled]);

  return { setHoveredCard, clearHoveredCard, zoomControlId, registerCardZoomHost };
}
