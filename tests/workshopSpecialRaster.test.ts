import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decodeWorkshopSpecialRasterToJpeg,
  peekWorkshopSpecialRasterJpeg,
  rememberWorkshopSpecialRasterJpeg,
  workshopSpecialRasterSourceRow,
} from '../services/workshopSpecialRaster';

const require = createRequire(import.meta.url);
const { createWorkshopFileTreeHost, listCanvas } = require('../companion-desktop/workshop-file-tree.cjs') as {
  createWorkshopFileTreeHost: (deps: Record<string, unknown>) => {
    thumb: (payload: Record<string, unknown>) => Promise<{ ok: boolean; status?: string; kind?: string; dataUrl?: string }>;
    putThumb: (payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  };
  listCanvas: (root: string, rel: string) => Promise<{
    ok: boolean;
    items?: Array<{ kind: string; name: string; previewRels?: string[] }>;
  }>;
};

describe('workshopSpecialRaster', () => {
  it('returns null for empty url, non-special names, and a bad buffer url', async () => {
    expect(await decodeWorkshopSpecialRasterToJpeg({ url: '', fileName: 'a.exr' })).toBe(null);
    expect(await decodeWorkshopSpecialRasterToJpeg({ url: 'ac-workshop://v1/x/a.png', fileName: 'a.png' })).toBe(null);
    expect(await decodeWorkshopSpecialRasterToJpeg({ url: 'http://127.0.0.1:1/bad.exr', fileName: 'bad.exr' })).toBe(null);
  });

  it('keeps host thumbs off exr/hdr/psd and skips them as folder covers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-raster-'));
    fs.mkdirSync(path.join(root, 'hdrs'));
    fs.writeFileSync(path.join(root, 'sky.exr'), 'not-an-exr');
    fs.writeFileSync(path.join(root, 'hdrs', 'env.hdr'), 'not-hdr');
    fs.writeFileSync(path.join(root, 'hdrs', 'cover.png'), 'png');
    let stored = root;
    const workspaceDir = path.join(root, 'ws');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const host = createWorkshopFileTreeHost({
      getRoot: () => stored,
      setRoot: (next: string) => {
        stored = next;
      },
      getWorkspaceDir: () => workspaceDir,
    });
    const thumb = await host.thumb({ root, rel: 'sky.exr' });
    expect(thumb.ok).toBe(true);
    expect(thumb.kind).toBe('image');
    expect(thumb.status).toBe('placeholder');
    const canvas = await listCanvas(root, '');
    const folder = canvas.items?.find((i) => i.kind === 'folder' && i.name === 'hdrs');
    expect(folder?.previewRels).toEqual(['hdrs/cover.png']);
    const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
    const put = await host.putThumb({
      root,
      rel: 'sky.exr',
      dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    });
    expect(put).toEqual({ ok: true, rel: 'sky.exr' });
    const cached = await host.thumb({ root, rel: 'sky.exr' });
    expect(cached.status).toBe('ready');
    expect(cached.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('flips OpenGL row 0 to the canvas bottom', () => {
    expect(workshopSpecialRasterSourceRow(0, 4, 4, false)).toBe(0);
    expect(workshopSpecialRasterSourceRow(0, 4, 4, true)).toBe(3);
    expect(workshopSpecialRasterSourceRow(3, 4, 4, true)).toBe(0);
  });

  it('remembers decoded jpeg by file key', () => {
    rememberWorkshopSpecialRasterJpeg('wsfile:r/a.exr', false, 'data:image/jpeg;base64,xx');
    expect(peekWorkshopSpecialRasterJpeg('wsfile:r/a.exr', false)).toBe('data:image/jpeg;base64,xx');
  });
});
