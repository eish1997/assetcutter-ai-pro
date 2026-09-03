import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  createWorkshopFileTreeHost,
  resolveInsideRoot,
  isRelEscape,
  kindFromName,
  listDir,
  listCanvas,
  parseAcAssetDoc,
  parseWorkshopLibrary,
  parseWorkshopLinkDoc,
  thumbCacheId,
  AC_ASSET_MANIFEST,
  WORKSHOP_LIBRARY_FILE,
  WORKSHOP_LIBRARY_README,
  WORKSHOP_LINKS_DIR,
  RECYCLE_DIR,
  RECYCLE_ROOT_ID,
} = require('../companion-desktop/workshop-file-tree.cjs') as {
  createWorkshopFileTreeHost: (deps: Record<string, unknown>) => {
    list: (payload: Record<string, unknown>) => Promise<{
      ok: boolean;
      entries?: Array<{ name: string; kind: string; rel: string; isPackage?: boolean }>;
      items?: Array<{ kind: string; name: string; rel: string; assetId?: string; root?: string }>;
      error?: string;
    }>;
    thumb: (payload: Record<string, unknown>) => Promise<{ ok: boolean; status?: string; kind?: string }>;
    readFile: (payload: Record<string, unknown>) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
    writeResult: (payload: Record<string, unknown>) => Promise<{ ok: boolean; fileId?: string; error?: string }>;
    createPackage: (payload: Record<string, unknown>) => Promise<{ ok: boolean; assetId?: string; packageRel?: string; checkoutRel?: string; error?: string }>;
    upgradeLoose: (payload: Record<string, unknown>) => Promise<{ ok: boolean; assetId?: string; checkoutRel?: string; error?: string }>;
    applyCheckout: (payload: Record<string, unknown>) => Promise<{ ok: boolean; fileId?: string; checkoutRel?: string; error?: string }>;
    pickWorkspaceDir: () => Promise<{ ok: boolean; dir?: string; canceled?: boolean; error?: string }>;
    setLibraryOpen: (payload: { root?: string; rel?: string }) => { ok: boolean; openRoot?: string; error?: string };
    resolveSendFile: (finger: Record<string, unknown>) => Promise<{ ok: boolean; fileAbs?: string; error?: string }>;
    pickRoot: () => Promise<{ ok: boolean; root?: string; error?: string; canceled?: boolean }>;
    removeRoot: (payload: { root: string }) => { ok: boolean };
    createCheckoutFile: (payload: Record<string, unknown>) => Promise<{ ok: boolean; rel?: string; error?: string }>;
    renameEntry: (payload: Record<string, unknown>) => Promise<{ ok: boolean; from?: string; to?: string; error?: string }>;
    resolveAbs: (payload: Record<string, unknown>) => { ok: boolean; abs?: string; error?: string };
    groupEntries: (payload: Record<string, unknown>) => Promise<{ ok: boolean; destRel?: string; error?: string }>;
    copyEntries: (payload: Record<string, unknown>) => Promise<{ ok: boolean; copied?: Array<{ to: string }>; error?: string }>;
    trashEntries: (payload: Record<string, unknown>) => Promise<{ ok: boolean; rels?: string[]; error?: string }>;
    state: () => {
      ok: boolean;
      root: string;
      label: string;
      workspaceDir?: string;
      openRoot?: string;
      openRel?: string;
      roots?: Array<{ root: string; label: string }>;
    };
  };
  resolveInsideRoot: (root: string, rel: string) => string | null;
  isRelEscape: (rel: string) => boolean;
  kindFromName: (name: string) => string;
  listDir: (root: string, rel: string) => Promise<{ ok: boolean; entries?: Array<{ name: string; kind: string; isPackage?: boolean }> }>;
  listCanvas: (
    root: string,
    rel: string,
    opts?: { includeSubfolders?: boolean },
  ) => Promise<{
    ok: boolean;
    items?: Array<{ kind: string; name: string; rel?: string; previewRels?: string[]; containedKinds?: string[]; assetKind?: string }>;
  }>;
  parseAcAssetDoc: (raw: unknown) => { id: string; displayFileId: string } | null;
  parseWorkshopLibrary: (raw: unknown, dir?: string) => {
    v: number;
    name: string;
    roots: Array<{ path: string; label: string; addedAt: number }>;
    open: { root: string; rel: string };
  };
  parseWorkshopLinkDoc: (raw: unknown) => { id: string; kind: string; href: string } | null;
  thumbCacheId: (root: string, rel: string, size: number, mtimeMs: number, edge: number) => string;
  AC_ASSET_MANIFEST: string;
  WORKSHOP_LIBRARY_FILE: string;
  WORKSHOP_LIBRARY_README: string;
  WORKSHOP_LINKS_DIR: string;
  RECYCLE_DIR: string;
  RECYCLE_ROOT_ID: string;
};

describe('workshop file tree host', () => {
  it('blocks path escape and classifies names', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-tree-'));
    expect(isRelEscape('../x')).toBe(true);
    expect(isRelEscape('a/../b')).toBe(false);
    expect(resolveInsideRoot(root, '../outside')).toBe(null);
    expect(resolveInsideRoot(root, 'ok/here')).toBe(path.resolve(root, 'ok', 'here'));
    expect(kindFromName('a.png')).toBe('image');
    expect(kindFromName('a.exr')).toBe('image');
    expect(kindFromName('a.hdr')).toBe('image');
    expect(kindFromName('a.psd')).toBe('image');
    expect(kindFromName('a.glb')).toBe('model');
    expect(kindFromName('a.txt')).toBe('text');
    expect(kindFromName('a.mp4')).toBe('video');
    expect(thumbCacheId(root, 'a.png', 1, 2, 256)).toHaveLength(24);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists only the current directory and skips hidden names', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-list-'));
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'photo.jpg'), 'x');
    fs.writeFileSync(path.join(root, '.secret'), 'x');
    fs.writeFileSync(path.join(root, 'sub', 'deep.png'), 'x');
    const listed = await listDir(root, '');
    expect(listed.ok).toBe(true);
    const names = (listed.entries || []).map((e) => e.name).sort();
    expect(names).toEqual(['photo.jpg', 'sub']);
    const nested = await listDir(root, 'sub');
    expect(nested.entries?.map((e) => e.name)).toEqual(['deep.png']);
    const flat = await listCanvas(root, '', { includeSubfolders: true });
    expect(flat.items?.some((i) => i.kind === 'folder')).toBe(false);
    expect(flat.items?.map((i) => i.name).sort()).toEqual(['deep.png', 'photo.jpg']);
    const layered = await listCanvas(root, '');
    expect(layered.items?.some((i) => i.kind === 'folder' && i.name === 'sub')).toBe(true);
    expect(layered.items?.some((i) => i.name === 'deep.png')).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('marks package dirs and lists them as canvas items not tree dirs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-pkg-'));
    const pkgDir = path.join(root, 'a3f1c0e8');
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(
      path.join(pkgDir, AC_ASSET_MANIFEST),
      `${JSON.stringify({
        v: 1,
        id: 'a3f1c0e8',
        title: '1.jpg',
        displayFileId: 'c91e04d2',
        files: {
          '7b2c91aa': { name: '7b2c91aa.png', role: 'original' },
          c91e04d2: { name: 'c91e04d2.png', role: 'result' },
        },
        resultOrder: ['c91e04d2'],
        tags: [],
      })}\n`,
    );
    fs.writeFileSync(path.join(root, 'loose.png'), 'x');
    fs.writeFileSync(path.join(root, 'clip.mp4'), 'x');
    const dirs = await listDir(root, '');
    const pkgEntry = dirs.entries?.find((e) => e.name === 'a3f1c0e8');
    expect(pkgEntry?.isPackage).toBe(true);
    const canvas = await listCanvas(root, '');
    expect(canvas.items?.some((i) => i.kind === 'package' && i.name === '1.jpg')).toBe(true);
    expect(canvas.items?.some((i) => i.kind === 'loose' && i.name === 'loose.png')).toBe(true);
    expect(canvas.items?.some((i) => i.kind === 'loose' && i.name === 'clip.mp4' && i.assetKind === 'video')).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('host list requires an opened root and thumbs stay placeholders without nativeImage', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-host-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    fs.writeFileSync(path.join(root, 'a.png'), Buffer.from([1, 2, 3]));
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
      cacheDir: () => path.join(root, 'cache-should-not-pollute-tree'),
      pickDirectory: async () => ({ canceled: false, filePaths: [root] }),
    });
    expect((await host.list({})).error).toBe('no_root');
    const picked = await host.pickRoot();
    expect(picked.ok).toBe(true);
    expect(host.state().label).toBe(path.basename(root));
    const listed = await host.list({ rel: '' });
    expect(listed.ok).toBe(true);
    expect(listed.entries?.some((e) => e.name === 'a.png')).toBe(true);
    const assets = await host.list({ assetsOnly: true, rel: '' });
    expect(assets.items?.some((e) => e.kind === 'loose' && e.name === 'a.png')).toBe(true);
    const thumb = await host.thumb({ rel: 'a.png' });
    expect(thumb.ok).toBe(true);
    expect(thumb.status).toBe('placeholder');
    expect(fs.existsSync(path.join(root, 'a_thumb.jpg'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('upgradeLoose keeps the checkout path and writes versions only in workspace', async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-b-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    fs.writeFileSync(path.join(rootA, 'same.png'), 'src-a');
    fs.writeFileSync(path.join(rootB, 'same.png'), 'src-b');
    let stored: string[] = [rootA, rootB];
    let workspaceDir = workspace;
    const host = createWorkshopFileTreeHost({
      getRoots: () => stored,
      setRoots: (next: string[]) => {
        stored = next.slice();
      },
      getWorkspaceDir: () => workspaceDir,
      setWorkspaceDir: (next: string) => {
        workspaceDir = next;
      },
      pickDirectory: async () => ({ canceled: true, filePaths: [] }),
    });
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const upgraded = await host.upgradeLoose({ root: rootA, rel: 'same.png', dataUrl: png, step: 'test' });
    expect(upgraded.ok).toBe(true);
    expect(fs.existsSync(path.join(rootA, 'same.png'))).toBe(true);
    expect(fs.readFileSync(path.join(rootA, 'same.png'), 'utf8')).toBe('src-a');
    expect(fs.existsSync(path.join(rootB, 'same.png'))).toBe(true);
    const dirs = fs.readdirSync(rootA).filter((n) => n !== 'same.png');
    expect(dirs.every((n) => !fs.existsSync(path.join(rootA, n, AC_ASSET_MANIFEST)))).toBe(true);
    const listed = await host.list({ root: rootA, rel: '', assetsOnly: true });
    const same = (listed.items || []).find((i) => i.rel === 'same.png');
    expect(same?.resultOrder?.length).toBe(1);
    expect(same?.displayFileId).toBe(upgraded.fileId);
    expect(same?.checkoutFileId).toBeTruthy();
    expect(same?.checkoutFileId).not.toBe(upgraded.fileId);
    const readA = await host.readFile({ root: rootA, assetId: upgraded.assetId, fileId: upgraded.fileId });
    expect(readA.ok).toBe(true);
    const readB = await host.readFile({ root: rootB, rel: 'same.png' });
    expect(readB.ok).toBe(true);
    expect(readB.dataUrl).toContain('base64');
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('resolveSendFile resolves display file path from finger ids', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-send-'));
    const pkgDir = path.join(root, 'pkg01');
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(path.join(pkgDir, 'face.png'), 'face');
    fs.writeFileSync(
      path.join(pkgDir, AC_ASSET_MANIFEST),
      `${JSON.stringify({
        v: 1,
        id: 'pkg01',
        title: 'face',
        displayFileId: 'f1',
        files: { f1: { name: 'face.png', role: 'result' } },
        resultOrder: ['f1'],
        tags: [],
      })}\n`,
    );
    let stored = root;
    const host = createWorkshopFileTreeHost({
      getRoot: () => stored,
      setRoot: (next: string) => {
        stored = next;
      },
    });
    const hit = await host.resolveSendFile({
      selectedRoot: root,
      selectedAssetId: `wspkg:${encodeURIComponent(root)}/pkg01`,
      selectedFileId: 'f1',
      selectedRelPath: 'pkg01/face.png',
    });
    expect(hit.ok).toBe(true);
    expect(hit.fileAbs).toBe(path.join(pkgDir, 'face.png'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('createPackage writes one checkout file and keeps versions in workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-create-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    let stored = root;
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
    });
    const created = await host.createPackage({ root, parentRel: '', title: '一只猫' });
    expect(created.ok).toBe(true);
    expect(created.checkoutRel).toBeTruthy();
    expect(fs.existsSync(path.join(root, String(created.checkoutRel)))).toBe(true);
    expect(fs.existsSync(path.join(root, String(created.assetId), AC_ASSET_MANIFEST))).toBe(false);
    const listed = await host.list({ assetsOnly: true, rel: '' });
    expect(listed.items?.some((i) => i.kind === 'loose' && i.rel === created.checkoutRel)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('writeResult appends a result in workspace without applying checkout', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-write-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    let stored = root;
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
    });
    const created = await host.createPackage({ root, parentRel: '', title: 'seed' });
    expect(created.ok).toBe(true);
    const before = fs.readFileSync(path.join(root, String(created.checkoutRel)));
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const written = await host.writeResult({
      root,
      assetId: created.assetId,
      dataUrl: png,
      step: 'gen',
    });
    expect(written.ok).toBe(true);
    expect(written.fileId).toBeTruthy();
    expect(fs.readFileSync(path.join(root, String(created.checkoutRel))).equals(before)).toBe(true);
    const applied = await host.applyCheckout({
      root,
      assetId: created.assetId,
      fileId: written.fileId,
    });
    expect(applied.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, String(created.checkoutRel))).equals(before)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('resolveSendFile does not overwrite checkout when face differs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sendface-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    let stored = root;
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
    });
    const created = await host.createPackage({ root, parentRel: '', title: 'seed' });
    expect(created.ok).toBe(true);
    const before = fs.readFileSync(path.join(root, String(created.checkoutRel)));
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const written = await host.writeResult({
      root,
      assetId: created.assetId,
      dataUrl: png,
      step: 'gen',
    });
    expect(written.ok).toBe(true);
    await host.setFace({ root, assetId: created.assetId, fileId: written.fileId });
    const sent = await host.resolveSendFile({
      selectedRoot: root,
      selectedAssetId: `wsfile:${encodeURIComponent(root)}/${created.checkoutRel}`,
      selectedFileId: written.fileId,
      selectedRelPath: created.checkoutRel,
    });
    expect(sent.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, String(created.checkoutRel))).equals(before)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('refuses writes without a user-picked workspace and rejects a workspace inside a library root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-nows-'));
    let stored = root;
    let workspaceDir = '';
    const host = createWorkshopFileTreeHost({
      getRoot: () => stored,
      setRoot: (next: string) => {
        stored = next;
      },
      getWorkspaceDir: () => workspaceDir,
      setWorkspaceDir: (next: string) => {
        workspaceDir = next;
      },
      pickDirectory: async () => ({ canceled: false, filePaths: [path.join(root, 'nested')] }),
    });
    const created = await host.createPackage({ root, parentRel: '', title: 'x' });
    expect(created.ok).toBe(false);
    expect(created.error).toBe('no_workspace');
    fs.mkdirSync(path.join(root, 'nested'));
    const picked = await host.pickWorkspaceDir();
    expect(picked.ok).toBe(false);
    expect(picked.error).toBe('workspace_inside_library');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('adding a folder appends a root instead of replacing the library', async () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-b-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    let stored: string[] = [];
    let workspaceDir = workspace;
    const host = createWorkshopFileTreeHost({
      getRoots: () => stored,
      setRoots: (next: string[]) => {
        stored = next.slice();
      },
      getWorkspaceDir: () => workspaceDir,
      setWorkspaceDir: (next: string) => {
        workspaceDir = next;
      },
      pickDirectory: async () => ({ canceled: false, filePaths: host.state().roots?.length ? [b] : [a] }),
    });
    await host.pickRoot();
    await host.pickRoot();
    expect(host.state().roots?.map((r) => r.root).sort()).toEqual([path.resolve(a), path.resolve(b)].sort());
    host.removeRoot({ root: a });
    expect(host.state().roots?.map((r) => r.root)).toEqual([path.resolve(b)]);
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('pickRoot without a library folder fails and does not write AppData roots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-nolib-'));
    let stored: string[] = [];
    const host = createWorkshopFileTreeHost({
      getRoots: () => stored,
      setRoots: (next: string[]) => {
        stored = next.slice();
      },
      getWorkspaceDir: () => '',
      pickDirectory: async () => ({ canceled: false, filePaths: [root] }),
    });
    const picked = await host.pickRoot();
    expect(picked.ok).toBe(false);
    expect(picked.error).toBe('no_workspace');
    expect(stored).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes library.json, readme and links slot; migrates AppData roots once', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mig-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    let stored: string[] = [root];
    let workspaceDir = workspace;
    const host = createWorkshopFileTreeHost({
      getRoots: () => stored,
      setRoots: (next: string[]) => {
        stored = next.slice();
      },
      getWorkspaceDir: () => workspaceDir,
      setWorkspaceDir: (next: string) => {
        workspaceDir = next;
      },
    });
    const st = host.state();
    expect(st.roots?.map((r) => r.root)).toEqual([path.resolve(root)]);
    expect(stored).toEqual([]);
    const libPath = path.join(workspace, WORKSHOP_LIBRARY_FILE);
    expect(fs.existsSync(libPath)).toBe(true);
    expect(fs.existsSync(path.join(workspace, WORKSHOP_LIBRARY_README))).toBe(true);
    expect(fs.statSync(path.join(workspace, WORKSHOP_LINKS_DIR)).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(workspace, RECYCLE_DIR)).isDirectory()).toBe(true);
    const parsed = parseWorkshopLibrary(JSON.parse(fs.readFileSync(libPath, 'utf8')), workspace);
    expect(parsed.roots.map((r) => r.path)).toEqual([path.resolve(root)]);
    const opened = host.setLibraryOpen({ root, rel: 'sub' });
    expect(opened.ok).toBe(true);
    expect(host.state().openRoot).toBe(path.resolve(root));
    expect(host.state().openRel).toBe('sub');
    expect(parseWorkshopLinkDoc({ id: 'l1', kind: 'url', href: 'https://example.com', title: 'ex' })?.id).toBe('l1');
    expect(parseWorkshopLinkDoc({ id: 'x', kind: 'nope', href: 'a' })).toBe(null);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('creates md in the current folder, applies png with ext change, groups copies and trash', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ops-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-work-'));
    fs.writeFileSync(path.join(root, 'a.png'), 'aa');
    fs.writeFileSync(path.join(root, 'b.png'), 'bb');
    let stored = root;
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
    });
    const created = await host.createCheckoutFile({ root, parentRel: '', title: '文本', ext: '.md', body: 'hello' });
    expect(created.ok).toBe(true);
    expect(String(created.rel || '')).toMatch(/\.md$/);
    expect(fs.readFileSync(path.join(root, String(created.rel)), 'utf8')).toBe('hello');
    const canvas = await listCanvas(root, '');
    expect(canvas.items?.some((i) => i.kind === 'loose' && i.name === path.basename(String(created.rel)))).toBe(true);
    fs.mkdirSync(path.join(root, 'refs'));
    fs.writeFileSync(path.join(root, 'refs', 'cover.png'), 'xx');
    const withFolder = await listCanvas(root, '');
    const refs = withFolder.items?.find((i) => i.kind === 'folder' && i.name === 'refs');
    expect(refs).toBeTruthy();
    expect(refs?.previewRels).toEqual(['refs/cover.png']);
    expect(refs?.containedKinds).toEqual(['image']);
    fs.mkdirSync(path.join(root, 'refs', 'notes'));
    fs.writeFileSync(path.join(root, 'refs', 'notes', 'readme.md'), 'hi');
    const nestedKinds = await listCanvas(root, '');
    const refsWithNotes = nestedKinds.items?.find((i) => i.kind === 'folder' && i.name === 'refs');
    expect(refsWithNotes?.containedKinds).toEqual(['image', 'text']);

    const bound = await host.upgradeLoose({
      root,
      rel: created.rel,
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      step: 'gen',
    });
    expect(bound.ok).toBe(true);
    const applied = await host.applyCheckout({
      root,
      rel: created.rel,
      assetId: bound.assetId,
      fileId: bound.fileId,
    });
    expect(applied.ok).toBe(true);
    expect(String(applied.checkoutRel || '')).toMatch(/\.png$/);
    expect(fs.existsSync(path.join(root, String(created.rel)))).toBe(false);
    expect(fs.existsSync(path.join(root, String(applied.checkoutRel)))).toBe(true);

    const grouped = await host.groupEntries({ root, parentRel: '', rels: ['a.png', 'b.png'] });
    expect(grouped.ok).toBe(true);
    expect(grouped.destRel).toBeTruthy();
    expect(fs.existsSync(path.join(root, String(grouped.destRel), 'a.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'a.png'))).toBe(false);

    const copied = await host.copyEntries({ root, rels: [`${grouped.destRel}/a.png`] });
    expect(copied.ok).toBe(true);
    expect(copied.copied?.[0]?.to).toBeTruthy();
    expect(fs.existsSync(path.join(root, String(copied.copied?.[0]?.to)))).toBe(true);

    const trashed = await host.trashEntries({ root, rels: [String(copied.copied?.[0]?.to)] });
    expect(trashed.ok).toBe(true);
    expect(fs.existsSync(path.join(root, String(copied.copied?.[0]?.to)))).toBe(false);
    const trashedFolder = await host.trashEntries({ root, rels: [String(grouped.destRel)] });
    expect(trashedFolder.ok).toBe(true);
    expect(fs.existsSync(path.join(root, String(grouped.destRel)))).toBe(false);
    const missing = await host.trashEntries({ root, rels: ['no-such-file.png'] });
    expect(missing.ok).toBe(false);
    const wrongRoot = await host.trashEntries({ root: os.tmpdir(), rels: ['a.png'] });
    expect(wrongRoot.ok).toBe(false);
    expect(wrongRoot.error).toBe('no_root');
    expect(fs.existsSync(path.join(root, '.ac-recycle'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, RECYCLE_DIR))).toBe(true);
    const recycled = await host.list({ root: RECYCLE_ROOT_ID, assetsOnly: true, rel: '' });
    expect(recycled.ok).toBe(true);
    expect(recycled.items?.some((i) => i.kind === 'folder' && i.root === RECYCLE_ROOT_ID)).toBe(true);
    const foundPng: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (fs.statSync(abs).isDirectory()) walk(abs);
        else if (/\.png$/i.test(name) && !name.endsWith('.ac-meta.json')) foundPng.push(abs);
      }
    };
    walk(path.join(workspace, RECYCLE_DIR));
    expect(foundPng.length).toBeGreaterThan(0);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });
});
