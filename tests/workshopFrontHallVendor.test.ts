import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const vendorRoot = path.join(process.cwd(), 'vendor', 'basketikun-infinite-canvas');

function read(rel: string): string {
  return readFileSync(path.join(vendorRoot, rel), 'utf8');
}

describe('basketikun infinite-canvas vendor snapshot', () => {
  it('pins commit e856c878 and copies canvas primitives', () => {
    expect(existsSync(path.join(vendorRoot, 'SOURCE.txt'))).toBe(true);
    expect(read('SOURCE.txt')).toContain('e856c878');
    expect(existsSync(path.join(vendorRoot, 'LICENSE'))).toBe(true);
    expect(existsSync(path.join(vendorRoot, 'NOTICE'))).toBe(true);

    const canvas = read('components/canvas/infinite-canvas.tsx');
    expect(canvas).toMatch(/export function InfiniteCanvas/);
    const node = read('components/canvas/canvas-node.tsx');
    expect(node).toMatch(/export const CanvasNode = React\.memo\(function CanvasNode/);
    const toolbar = read('components/canvas/canvas-toolbar.tsx');
    expect(toolbar).toMatch(/export function CanvasToolbar/);
    expect(existsSync(path.join(vendorRoot, 'pages/canvas/project.tsx'))).toBe(true);
    expect(read('components/canvas/canvas-connections.tsx')).toMatch(/export function ConnectionPath/);
  });

  it('rewrites @/ imports to @ic/', () => {
    const canvas = read('components/canvas/infinite-canvas.tsx');
    expect(canvas).not.toMatch(/from ['"]@\//);
    expect(canvas.includes('@ic/') || !canvas.includes('from "')).toBe(true);
  });

  it('registers Vite @ic before @ so vendor imports are not swallowed', () => {
    const cfg = readFileSync(path.resolve('vite.config.ts'), 'utf8');
    expect(cfg).toMatch(/alias:\s*\[/);
    const icFind = cfg.indexOf("find: '@ic'");
    const atFind = cfg.indexOf("find: '@'");
    expect(icFind).toBeGreaterThan(0);
    expect(atFind).toBeGreaterThan(icFind);
  });

  it('lets select-tool empty drags pan and keeps the toolbar inside the board', () => {
    const canvas = read('components/canvas/infinite-canvas.tsx');
    expect(canvas).toContain('activeTool === "pan" || activeTool === "select"');
    const toolbar = read('components/canvas/canvas-toolbar.tsx');
    expect(toolbar).toContain('left: 16');
    expect(toolbar).not.toContain('left: 300');
  });

  it('keeps generation and storage shims on disk', () => {
    expect(existsSync(path.join(vendorRoot, 'shims/generation.ts'))).toBe(true);
    expect(existsSync(path.join(vendorRoot, 'services/api/image.ts'))).toBe(true);
    expect(existsSync(path.join(vendorRoot, 'lib/localforage-storage.ts'))).toBe(true);
    expect(read('shims/generation.ts')).toContain('front-hall-generation-disabled');
  });
});
