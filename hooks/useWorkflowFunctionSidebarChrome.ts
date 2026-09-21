import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readLocalJson, workflowFunctionSidebarChromeStorageKey, writeLocalJson } from '../services/clientPersist';
import {
  canPinFunctionSidebarOverDesktop,
  requestFunctionSidebarPopoutWindow,
  setFunctionSidebarPinned,
} from '../services/functionSidebarPopout';
import {
  WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX,
  WORKFLOW_FUNCTION_SIDEBAR_NARROW_RAIL_BELOW_PX,
  applyWorkflowFunctionSidebarPointerWidth,
  parseWorkflowFunctionSidebarChrome,
  resolveWorkflowFunctionSidebarLayout,
  type WorkflowFunctionSidebarLayout,
} from '../services/workflowFunctionSidebarLayout';

export type FunctionSidebarPopoutMode = 'docked' | 'pip' | 'overlay';

export function useWorkflowFunctionSidebarChrome(options: {
  preferenceScope: string | null | undefined;
  viewportWidthPx: number;
}): {
  layout: WorkflowFunctionSidebarLayout;
  preferredWidthPx: number;
  collapsed: boolean | undefined;
  popoutMode: FunctionSidebarPopoutMode;
  popoutTarget: HTMLElement | null;
  pinned: boolean;
  canPin: boolean;
  onSplitterPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  expandFromRail: () => void;
  requestPopout: (heightPx: number) => void;
  dockBack: () => void;
  togglePin: () => void;
} {
  const { preferenceScope, viewportWidthPx } = options;
  const storageKey = useMemo(
    () => workflowFunctionSidebarChromeStorageKey(preferenceScope),
    [preferenceScope],
  );
  const [preferredWidthPx, setPreferredWidthPx] = useState(() => {
    const saved = readLocalJson(storageKey, null, parseWorkflowFunctionSidebarChrome);
    return saved?.widthPx ?? WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX;
  });
  const [collapsed, setCollapsed] = useState<boolean | undefined>(() => {
    const saved = readLocalJson(storageKey, null, parseWorkflowFunctionSidebarChrome);
    return saved ? saved.collapsed : undefined;
  });
  const [popoutMode, setPopoutMode] = useState<FunctionSidebarPopoutMode>('docked');
  const [popoutTarget, setPopoutTarget] = useState<HTMLElement | null>(null);
  const [pinned, setPinned] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);
  const persistRef = useRef({ preferredWidthPx, collapsed });
  persistRef.current = { preferredWidthPx, collapsed };

  useEffect(() => {
    const saved = readLocalJson(storageKey, null, parseWorkflowFunctionSidebarChrome);
    setPreferredWidthPx(saved?.widthPx ?? WORKFLOW_FUNCTION_SIDEBAR_BASE_WIDTH_PX);
    setCollapsed(saved ? saved.collapsed : undefined);
  }, [storageKey]);

  const persist = useCallback(
    (nextWidth: number, nextCollapsed: boolean | undefined) => {
      const collapsedFlag =
        typeof nextCollapsed === 'boolean'
          ? nextCollapsed
          : viewportWidthPx > 0 && viewportWidthPx < WORKFLOW_FUNCTION_SIDEBAR_NARROW_RAIL_BELOW_PX;
      writeLocalJson(storageKey, { widthPx: nextWidth, collapsed: collapsedFlag });
    },
    [storageKey, viewportWidthPx],
  );

  const layout = useMemo(
    () =>
      resolveWorkflowFunctionSidebarLayout(viewportWidthPx, {
        preferredWidthPx,
        collapsed,
      }),
    [viewportWidthPx, preferredWidthPx, collapsed],
  );

  const applyChrome = useCallback(
    (nextWidth: number, nextCollapsed: boolean) => {
      setPreferredWidthPx(nextWidth);
      setCollapsed(nextCollapsed);
      persist(nextWidth, nextCollapsed);
    },
    [persist],
  );

  const expandFromRail = useCallback(() => {
    applyChrome(persistRef.current.preferredWidthPx, false);
  }, [applyChrome]);

  const closePopoutWindow = useCallback(() => {
    const win = pipWindowRef.current;
    pipWindowRef.current = null;
    setPopoutTarget(null);
    if (win && !win.closed) {
      try {
        win.close();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const dockBack = useCallback(() => {
    closePopoutWindow();
    setPopoutMode('docked');
    setPinned(false);
    applyChrome(persistRef.current.preferredWidthPx, false);
  }, [applyChrome, closePopoutWindow]);

  const requestPopout = useCallback(
    (heightPx: number) => {
      const width = layout.dockedWidthPx;
      const height = Math.max(360, Math.round(heightPx) || 640);
      const pipPromise = requestFunctionSidebarPopoutWindow({ width, height });
      void pipPromise
        .then((win) => {
          if (!win) {
            if (typeof window !== 'undefined' && window.assetCutterWorkbench) return;
            setPopoutTarget(null);
            setPopoutMode('overlay');
            applyChrome(width, true);
            return;
          }
          pipWindowRef.current = win;
          const dockIfThisWindow = () => {
            if (pipWindowRef.current === win) {
              pipWindowRef.current = null;
              setPopoutTarget(null);
              setPopoutMode('docked');
              setPinned(false);
              applyChrome(width, false);
            }
          };
          win.addEventListener('pagehide', dockIfThisWindow);
          win.addEventListener('unload', dockIfThisWindow);
          setPopoutTarget(win.document.body);
          setPopoutMode('pip');
          applyChrome(width, true);
            if (canPinFunctionSidebarOverDesktop()) {
              void setFunctionSidebarPinned(true).then((r) => {
                if (r.ok) setPinned(r.pinned);
              });
            }
        })
        .catch(() => {
          if (typeof window !== 'undefined' && window.assetCutterWorkbench) return;
          setPopoutTarget(null);
          setPopoutMode('overlay');
          applyChrome(width, true);
        });
    },
    [applyChrome, layout.dockedWidthPx],
  );

  const onSplitterPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const startRight = handle.parentElement?.getBoundingClientRect().right ?? event.clientX + layout.functionSidebarWidthPx;
      handle.setPointerCapture(event.pointerId);
      const onMove = (ev: PointerEvent) => {
        const proposed = startRight - ev.clientX;
        const next = applyWorkflowFunctionSidebarPointerWidth(
          proposed,
          persistRef.current.preferredWidthPx,
          viewportWidthPx,
        );
        persistRef.current = {
          preferredWidthPx: next.preferredWidthPx,
          collapsed: next.collapsed,
        };
        setPreferredWidthPx(next.preferredWidthPx);
        setCollapsed(next.collapsed);
      };
      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        const current = persistRef.current;
        persist(current.preferredWidthPx, current.collapsed);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [layout.functionSidebarWidthPx, persist, viewportWidthPx],
  );

  const togglePin = useCallback(() => {
    void setFunctionSidebarPinned(!pinned).then((r) => {
      if (r.ok) setPinned(r.pinned);
    });
  }, [pinned]);

  useLayoutEffect(() => {
    return () => {
      closePopoutWindow();
    };
  }, [closePopoutWindow]);

  return {
    layout,
    preferredWidthPx,
    collapsed,
    popoutMode,
    popoutTarget,
    pinned,
    canPin: canPinFunctionSidebarOverDesktop(),
    onSplitterPointerDown,
    expandFromRail,
    requestPopout,
    dockBack,
    togglePin,
  };
}
