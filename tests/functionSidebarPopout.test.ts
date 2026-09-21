/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  copyDocumentStylesTo,
  isDocumentPictureInPictureAvailable,
  requestFunctionSidebarPopoutWindow,
  requestQuickComposePopoutWindow,
  setFunctionSidebarPinned,
  resolveFunctionSidebarHoverOwnerDocument,
  resolveFunctionSidebarHoverPortalRoot,
  clampFunctionSidebarHoverPreviewPosition,
} from '../services/functionSidebarPopout';

describe('functionSidebarPopout', () => {
  it('reports Document PiP from requestWindow', () => {
    const prev = (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
    (window as Window & { documentPictureInPicture?: { requestWindow: () => Promise<Window> } }).documentPictureInPicture = {
      requestWindow: async () => window,
    };
    expect(isDocumentPictureInPictureAvailable()).toBe(true);
    (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture = prev;
  });

  it('copies stylesheets into the popout document', () => {
    const target = document.implementation.createHTMLDocument('pip');
    const style = document.createElement('style');
    style.textContent = '.ac-pip-test{color:#fff}';
    document.head.appendChild(style);
    copyDocumentStylesTo(target, document);
    expect(target.head.querySelector('style')?.textContent).toContain('ac-pip-test');
    style.remove();
  });

  it('requestFunctionSidebarPopoutWindow uses Document PiP and copies styles', async () => {
    const pipDoc = document.implementation.createHTMLDocument('pip');
    const pipWin = {
      document: pipDoc,
      closed: false,
      close() {},
      addEventListener() {},
    } as unknown as Window;
    const requestWindow = vi.fn(async () => pipWin);
    (window as Window & { documentPictureInPicture?: { requestWindow: typeof requestWindow } }).documentPictureInPicture = {
      requestWindow,
    };
    const style = document.createElement('style');
    style.textContent = '.ac-pip-win{opacity:1}';
    document.head.appendChild(style);
    const win = await requestFunctionSidebarPopoutWindow({ width: 320, height: 640 });
    expect(requestWindow).toHaveBeenCalled();
    expect(win).toBe(pipWin);
    expect(pipDoc.head.querySelector('style')?.textContent).toContain('ac-pip-win');
    expect(pipDoc.head.querySelector('[data-function-sidebar-popout-drag]')?.textContent).toContain('-webkit-app-region: drag');
    style.remove();
    delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
  });

  it('falls back to named about:blank opener when Document PiP is missing', async () => {
    delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
    const pipDoc = document.implementation.createHTMLDocument('popup');
    const pipWin = {
      document: pipDoc,
      closed: false,
      close() {},
      addEventListener() {},
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(pipWin);
    (window as Window & { assetCutterWorkbench?: { toggleFunctionSidebarPin?: () => void } }).assetCutterWorkbench = {
      toggleFunctionSidebarPin: () => undefined,
    };
    const win = await requestFunctionSidebarPopoutWindow({ width: 320, height: 640 });
    expect(open).toHaveBeenCalledWith('about:blank', 'ac-function-sidebar', expect.stringContaining('popup=yes'));
    expect(win).toBe(pipWin);
    open.mockRestore();
    delete (window as Window & { assetCutterWorkbench?: unknown }).assetCutterWorkbench;
  });

  it('setFunctionSidebarPinned reports unpin as success', async () => {
    (window as Window & {
      assetCutterWorkbench?: { toggleFunctionSidebarPin: (pinned?: boolean) => Promise<{ ok: boolean; pinned: boolean }> };
    }).assetCutterWorkbench = {
      toggleFunctionSidebarPin: async () => ({ ok: true, pinned: false }),
    };
    await expect(setFunctionSidebarPinned(false)).resolves.toEqual({ ok: true, pinned: false });
    delete (window as Window & { assetCutterWorkbench?: unknown }).assetCutterWorkbench;
  });

  it('resolves hover preview portal into the popout document', () => {
    const pipDoc = document.implementation.createHTMLDocument('popup');
    const host = pipDoc.createElement('div');
    pipDoc.body.appendChild(host);
    expect(resolveFunctionSidebarHoverOwnerDocument(host)).toBe(pipDoc);
    expect(resolveFunctionSidebarHoverPortalRoot(host)).toBe(pipDoc.body);
    expect(resolveFunctionSidebarHoverPortalRoot(null)).toBe(document.body);
    expect(clampFunctionSidebarHoverPreviewPosition(300, 10, { width: 360, height: 800 })).toEqual({
      left: 140,
      top: 28,
    });
  });
});

describe('quick compose popout', () => {
  it('requestQuickComposePopoutWindow opens named ac-quick-compose in companion', async () => {
    delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
    const pipDoc = document.implementation.createHTMLDocument('popup');
    const pipWin = {
      document: pipDoc,
      closed: false,
      close() {},
      addEventListener() {},
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(pipWin);
    (window as Window & { assetCutterWorkbench?: { toggleFunctionSidebarPin?: () => void } }).assetCutterWorkbench = {
      toggleFunctionSidebarPin: () => undefined,
    };
    const win = await requestQuickComposePopoutWindow({ width: 720, height: 72 });
    expect(open).toHaveBeenCalledWith('about:blank', 'ac-quick-compose', expect.stringContaining('popup=yes'));
    expect(win).toBe(pipWin);
    expect(pipDoc.head.querySelector('[data-quick-compose-popout-drag]')?.textContent).toContain('-webkit-app-region: drag');
    expect(pipDoc.body.style.background).toBe('transparent');
    open.mockRestore();
    delete (window as Window & { assetCutterWorkbench?: unknown }).assetCutterWorkbench;
  });

  it('requestQuickComposePopoutWindow returns null on the web', async () => {
    delete (window as Window & { assetCutterWorkbench?: unknown }).assetCutterWorkbench;
    await expect(requestQuickComposePopoutWindow({ width: 720, height: 72 })).resolves.toBeNull();
  });

  it('pip shell is one rounded panel, with a bar row or a stacked filling input', () => {
    const bar = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkspaceQuickComposeBar.tsx'), 'utf8');
    const popout = fs.readFileSync(path.resolve(process.cwd(), 'services/functionSidebarPopout.ts'), 'utf8');
    const pipShell = bar.match(/isComposePopout\s*\?\s*`([^`]*)`/);
    expect(pipShell?.[1]).toContain('overflow-hidden rounded-2xl bg-[#0f0f12]');
    expect(pipShell?.[1] ?? '').not.toContain('WORKFLOW_QUICK_COMPOSE_BAR_SHELL');
    expect(bar).toContain("data-quick-compose-layout={isComposePopout ? (popoutStack ? 'stack' : 'bar') : undefined}");
    expect(bar).toContain('flex h-full min-h-0 w-full min-w-0 items-center gap-2 px-2 py-1.5');
    expect(bar).toContain('order-2 flex w-full shrink-0 flex-nowrap items-center gap-2');
    expect(bar).toContain('fillHeight={popoutStack}');
    expect(bar).toContain('min-h-[3.5rem]');
    expect(bar).toContain('Math.max(760,');
    expect(bar).toContain('Math.max(160,');
    expect(bar).not.toContain('flex min-w-0 flex-1 flex-nowrap items-center gap-2.5 overflow-hidden');
    expect(bar).toContain("popoutMode === 'pip' && popoutTarget ? popoutTarget : document.body");
    expect(bar).toContain('min-w-[8rem]');
    expect(popout).not.toContain('grid-template-rows');
    expect(popout).not.toContain('align-content: stretch');
    expect(popout).toContain('minWidth: 760');
    expect(popout).toContain('minHeight: 160');
  });
});
