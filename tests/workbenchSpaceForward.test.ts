import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  isSpaceInput,
  isCursorInViewBounds,
  shouldForwardSpaceToWorkbench,
  spaceMarqueeIpcPayload,
} = require('../companion-desktop/workbench-space-forward.cjs') as {
  isSpaceInput: (input: unknown) => boolean;
  isCursorInViewBounds: (
    screenPoint: { x: number; y: number },
    contentBounds: { x: number; y: number; width: number; height: number },
    viewBounds: { x: number; y: number; width: number; height: number },
  ) => boolean;
  shouldForwardSpaceToWorkbench: (opts: {
    input?: { type?: string; code?: string; key?: string; isAutoRepeat?: boolean };
    shellView?: string;
    cursorInWorkbench?: boolean;
  }) => boolean;
  spaceMarqueeIpcPayload: (input: { type?: string }) => { down: boolean };
};

describe('workbench space forward', () => {
  it('recognizes Space from code or key', () => {
    expect(isSpaceInput({ code: 'Space', key: ' ' })).toBe(true);
    expect(isSpaceInput({ key: ' ' })).toBe(true);
    expect(isSpaceInput({ key: 'Space' })).toBe(true);
    expect(isSpaceInput({ code: 'KeyA' })).toBe(false);
  });

  it('maps cursor in window content to the workbench rect', () => {
    const content = { x: 100, y: 50, width: 1000, height: 700 };
    const view = { x: 28, y: 30, width: 600, height: 670 };
    expect(isCursorInViewBounds({ x: 200, y: 120 }, content, view)).toBe(true);
    expect(isCursorInViewBounds({ x: 800, y: 120 }, content, view)).toBe(false);
  });

  it('forwards Space when the cursor is over the workbench', () => {
    const input = { type: 'keyDown', code: 'Space', key: ' ' };
    expect(
      shouldForwardSpaceToWorkbench({
        input,
        shellView: 'workbench',
        cursorInWorkbench: true,
      }),
    ).toBe(true);
    expect(
      shouldForwardSpaceToWorkbench({
        input,
        shellView: 'workbench',
        cursorInWorkbench: false,
      }),
    ).toBe(false);
    expect(
      shouldForwardSpaceToWorkbench({
        input,
        shellView: 'tools',
        cursorInWorkbench: true,
      }),
    ).toBe(false);
    expect(
      shouldForwardSpaceToWorkbench({
        input: { ...input, isAutoRepeat: true },
        shellView: 'workbench',
        cursorInWorkbench: true,
      }),
    ).toBe(false);
  });

  it('maps key events to ipc payload', () => {
    expect(spaceMarqueeIpcPayload({ type: 'keyDown' })).toEqual({ down: true });
    expect(spaceMarqueeIpcPayload({ type: 'keyUp' })).toEqual({ down: false });
  });

  it('wires ipc from the desktop shell and workbench preload', () => {
    const main = readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const preload = readFileSync(path.resolve(process.cwd(), 'companion-desktop/preload-workbench.cjs'), 'utf8');
    expect(main).toContain('workbench-space-forward.cjs');
    expect(main).toContain('bindWorkbenchSpaceKeyForward');
    expect(main).toContain('workbench-space-marquee');
    expect(main).not.toContain('sendInputEvent');
    expect(preload).toContain('onSpaceMarquee');
    expect(preload).toContain('workbench-space-marquee');
  });
});
