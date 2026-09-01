import { describe, expect, it, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const proto = require('../companion-desktop/workshop-media-protocol.cjs') as {
  issueWorkshopMediaUrl: (abs: string, meta?: { mime?: string; kind?: string }) => string;
  resolveWorkshopMediaRequest: (url: string) => { abs: string; mime: string; kind: string } | null;
  parseWorkshopMediaUrl: (url: string) => string | null;
  isWorkshopMediaUrl: (url: string) => boolean;
  clearWorkshopMediaTokensForTests: () => void;
};
const { createWorkshopFileTreeHost, resolveInsideRoot } = require('../companion-desktop/workshop-file-tree.cjs') as {
  createWorkshopFileTreeHost: (deps: Record<string, unknown>) => {
    getMedia: (payload: Record<string, unknown>) => Promise<{
      ok: boolean;
      url?: string;
      kind?: string;
      textPreview?: string;
      error?: string;
    }>;
    isAllowedMediaAbs: (abs: string) => boolean;
    pickRoot: () => Promise<{ ok: boolean; root?: string }>;
  };
  resolveInsideRoot: (root: string, rel: string) => string | null;
};

afterEach(() => {
  proto.clearWorkshopMediaTokensForTests();
});

describe('workshop media protocol', () => {
  it('issues and resolves ac-workshop tokens', () => {
    const url = proto.issueWorkshopMediaUrl('C:/lib/a.mp4', { mime: 'video/mp4', kind: 'video' });
    expect(url.startsWith('ac-workshop://v1/')).toBe(true);
    expect(url.endsWith('/a.mp4')).toBe(true);
    expect(proto.isWorkshopMediaUrl(url)).toBe(true);
    expect(proto.parseWorkshopMediaUrl('https://example.com/x')).toBeNull();
    const hit = proto.resolveWorkshopMediaRequest(url);
    expect(hit?.kind).toBe('video');
    expect(hit?.abs.toLowerCase()).toBe(path.resolve('C:/lib/a.mp4').toLowerCase());
  });

  it('refuses escaped files and serves text preview for markdown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-media-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-media-ws-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-media-out-'));
    fs.writeFileSync(path.join(root, 'note.md'), '# title\nbody');
    fs.writeFileSync(path.join(root, 'clip.mp4'), 'mp4');
    fs.writeFileSync(path.join(outside, 'secret.bin'), 'nope');
    let stored = '';
    let workspaceDir = workspace;
    const host = createWorkshopFileTreeHost({
      getRoot: () => stored,
      setRoot: (next: string) => {
        stored = next;
      },
      getWorkspaceDir: () => workspaceDir,
      setWorkspaceDir: (next: string) => {
        workspaceDir = next;
      },
      pickDirectory: async () => ({ canceled: false, filePaths: [root] }),
    });
    const picked = await host.pickRoot();
    expect(picked.ok).toBe(true);
    expect(host.isAllowedMediaAbs(path.join(root, 'note.md'))).toBe(true);
    expect(host.isAllowedMediaAbs(path.join(outside, 'secret.bin'))).toBe(false);
    expect(resolveInsideRoot(root, '../secret.bin')).toBe(null);

    const text = await host.getMedia({ root, rel: 'note.md' });
    expect(text.ok).toBe(true);
    expect(text.kind).toBe('text');
    expect(text.textPreview).toContain('# title');
    expect(text.url?.startsWith('ac-workshop://v1/')).toBe(true);

    const video = await host.getMedia({ root, rel: 'clip.mp4' });
    expect(video.ok).toBe(true);
    expect(video.kind).toBe('video');

    const escaped = await host.getMedia({ root, rel: '../secret.bin' });
    expect(escaped.ok).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
