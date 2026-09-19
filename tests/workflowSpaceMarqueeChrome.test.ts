import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  marqueeViewportRectsEqual,
  snapMarqueeViewportRect,
} from '../components/workflow/WorkflowSpaceMarqueeChrome';

describe('WorkflowSpaceMarqueeChrome viewport snap', () => {
  it('snaps subpixels so equal after jitter', () => {
    const a = snapMarqueeViewportRect({ left: 10.4, top: 20.6, width: 100.2, height: 80.8 });
    const b = snapMarqueeViewportRect({ left: 10.49, top: 20.51, width: 99.6, height: 81.4 });
    expect(a).toEqual({ left: 10, top: 21, width: 100, height: 81 });
    expect(marqueeViewportRectsEqual(a, b)).toBe(true);
  });

  it('does not treat a 1px move as equal', () => {
    const a = snapMarqueeViewportRect({ left: 10, top: 20, width: 100, height: 80 });
    const b = snapMarqueeViewportRect({ left: 11, top: 20, width: 100, height: 80 });
    expect(marqueeViewportRectsEqual(a, b)).toBe(false);
  });

  it('measures the hint in the observer, not during render', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/workflow/WorkflowSpaceMarqueeChrome.tsx'), 'utf8');
    expect(src).toContain('setHintSpot');
    expect(src).toContain('snapMarqueeViewportRect');
    const renderIdx = src.indexOf('if (!active || !spotlight');
    const queryInRender = src.slice(renderIdx).includes('querySelector(\'[data-workflow-scroll-port="asset"]\')');
    expect(queryInRender).toBe(false);
  });
});
