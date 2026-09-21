export const FUNCTION_SIDEBAR_POPOUT_WINDOW_NAME = 'ac-function-sidebar';
export const QUICK_COMPOSE_POPOUT_WINDOW_NAME = 'ac-quick-compose';
export const FUNCTION_SIDEBAR_POPOUT_DRAG_CLASS = 'ac-function-sidebar-popout-drag';
export const QUICK_COMPOSE_POPOUT_DRAG_CLASS = 'ac-quick-compose-popout-drag';

export type FunctionSidebarPopoutSize = {
  width: number;
  height: number;
};

type NamedPopupOptions = {
  minWidth?: number;
  minHeight?: number;
  dragClass?: string;
};

type DocumentPictureInPictureApi = {
  requestWindow: (opts?: { width?: number; height?: number; disallowReturnToOpener?: boolean }) => Promise<Window>;
};

function documentPictureInPictureApi(): DocumentPictureInPictureApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi }).documentPictureInPicture;
  if (!api || typeof api.requestWindow !== 'function') return null;
  return api;
}

export function isDocumentPictureInPictureAvailable(): boolean {
  return documentPictureInPictureApi() != null;
}

export function copyDocumentStylesTo(
  targetDoc: Document,
  sourceDoc: Document = document,
  options?: { dragClass?: string },
): void {
  const head = targetDoc.head;
  if (!head) return;
  const dragClass = options?.dragClass ?? FUNCTION_SIDEBAR_POPOUT_DRAG_CLASS;
  for (const node of Array.from(sourceDoc.querySelectorAll('link[rel="stylesheet"], style'))) {
    head.appendChild(node.cloneNode(true));
  }
  targetDoc.documentElement.className = sourceDoc.documentElement.className;
  targetDoc.body.className = sourceDoc.body.className;
  targetDoc.documentElement.classList.add(dragClass);
  targetDoc.body.classList.add(dragClass);
  targetDoc.body.style.margin = '0';
  targetDoc.body.style.height = '100%';
  targetDoc.documentElement.style.height = '100%';
  const composePopout = dragClass === QUICK_COMPOSE_POPOUT_DRAG_CLASS;
  targetDoc.body.style.background = composePopout ? 'transparent' : '#0b0b0d';
  targetDoc.documentElement.style.background = composePopout ? 'transparent' : '';
  const drag = targetDoc.createElement('style');
  drag.setAttribute(
    dragClass === QUICK_COMPOSE_POPOUT_DRAG_CLASS
      ? 'data-quick-compose-popout-drag'
      : 'data-function-sidebar-popout-drag',
    '',
  );
  drag.textContent = `
    .${dragClass} { -webkit-app-region: drag; }
    ${
      composePopout
        ? `html.${dragClass}, body.${dragClass} { background: transparent !important; margin: 0; height: 100%; }`
        : ''
    }
    .${dragClass} :is(button, input, textarea, a, select, img, video, canvas, [contenteditable="true"], [draggable="true"], [data-sidebar-drop-target], [data-capability-preset-action-drop], [data-capability-hover-id], [role="button"], [role="searchbox"], [role="tab"], [role="option"], [data-function-sidebar-pin], [data-function-sidebar-popout], [data-quick-compose-queue]) {
      -webkit-app-region: no-drag;
    }
    .${dragClass} [data-quick-compose-grab] { -webkit-app-region: drag; }
  `;
  head.appendChild(drag);
}

function popoutFeatures(size: FunctionSidebarPopoutSize, options?: NamedPopupOptions): string {
  const width = Math.max(options?.minWidth ?? 220, Math.round(size.width));
  const height = Math.max(options?.minHeight ?? 320, Math.round(size.height));
  return `popup=yes,width=${width},height=${height},left=96,top=80`;
}

export function openNamedWorkbenchPopupWindow(
  name: string,
  size: FunctionSidebarPopoutSize,
  options?: NamedPopupOptions,
): Window | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  const win = window.open('about:blank', name, popoutFeatures(size, options));
  if (!win || win.closed) return null;
  try {
    copyDocumentStylesTo(win.document, document, { dragClass: options?.dragClass });
  } catch {
    return win;
  }
  return win;
}

export function openFunctionSidebarOpenerWindow(size: FunctionSidebarPopoutSize): Window | null {
  return openNamedWorkbenchPopupWindow(FUNCTION_SIDEBAR_POPOUT_WINDOW_NAME, size, {
    dragClass: FUNCTION_SIDEBAR_POPOUT_DRAG_CLASS,
  });
}

export async function requestFunctionSidebarPopoutWindow(
  size: FunctionSidebarPopoutSize,
): Promise<Window | null> {
  const inCompanion =
    typeof window !== 'undefined' &&
    Boolean((window as Window & { assetCutterWorkbench?: unknown }).assetCutterWorkbench);
  if (inCompanion) {
    const opener = openFunctionSidebarOpenerWindow(size);
    if (opener) return opener;
  }
  const api = documentPictureInPictureApi();
  if (api) {
    try {
      const win = await api.requestWindow({
        width: Math.max(220, Math.round(size.width)),
        height: Math.max(320, Math.round(size.height)),
      });
      if (win) {
        copyDocumentStylesTo(win.document);
        return win;
      }
    } catch {
      /* opener window next */
    }
  }
  return openFunctionSidebarOpenerWindow(size);
}

export async function requestQuickComposePopoutWindow(
  size: FunctionSidebarPopoutSize,
): Promise<Window | null> {
  const inCompanion =
    typeof window !== 'undefined' &&
    Boolean((window as Window & { assetCutterWorkbench?: unknown }).assetCutterWorkbench);
  if (!inCompanion) return null;
  return openNamedWorkbenchPopupWindow(QUICK_COMPOSE_POPOUT_WINDOW_NAME, size, {
    minWidth: 760,
    minHeight: 160,
    dragClass: QUICK_COMPOSE_POPOUT_DRAG_CLASS,
  });
}

type WorkbenchPinBridge = {
  toggleFunctionSidebarPin?: (pinned?: boolean) => Promise<{ ok?: boolean; pinned?: boolean }>;
  getFunctionSidebarPin?: () => Promise<{ ok?: boolean; pinned?: boolean }>;
};

function workbenchPinBridge(): WorkbenchPinBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { assetCutterWorkbench?: WorkbenchPinBridge }).assetCutterWorkbench ?? null;
}

export function canPinFunctionSidebarOverDesktop(): boolean {
  const bridge = workbenchPinBridge();
  return typeof bridge?.toggleFunctionSidebarPin === 'function';
}

export async function setFunctionSidebarPinned(pinned: boolean): Promise<{ ok: boolean; pinned: boolean }> {
  const bridge = workbenchPinBridge();
  if (!bridge?.toggleFunctionSidebarPin) return { ok: false, pinned: false };
  const result = await bridge.toggleFunctionSidebarPin(pinned);
  return { ok: Boolean(result?.ok), pinned: Boolean(result?.pinned) };
}

export function resolveFunctionSidebarHoverOwnerDocument(
  popoutTarget: HTMLElement | null | undefined,
): Document | null {
  if (popoutTarget?.ownerDocument) return popoutTarget.ownerDocument;
  if (typeof document === 'undefined') return null;
  return document;
}

export function resolveFunctionSidebarHoverPortalRoot(
  popoutTarget: HTMLElement | null | undefined,
): HTMLElement | null {
  return resolveFunctionSidebarHoverOwnerDocument(popoutTarget)?.body ?? null;
}

export function clampFunctionSidebarHoverPreviewPosition(
  x: number,
  y: number,
  viewport: { width: number; height: number },
  box = { width: 220, height: 236 },
): { left: number; top: number } {
  const left = Math.max(8, Math.min(x + 18, Math.max(8, viewport.width - box.width)));
  const top = Math.max(8, Math.min(y + 18, Math.max(8, viewport.height - box.height)));
  return { left, top };
}
