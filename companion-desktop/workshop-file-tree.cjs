'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { createHash } = require('node:crypto');
const { issueWorkshopMediaUrl } = require('./workshop-media-protocol.cjs');

const THUMB_EDGE = 256;
const MAX_LIST = 4000;
const MAX_FALLBACK_DECODE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const AC_ASSET_MANIFEST = 'ac-asset.json';
const WORKSHOP_LIBRARY_FILE = 'library.json';
const WORKSHOP_LIBRARY_README = 'README-库目录.txt';
const WORKSHOP_LINKS_DIR = 'links';
const WORKSHOP_LIBRARY_README_TEXT = [
  '这是作坊的库目录（不是素材盘）。',
  '',
  'library.json     已挂上的素材文件夹名单、上次打开位置',
  'index.json       检出文件对应的资产 id',
  'packages/        生成的多版本和清单',
  'thumbs/          预览缓存，可删可再生',
  'links/           链接/书签（{id}.json：v/id/kind/title/href/addedAt）',
  'recycle/         回收站（左树与「浏览器资产」同级）；7 天后真删',
  '',
  '素材文件仍在你「挂上」的那些文件夹里，不会复制进来。',
  '壳只记住当前打开哪一座库。',
  '',
].join('\n');

const JPEG_THUMB_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff']);
const SPECIAL_RASTER_EXT = new Set(['.exr', '.hdr', '.psd']);
const IMAGE_EXT = new Set([...JPEG_THUMB_EXT, ...SPECIAL_RASTER_EXT]);
const MODEL_EXT = new Set(['.glb', '.gltf', '.fbx', '.obj', '.stl', '.usd', '.usda', '.usdc']);
const TEXT_EXT = new Set(['.md', '.txt']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const TEXT_PREVIEW_BYTES = 8 * 1024;
const RECYCLE_DIR = 'recycle';
const RECYCLE_ROOT_ID = 'ac-recycle:';
const RECYCLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FOLDER_PREVIEW_MAX = 3;

function toPosixRel(rel) {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function isRelEscape(rel) {
  const parts = toPosixRel(rel).split('/');
  let depth = 0;
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      depth -= 1;
      if (depth < 0) return true;
      continue;
    }
    depth += 1;
  }
  return false;
}

function resolveInsideRoot(root, rel) {
  const absRoot = path.resolve(String(root || ''));
  if (!absRoot) return null;
  if (isRelEscape(rel)) return null;
  const posix = toPosixRel(rel);
  const abs = posix ? path.resolve(absRoot, ...posix.split('/')) : absRoot;
  const relToRoot = path.relative(absRoot, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;
  return abs;
}

function kindFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (MODEL_EXT.has(ext)) return 'model';
  if (TEXT_EXT.has(ext)) return 'text';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'file';
}

function parentPosix(rel) {
  const posix = toPosixRel(rel);
  const i = posix.lastIndexOf('/');
  return i < 0 ? '' : posix.slice(0, i);
}

function basePosix(rel) {
  const posix = toPosixRel(rel);
  const i = posix.lastIndexOf('/');
  return i < 0 ? posix : posix.slice(i + 1);
}

function assetKindFromEntryKind(kind) {
  if (kind === 'model') return 'model3d';
  if (kind === 'image') return 'image';
  if (kind === 'text') return 'text';
  if (kind === 'video') return 'video';
  return 'file';
}

function mimeFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.exr') return 'image/x-exr';
  if (ext === '.hdr') return 'image/vnd.radiance';
  if (ext === '.psd') return 'image/vnd.adobe.photoshop';
  if (ext === '.md' || ext === '.txt') return 'text/plain';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.glb') return 'model/gltf-binary';
  return 'application/octet-stream';
}

function thumbCacheId(root, rel, size, mtimeMs, edge) {
  return createHash('sha256')
    .update(`${path.resolve(String(root || ''))}\n${toPosixRel(rel)}\n${size}\n${mtimeMs}\n${edge}`)
    .digest('hex')
    .slice(0, 24);
}

function isRecycleRootId(root) {
  return String(root || '').trim() === RECYCLE_ROOT_ID;
}

function skipDirentName(name) {
  const n = String(name || '');
  if (!n || n === '.' || n === '..') return true;
  if (n.startsWith('.')) return true;
  if (n === '_batch.json' || n.endsWith('.ac-meta.json')) return true;
  return false;
}

function compareEntries(a, b) {
  if (a.kind === 'dir' && b.kind !== 'dir') return -1;
  if (a.kind !== 'dir' && b.kind === 'dir') return 1;
  return String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
}

function newWorkshopId() {
  return createHash('sha256')
    .update(`${Date.now()}-${Math.random()}-${process.hrtime.bigint()}`)
    .digest('hex')
    .slice(0, 8);
}

function parseAcAssetDoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const filesIn = raw.files && typeof raw.files === 'object' ? raw.files : {};
  const files = {};
  for (const fid of Object.keys(filesIn)) {
    const rec = filesIn[fid];
    if (!fid || !rec || typeof rec !== 'object') continue;
    const name = String(rec.name || '').trim();
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue;
    const role = rec.role === 'result' ? 'result' : 'original';
    const step = String(rec.step || '').trim();
    files[fid] = step ? { name, role, step } : { name, role };
  }
  if (!Object.keys(files).length) return null;
  const displayFileId = String(raw.displayFileId || '').trim() || Object.keys(files)[0];
  if (!files[displayFileId]) return null;
  const resultOrder = Array.isArray(raw.resultOrder)
    ? raw.resultOrder.map((x) => String(x || '').trim()).filter((x) => files[x])
    : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const checkoutRel = toPosixRel(raw.checkoutRel);
  const checkoutName = String(raw.checkoutName || '').trim();
  const faceFileId = String(raw.faceFileId || '').trim();
  const checkoutFileId = String(raw.checkoutFileId || '').trim();
  return {
    v: Number(raw.v) > 0 ? Math.floor(Number(raw.v)) : 1,
    id,
    title: String(raw.title || id),
    displayFileId,
    files,
    resultOrder,
    tags,
    ...(checkoutRel ? { checkoutRel } : {}),
    ...(checkoutName && !checkoutName.includes('/') && !checkoutName.includes('\\') ? { checkoutName } : {}),
    ...(faceFileId && files[faceFileId] ? { faceFileId } : {}),
    ...(checkoutFileId && files[checkoutFileId] ? { checkoutFileId } : {}),
  };
}

function isPathInside(parent, child) {
  const p = path.resolve(String(parent || ''));
  const c = path.resolve(String(child || ''));
  if (!p || !c) return false;
  const rel = path.relative(p, c);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function slugCheckoutBase(title, fallback) {
  const raw = String(title || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return raw || fallback || 'generated';
}

function workspaceIndexPath(dir) {
  return path.join(path.resolve(String(dir || '')), 'index.json');
}

function workspacePackageAbs(dir, assetId) {
  const id = String(assetId || '').trim();
  if (!id) return null;
  return path.join(path.resolve(String(dir || '')), 'packages', id);
}

async function readWorkspaceIndex(dir) {
  try {
    const raw = JSON.parse(await fsp.readFile(workspaceIndexPath(dir), 'utf8'));
    const entries = Array.isArray(raw && raw.entries) ? raw.entries : [];
    return {
      v: 1,
      entries: entries
        .map((row) => ({
          root: path.resolve(String(row && row.root ? row.root : '')),
          checkoutRel: toPosixRel(row && row.checkoutRel),
          assetId: String(row && row.assetId ? row.assetId : '').trim(),
        }))
        .filter((row) => row.root && row.checkoutRel && row.assetId),
    };
  } catch {
    return { v: 1, entries: [] };
  }
}

async function writeWorkspaceIndex(dir, index) {
  const abs = path.resolve(String(dir || ''));
  await fsp.mkdir(abs, { recursive: true });
  await fsp.writeFile(workspaceIndexPath(abs), `${JSON.stringify({ v: 1, entries: (index && index.entries) || [] }, null, 2)}\n`, 'utf8');
}

async function writeFileReplace(abs, buf) {
  const dir = path.dirname(abs);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.ac-tmp-${path.basename(abs)}-${Date.now()}`);
  await fsp.writeFile(tmp, buf);
  try {
    await fsp.copyFile(tmp, abs);
  } finally {
    try {
      await fsp.unlink(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function pathExists(abs) {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function purgeRecycleDir(recycleAbs) {
  const abs = path.resolve(String(recycleAbs || ''));
  if (!abs) return;
  let names;
  try {
    names = await fsp.readdir(abs);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const batchAbs = path.join(abs, name);
    let deletedAt = 0;
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(batchAbs, '_batch.json'), 'utf8'));
      deletedAt = Number(meta.deletedAt) || 0;
    } catch {
      try {
        deletedAt = (await fsp.stat(batchAbs)).mtimeMs || 0;
      } catch {
        continue;
      }
    }
    if (deletedAt > 0 && now - deletedAt > RECYCLE_MAX_AGE_MS) {
      try {
        await fsp.rm(batchAbs, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

async function readManifestAt(absDir) {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(absDir, AC_ASSET_MANIFEST), 'utf8'));
    return parseAcAssetDoc(raw);
  } catch {
    return null;
  }
}

function uniqueRoots(values) {
  const out = [];
  for (const value of values || []) {
    const t = String(value || '').trim();
    if (!t) continue;
    const n = path.resolve(t);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function workspaceLibraryPath(dir) {
  return path.join(path.resolve(String(dir || '')), WORKSHOP_LIBRARY_FILE);
}

function emptyWorkshopLibrary(dir) {
  const abs = String(dir || '').trim() ? path.resolve(String(dir)) : '';
  return {
    v: 1,
    name: abs ? path.basename(abs) || 'library' : 'library',
    roots: [],
    open: { root: '', rel: '' },
  };
}

function parseWorkshopLibrary(raw, dir) {
  const base = emptyWorkshopLibrary(dir);
  if (!raw || typeof raw !== 'object') return base;
  const seen = new Set();
  const roots = [];
  for (const row of Array.isArray(raw.roots) ? raw.roots : []) {
    const p = path.resolve(String((row && (row.path || row.root)) || ''));
    if (!p || seen.has(p)) continue;
    seen.add(p);
    roots.push({
      path: p,
      label: String((row && row.label) || path.basename(p) || p),
      addedAt: Number(row && row.addedAt) > 0 ? Math.floor(Number(row.addedAt)) : 0,
    });
  }
  const openIn = raw.open && typeof raw.open === 'object' ? raw.open : {};
  const openRoot = String(openIn.root || '').trim() ? path.resolve(String(openIn.root)) : '';
  return {
    v: 1,
    name: String(raw.name || base.name).trim() || base.name,
    roots,
    open: { root: openRoot, rel: toPosixRel(openIn.rel) },
  };
}

function readWorkshopLibrarySync(dir) {
  if (!dir) return emptyWorkshopLibrary('');
  try {
    return parseWorkshopLibrary(JSON.parse(fs.readFileSync(workspaceLibraryPath(dir), 'utf8')), dir);
  } catch {
    return emptyWorkshopLibrary(dir);
  }
}

function writeWorkshopLibrarySync(dir, lib) {
  const abs = path.resolve(String(dir || ''));
  fs.mkdirSync(abs, { recursive: true });
  fs.mkdirSync(path.join(abs, WORKSHOP_LINKS_DIR), { recursive: true });
  fs.mkdirSync(path.join(abs, RECYCLE_DIR), { recursive: true });
  const parsed = parseWorkshopLibrary(lib, abs);
  fs.writeFileSync(
    workspaceLibraryPath(abs),
    `${JSON.stringify({ v: 1, name: parsed.name, roots: parsed.roots, open: parsed.open }, null, 2)}\n`,
    'utf8',
  );
  const readme = path.join(abs, WORKSHOP_LIBRARY_README);
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, WORKSHOP_LIBRARY_README_TEXT, 'utf8');
  return parsed;
}

function ensureWorkshopLibraryScaffold(dir) {
  const abs = String(dir || '').trim() ? path.resolve(String(dir)) : '';
  if (!abs) return emptyWorkshopLibrary('');
  try {
    fs.mkdirSync(abs, { recursive: true });
    fs.mkdirSync(path.join(abs, WORKSHOP_LINKS_DIR), { recursive: true });
    fs.mkdirSync(path.join(abs, RECYCLE_DIR), { recursive: true });
    if (!fs.existsSync(workspaceLibraryPath(abs))) writeWorkshopLibrarySync(abs, emptyWorkshopLibrary(abs));
    else {
      const readme = path.join(abs, WORKSHOP_LIBRARY_README);
      if (!fs.existsSync(readme)) fs.writeFileSync(readme, WORKSHOP_LIBRARY_README_TEXT, 'utf8');
    }
  } catch {
    /* ignore */
  }
  return readWorkshopLibrarySync(abs);
}

function parseWorkshopLinkDoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const kind = String(raw.kind || '').trim();
  const href = String(raw.href || '').trim();
  if (!id || !href) return null;
  if (kind !== 'bookmark' && kind !== 'url' && kind !== 'path') return null;
  return {
    v: Number(raw.v) > 0 ? Math.floor(Number(raw.v)) : 1,
    id,
    kind,
    title: String(raw.title || id).trim() || id,
    href,
    addedAt: Number(raw.addedAt) > 0 ? Math.floor(Number(raw.addedAt)) : 0,
  };
}

async function collectFolderPreviewRels(root, folderRel, maxN) {
  const cap = Math.max(0, Number(maxN) || 0);
  if (!cap) return [];
  const abs = resolveInsideRoot(root, folderRel);
  if (!abs) return [];
  let names;
  try {
    names = await fsp.readdir(abs);
  } catch {
    return [];
  }
  const parent = toPosixRel(folderRel);
  const out = [];
  for (const name of names) {
    if (skipDirentName(name)) continue;
    if (kindFromName(name) !== 'image') continue;
    if (SPECIAL_RASTER_EXT.has(path.extname(name).toLowerCase())) continue;
    const childAbs = path.join(abs, name);
    try {
      const st = await fsp.lstat(childAbs);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    out.push(parent ? `${parent}/${name}` : name);
    if (out.length >= cap) break;
  }
  return out;
}

async function listCanvas(root, rel) {
  const first = await listDir(root, rel);
  if (!first.ok) return first;
  const items = [];
  let truncated = Boolean(first.truncated);
  const parent = toPosixRel(rel);
  for (const entry of first.entries || []) {
    if (items.length >= MAX_LIST) {
      truncated = true;
      break;
    }
    if (entry.kind === 'dir') {
      if (entry.isPackage) {
        const abs = resolveInsideRoot(root, entry.rel);
        const doc = abs ? await readManifestAt(abs) : null;
        if (!doc) continue;
        const rec = doc.files[doc.displayFileId];
        const displayRel = rec ? `${entry.rel}/${rec.name}` : entry.rel;
        const kind = rec ? kindFromName(rec.name) : 'file';
        items.push({
          kind: 'package',
          root,
          name: doc.title || doc.id,
          rel: entry.rel,
          assetKind: assetKindFromEntryKind(kind),
          size: entry.size,
          mtimeMs: entry.mtimeMs,
          assetId: doc.id,
          displayFileId: doc.displayFileId,
          displayRel,
          title: doc.title,
          resultOrder: doc.resultOrder,
          files: doc.files,
        });
        continue;
      }
      items.push({
        kind: 'folder',
        root,
        name: entry.name,
        rel: entry.rel,
        assetKind: 'file',
        size: 0,
        mtimeMs: entry.mtimeMs,
        previewRels: await collectFolderPreviewRels(root, entry.rel, FOLDER_PREVIEW_MAX),
      });
      continue;
    }
    if (entry.name === AC_ASSET_MANIFEST) continue;
    items.push({
      kind: 'loose',
      root,
      name: entry.name,
      rel: entry.rel,
      assetKind: assetKindFromEntryKind(entry.kind),
      size: entry.size,
      mtimeMs: entry.mtimeMs,
    });
  }
  return { ok: true, rel: parent, items, truncated };
}

async function listDir(root, rel) {
  const abs = resolveInsideRoot(root, rel);
  if (!abs) return { ok: false, error: 'path_escape' };
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return { ok: false, error: 'not_found' };
  }
  if (!st.isDirectory()) return { ok: false, error: 'not_dir' };
  let names;
  try {
    names = await fsp.readdir(abs);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const entries = [];
  let truncated = false;
  for (const name of names) {
    if (skipDirentName(name)) continue;
    if (entries.length >= MAX_LIST) {
      truncated = true;
      break;
    }
    const childAbs = path.join(abs, name);
    let childSt;
    try {
      childSt = await fsp.lstat(childAbs);
    } catch {
      continue;
    }
    if (childSt.isSymbolicLink()) {
      let target;
      try {
        target = await fsp.realpath(childAbs);
      } catch {
        continue;
      }
      const relToRoot = path.relative(path.resolve(root), target);
      if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) continue;
      try {
        childSt = await fsp.stat(childAbs);
      } catch {
        continue;
      }
    }
    const childRel = toPosixRel(rel) ? `${toPosixRel(rel)}/${name}` : name;
    if (childSt.isDirectory()) {
      const isPackage = Boolean(await readManifestAt(childAbs));
      entries.push({
        name,
        rel: childRel,
        kind: 'dir',
        size: 0,
        mtimeMs: childSt.mtimeMs || 0,
        isPackage,
      });
      continue;
    }
    if (!childSt.isFile()) continue;
    entries.push({
      name,
      rel: childRel,
      kind: kindFromName(name),
      size: childSt.size || 0,
      mtimeMs: childSt.mtimeMs || 0,
    });
  }
  entries.sort(compareEntries);
  return { ok: true, rel: toPosixRel(rel), entries, truncated };
}

function createWorkshopFileTreeHost(deps) {
  const nativeImage = deps.nativeImage || null;
  const pickDirectory =
    typeof deps.pickDirectory === 'function'
      ? deps.pickDirectory
      : async () => ({ canceled: true, filePaths: [] });

  function readLegacyRoots() {
    if (typeof deps.getRoots === 'function') return uniqueRoots(deps.getRoots());
    const one = String(typeof deps.getRoot === 'function' ? deps.getRoot() : '').trim();
    return uniqueRoots(one ? [one] : []);
  }

  function writeLegacyRoots(next) {
    const roots = uniqueRoots(next);
    if (typeof deps.setRoots === 'function') deps.setRoots(roots);
    else if (typeof deps.setRoot === 'function') deps.setRoot(roots[0] || '');
    return roots;
  }

  function migrateLegacyRootsIntoLibrary(dir) {
    const lib = ensureWorkshopLibraryScaffold(dir);
    if (lib.roots.length) return lib;
    const legacy = readLegacyRoots();
    if (!legacy.length) return lib;
    const now = Date.now();
    lib.roots = legacy.map((p) => ({
      path: p,
      label: path.basename(p) || p,
      addedAt: now,
    }));
    writeWorkshopLibrarySync(dir, lib);
    writeLegacyRoots([]);
    return readWorkshopLibrarySync(dir);
  }

  function readRoots() {
    const ws = readWorkspaceDir();
    if (ws) {
      return uniqueRoots(migrateLegacyRootsIntoLibrary(ws).roots.map((row) => row.path));
    }
    return readLegacyRoots();
  }

  function writeRoots(next) {
    const roots = uniqueRoots(next);
    const ws = readWorkspaceDir();
    if (ws) {
      const lib = ensureWorkshopLibraryScaffold(ws);
      const prev = new Map(lib.roots.map((row) => [row.path, row]));
      const now = Date.now();
      lib.roots = roots.map(
        (p) => prev.get(p) || { path: p, label: path.basename(p) || p, addedAt: now },
      );
      if (lib.open.root && !roots.includes(lib.open.root)) lib.open = { root: '', rel: '' };
      writeWorkshopLibrarySync(ws, lib);
      return roots;
    }
    return writeLegacyRoots(roots);
  }

  function readWorkspaceDir() {
    const raw = String(typeof deps.getWorkspaceDir === 'function' ? deps.getWorkspaceDir() : '').trim();
    return raw ? path.resolve(raw) : '';
  }

  function writeWorkspaceDir(next) {
    const dir = String(next || '').trim() ? path.resolve(String(next).trim()) : '';
    if (typeof deps.setWorkspaceDir === 'function') deps.setWorkspaceDir(dir);
    if (dir) migrateLegacyRootsIntoLibrary(dir);
    return dir;
  }

  function cacheDir() {
    const ws = readWorkspaceDir();
    return ws ? path.join(ws, 'thumbs') : '';
  }

  function workspaceAllowedError(dir) {
    const abs = path.resolve(String(dir || ''));
    for (const root of readRoots()) {
      if (isPathInside(root, abs)) return 'workspace_inside_library';
    }
    return '';
  }

  function requireWorkspaceDir() {
    const dir = readWorkspaceDir();
    if (!dir) return { ok: false, error: 'no_workspace' };
    const blocked = workspaceAllowedError(dir);
    if (blocked) return { ok: false, error: blocked };
    return { ok: true, dir };
  }

  async function loadIndex() {
    const req = requireWorkspaceDir();
    if (!req.ok) return req;
    const index = await readWorkspaceIndex(req.dir);
    return { ok: true, dir: req.dir, index };
  }

  async function saveIndex(index) {
    const req = requireWorkspaceDir();
    if (!req.ok) return req;
    await writeWorkspaceIndex(req.dir, index);
    return { ok: true, dir: req.dir };
  }

  function findIndexEntry(index, query) {
    const entries = (index && index.entries) || [];
    const assetId = String(query && query.assetId ? query.assetId : '').trim();
    if (assetId) return entries.find((row) => row.assetId === assetId) || null;
    const root = query && query.root ? path.resolve(String(query.root)) : '';
    const checkoutRel = toPosixRel(query && query.checkoutRel);
    if (!root || !checkoutRel) return null;
    return entries.find((row) => row.root === root && row.checkoutRel === checkoutRel) || null;
  }

  async function readWorkspaceDoc(assetId) {
    const req = requireWorkspaceDir();
    if (!req.ok) return req;
    const absDir = workspacePackageAbs(req.dir, assetId);
    if (!absDir) return { ok: false, error: 'no_asset' };
    const doc = await readManifestAt(absDir);
    if (!doc) return { ok: false, error: 'not_package' };
    return { ok: true, dir: req.dir, absDir, doc };
  }

  function recycleDirAbs() {
    const ws = readWorkspaceDir();
    return ws ? path.join(ws, RECYCLE_DIR) : '';
  }

  function pickActiveRoot(payload) {
    const roots = readRoots();
    const wanted = String(payload && payload.root ? payload.root : '').trim();
    if (isRecycleRootId(wanted)) return '';
    if (wanted) {
      const resolved = path.resolve(wanted);
      if (roots.includes(resolved)) return resolved;
    }
    const ws = readWorkspaceDir();
    if (ws) {
      const openRoot = readWorkshopLibrarySync(ws).open.root;
      if (openRoot && roots.includes(openRoot)) return openRoot;
    }
    return roots[0] || '';
  }

  function remapCanvasRoot(items, rootId) {
    if (!isRecycleRootId(rootId) || !Array.isArray(items)) return items;
    return items.map((item) => ({ ...item, root: rootId }));
  }

  async function listRecycle(payload) {
    const fsRoot = recycleDirAbs();
    if (!fsRoot) return { ok: false, error: 'no_workspace' };
    await fsp.mkdir(fsRoot, { recursive: true });
    void purgeRecycleDir(fsRoot);
    if (payload && payload.assetsOnly) {
      const canvas = await listCanvas(fsRoot, payload.rel);
      if (!canvas.ok) return canvas;
      const items = remapCanvasRoot(await enrichCanvasItems(fsRoot, canvas.items || []), RECYCLE_ROOT_ID);
      return {
        ...canvas,
        items,
        entries: items.map((item) => ({
          name: item.name,
          rel: item.displayRel || item.rel,
          kind:
            item.kind === 'folder'
              ? 'dir'
              : item.assetKind === 'model3d'
                ? 'model'
                : item.assetKind === 'image'
                  ? 'image'
                  : item.assetKind === 'text'
                    ? 'text'
                    : item.assetKind === 'video'
                      ? 'video'
                      : 'file',
          size: item.size,
          mtimeMs: item.mtimeMs,
        })),
      };
    }
    return listDir(fsRoot, payload && payload.rel);
  }

  function state() {
    const ws = readWorkspaceDir();
    if (ws) {
      try {
        fs.mkdirSync(path.join(ws, RECYCLE_DIR), { recursive: true });
      } catch {
        /* ignore */
      }
    }
    const lib = ws ? readWorkshopLibrarySync(ws) : emptyWorkshopLibrary('');
    const roots = readRoots().map((root) => {
      const row = lib.roots.find((item) => item.path === root);
      return { root, label: (row && row.label) || path.basename(root) || root };
    });
    void purgeRecycleDir(recycleDirAbs());
    const openRoot = lib.open.root && roots.some((row) => row.root === lib.open.root) ? lib.open.root : '';
    const first = openRoot ? roots.find((row) => row.root === openRoot) : roots[0];
    return {
      ok: true,
      roots,
      root: first ? first.root : '',
      label: first ? first.label : '',
      workspaceDir: ws,
      openRoot,
      openRel: openRoot ? lib.open.rel : '',
    };
  }

  function setLibraryOpen(payload) {
    const ws = readWorkspaceDir();
    if (!ws) return { ok: false, error: 'no_workspace' };
    const rootRaw = String(payload && payload.root ? payload.root : '').trim();
    const rel = toPosixRel(payload && payload.rel);
    const lib = ensureWorkshopLibraryScaffold(ws);
    if (!rootRaw) {
      lib.open = { root: '', rel: '' };
      writeWorkshopLibrarySync(ws, lib);
      return { ok: true, ...state() };
    }
    const root = path.resolve(rootRaw);
    if (!readRoots().includes(root)) return { ok: false, error: 'no_root' };
    lib.open = { root, rel };
    writeWorkshopLibrarySync(ws, lib);
    return { ok: true, ...state() };
  }

  async function pickWorkspaceDir() {
    const picked = await pickDirectory({ title: '指定库目录' });
    if (!picked || picked.canceled || !picked.filePaths || !picked.filePaths[0]) {
      return { ok: false, canceled: true };
    }
    const dir = path.resolve(picked.filePaths[0]);
    let st;
    try {
      st = fs.statSync(dir);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    if (!st.isDirectory()) return { ok: false, error: 'not_dir' };
    const blocked = workspaceAllowedError(dir);
    if (blocked) return { ok: false, error: blocked };
    writeWorkspaceDir(dir);
    migrateLegacyRootsIntoLibrary(dir);
    return { ok: true, dir, ...state() };
  }

  async function pickRoot() {
    if (!readWorkspaceDir()) return { ok: false, error: 'no_workspace' };
    const picked = await pickDirectory({ title: '挂上素材文件夹' });
    if (!picked || picked.canceled || !picked.filePaths || !picked.filePaths[0]) {
      return { ok: false, canceled: true };
    }
    const root = path.resolve(picked.filePaths[0]);
    let st;
    try {
      st = fs.statSync(root);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    if (!st.isDirectory()) return { ok: false, error: 'not_dir' };
    writeRoots([...readRoots(), root]);
    setLibraryOpen({ root, rel: '' });
    return { ok: true, ...state(), root, label: path.basename(root) || root };
  }

  function removeRoot(payload) {
    const target = String(payload && payload.root ? payload.root : '').trim();
    if (!target) return { ok: false, error: 'no_root' };
    writeRoots(readRoots().filter((item) => item !== path.resolve(target)));
    return { ok: true, ...state() };
  }

  async function enrichCanvasItems(root, items) {
    const ws = readWorkspaceDir();
    if (!ws) return items;
    const loaded = await readWorkspaceIndex(ws);
    const out = [];
    for (const item of items || []) {
      if (!item || item.kind !== 'loose') {
        out.push(item);
        continue;
      }
      const hit = loaded.entries.find((row) => row.root === path.resolve(root) && row.checkoutRel === item.rel);
      if (!hit) {
        out.push(item);
        continue;
      }
      const packed = await readWorkspaceDoc(hit.assetId);
      if (!packed.ok) {
        out.push(item);
        continue;
      }
      const doc = packed.doc;
      const originalId = Object.entries(doc.files || {}).find(([, rec]) => rec && rec.role === 'original')?.[0] || '';
      out.push({
        ...item,
        assetId: doc.id,
        displayFileId: doc.displayFileId || doc.faceFileId || originalId,
        faceFileId: doc.faceFileId || originalId || doc.displayFileId,
        checkoutFileId: doc.checkoutFileId || originalId || doc.faceFileId,
        resultOrder: doc.resultOrder,
        files: doc.files,
        title: doc.title || item.name,
      });
    }
    return out;
  }

  async function list(payload) {
    const wanted = String(payload && payload.root ? payload.root : '').trim();
    if (isRecycleRootId(wanted)) return listRecycle(payload);
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    void purgeRecycleDir(recycleDirAbs());
    if (payload && payload.assetsOnly) {
      const canvas = await listCanvas(root, payload.rel);
      if (!canvas.ok) return canvas;
      const items = await enrichCanvasItems(root, canvas.items || []);
      return {
        ...canvas,
        items,
        entries: items.map((item) => ({
          name: item.name,
          rel: item.displayRel || item.rel,
          kind:
            item.kind === 'folder'
              ? 'dir'
              : item.assetKind === 'model3d'
                ? 'model'
                : item.assetKind === 'image'
                  ? 'image'
                  : item.assetKind === 'text'
                    ? 'text'
                    : item.assetKind === 'video'
                      ? 'video'
                      : 'file',
          size: item.size,
          mtimeMs: item.mtimeMs,
        })),
      };
    }
    return listDir(root, payload && payload.rel);
  }

  function resolveRel(payload) {
    const wanted = String(payload && payload.root ? payload.root : '').trim();
    if (isRecycleRootId(wanted)) {
      const fsRoot = recycleDirAbs();
      if (!fsRoot) return { ok: false, error: 'no_workspace' };
      const rel = toPosixRel(payload && payload.rel);
      const abs = resolveInsideRoot(fsRoot, rel);
      if (!abs) return { ok: false, error: 'path_escape' };
      return { ok: true, root: wanted, rel, abs, via: 'rel' };
    }
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const assetId = String(payload && payload.assetId ? payload.assetId : '').trim();
    const fileId = String(payload && payload.fileId ? payload.fileId : '').trim();
    if (assetId) {
      const packageRel = toPosixRel(payload && payload.packageRel) || assetId;
      const absDir = resolveInsideRoot(root, packageRel);
      if (!absDir) return { ok: false, error: 'path_escape' };
      return { ok: true, root, packageRel, assetId, fileId, absDir, via: 'ids' };
    }
    const rel = toPosixRel(payload && payload.rel);
    const abs = resolveInsideRoot(root, rel);
    if (!abs) return { ok: false, error: 'path_escape' };
    return { ok: true, root, rel, abs, via: 'rel' };
  }

  async function resolveFileAbs(payload) {
    const wanted = String(payload && payload.root ? payload.root : '').trim();
    if (isRecycleRootId(wanted)) {
      const hit = resolveRel(payload);
      if (!hit.ok) return hit;
      return { ...hit, fileAbs: hit.abs, fileRel: hit.rel };
    }
    const root = pickActiveRoot(payload);
    const assetId = String(payload && payload.assetId ? payload.assetId : '').trim();
    const fileId = String(payload && payload.fileId ? payload.fileId : '').trim();
    const rel = toPosixRel(payload && payload.rel);
    if (assetId) {
      const packed = await readWorkspaceDoc(assetId);
      if (packed.ok) {
        const fid = fileId || packed.doc.faceFileId || packed.doc.displayFileId;
        const rec = packed.doc.files[fid];
        if (!rec) return { ok: false, error: 'unknown_file' };
        return {
          ok: true,
          root: root || packed.doc.checkoutRel || '',
          assetId,
          fileId: fid,
          fileRel: packed.doc.checkoutRel || rec.name,
          fileAbs: path.join(packed.absDir, rec.name),
          doc: packed.doc,
          via: 'workspace',
        };
      }
    }
    if (root && rel) {
      const loaded = readWorkspaceDir() ? await readWorkspaceIndex(readWorkspaceDir()) : { entries: [] };
      const indexed = findIndexEntry(loaded, { root, checkoutRel: rel });
      if (indexed && fileId) {
        const packed = await readWorkspaceDoc(indexed.assetId);
        if (packed.ok) {
          const rec = packed.doc.files[fileId];
          if (rec) {
            return {
              ok: true,
              root,
              assetId: indexed.assetId,
              fileId,
              fileRel: rel,
              fileAbs: path.join(packed.absDir, rec.name),
              doc: packed.doc,
              via: 'workspace',
            };
          }
        }
      }
    }
    const hit = resolveRel(payload);
    if (!hit.ok) return hit;
    if (hit.via === 'rel') return { ...hit, fileAbs: hit.abs, fileRel: hit.rel };
    const doc = await readManifestAt(hit.absDir);
    if (!doc) return { ok: false, error: 'not_package' };
    const fid = hit.fileId || doc.displayFileId;
    const rec = doc.files[fid];
    if (!rec) return { ok: false, error: 'unknown_file' };
    const fileRel = hit.packageRel ? `${hit.packageRel}/${rec.name}` : rec.name;
    const fileAbs = resolveInsideRoot(hit.root, fileRel);
    if (!fileAbs) return { ok: false, error: 'path_escape' };
    return { ...hit, doc, fileId: fid, fileRel, fileAbs };
  }

  function decodeDataUrl(dataUrl) {
    const s = String(dataUrl || '');
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(s);
    if (!m) return null;
    const mime = String(m[1] || 'application/octet-stream');
    const body = m[3] || '';
    if (m[2]) {
      const buf = Buffer.from(body, 'base64');
      return { mime, buf };
    }
    return { mime, buf: Buffer.from(decodeURIComponent(body), 'utf8') };
  }

  function extForMime(mime, fallback) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return '.png';
    if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
    if (m.includes('webp')) return '.webp';
    if (m.includes('gif')) return '.gif';
    if (m.includes('markdown') || m === 'text/plain' || m.startsWith('text/')) {
      const f = String(fallback || '').toLowerCase();
      if (f && f.startsWith('.')) return f;
      return '.md';
    }
    const f = String(fallback || '').toLowerCase();
    if (f && f.startsWith('.')) return f;
    return '.png';
  }

  async function allocPackageDir(root, parentRel) {
    for (let i = 0; i < 8; i += 1) {
      const id = newWorkshopId();
      const rel = parentRel ? `${parentRel}/${id}` : id;
      const abs = resolveInsideRoot(root, rel);
      if (!abs) continue;
      try {
        await fsp.mkdir(abs);
        return { id, rel, abs };
      } catch {
        /* collide */
      }
    }
    return null;
  }

  async function writeManifest(absDir, doc) {
    await fsp.writeFile(path.join(absDir, AC_ASSET_MANIFEST), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  async function readFile(payload) {
    const hit = await resolveFileAbs(payload);
    if (!hit.ok) return hit;
    let st;
    try {
      st = await fsp.stat(hit.fileAbs);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    if (!st.isFile()) return { ok: false, error: 'not_file' };
    if (st.size > MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
    const buf = await fsp.readFile(hit.fileAbs);
    const mime = mimeFromName(path.basename(hit.fileAbs));
    return {
      ok: true,
      rel: hit.fileRel,
      assetId: hit.assetId || '',
      fileId: hit.fileId || '',
      mime,
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    };
  }

  function allowedMediaRoots() {
    const out = [...readRoots()];
    const ws = readWorkspaceDir();
    if (ws) out.push(ws);
    const rec = recycleDirAbs();
    if (rec) out.push(rec);
    return uniqueRoots(out);
  }

  function isAllowedMediaAbs(abs) {
    const resolved = path.resolve(String(abs || ''));
    if (!resolved) return false;
    for (const root of allowedMediaRoots()) {
      if (isPathInside(root, resolved)) return true;
    }
    return false;
  }

  async function readTextPreview(fileAbs) {
    const fh = await fsp.open(fileAbs, 'r');
    try {
      const buf = Buffer.alloc(TEXT_PREVIEW_BYTES);
      const { bytesRead } = await fh.read(buf, 0, TEXT_PREVIEW_BYTES, 0);
      return buf.slice(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  }

  async function getMedia(payload) {
    const hit = await resolveFileAbs(payload);
    if (!hit.ok) return hit;
    let st;
    try {
      st = await fsp.stat(hit.fileAbs);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    if (!st.isFile()) return { ok: false, error: 'not_file' };
    if (!isAllowedMediaAbs(hit.fileAbs)) return { ok: false, error: 'path_escape' };
    const name = path.basename(hit.fileAbs);
    const kind = kindFromName(name);
    const mime = mimeFromName(name);
    const url = issueWorkshopMediaUrl(hit.fileAbs, { mime, kind });
    if (!url) return { ok: false, error: 'no_url' };
    let textPreview = '';
    if (kind === 'text') {
      try {
        textPreview = await readTextPreview(hit.fileAbs);
      } catch {
        textPreview = '';
      }
    }
    return {
      ok: true,
      kind,
      mime,
      url,
      size: st.size,
      rel: hit.fileRel,
      assetId: hit.assetId || '',
      fileId: hit.fileId || '',
      ...(kind === 'text' ? { textPreview } : {}),
    };
  }

  async function appendWorkspaceResult(assetId, decoded, step) {
    const packed = await readWorkspaceDoc(assetId);
    if (!packed.ok) return packed;
    const fileId = newWorkshopId();
    const ext = extForMime(decoded.mime);
    const name = `${fileId}${ext}`;
    await fsp.mkdir(packed.absDir, { recursive: true });
    await fsp.writeFile(path.join(packed.absDir, name), decoded.buf);
    const doc = packed.doc;
    doc.files[fileId] = step ? { name, role: 'result', step } : { name, role: 'result' };
    doc.resultOrder = [...doc.resultOrder, fileId];
    doc.displayFileId = fileId;
    await writeManifest(packed.absDir, doc);
    return { ok: true, assetId: doc.id, fileId, displayFileId: doc.displayFileId, doc, checkoutRel: doc.checkoutRel };
  }

  async function writeResult(payload) {
    const assetId = String(payload && payload.assetId ? payload.assetId : '').trim();
    if (!assetId) return { ok: false, error: 'no_asset' };
    const decoded = decodeDataUrl(payload && payload.dataUrl);
    if (!decoded || !decoded.buf.length) return { ok: false, error: 'bad_data' };
    if (decoded.buf.length > MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
    const step = String(payload && payload.step ? payload.step : '').trim();
    const wsHit = await appendWorkspaceResult(assetId, decoded, step);
    if (wsHit.ok) return wsHit;
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: wsHit.error || 'no_root' };
    const parentRel = toPosixRel(payload && payload.packageRel) || assetId;
    const absDir = resolveInsideRoot(root, parentRel);
    if (!absDir) return { ok: false, error: 'path_escape' };
    const doc = await readManifestAt(absDir);
    if (!doc) return { ok: false, error: 'not_package' };
    const fileId = newWorkshopId();
    const ext = extForMime(decoded.mime);
    const name = `${fileId}${ext}`;
    await fsp.writeFile(path.join(absDir, name), decoded.buf);
    doc.files[fileId] = step ? { name, role: 'result', step } : { name, role: 'result' };
    doc.resultOrder = [...doc.resultOrder, fileId];
    doc.displayFileId = fileId;
    await writeManifest(absDir, doc);
    return {
      ok: true,
      assetId: doc.id,
      fileId,
      displayFileId: fileId,
      rel: `${parentRel}/${name}`,
      doc,
    };
  }

  /** 1×1 透明 PNG，文生图占位原图（勿用红色 1×1，放大后会像纯色块） */
  const PLACEHOLDER_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );

  async function allocCheckoutRel(root, parentRel, title, ext) {
    const base = slugCheckoutBase(title, 'generated');
    const suffix = String(ext || '.png');
    for (let i = 0; i < 32; i += 1) {
      const name = i === 0 ? `${base}${suffix}` : `${base}-${i + 1}${suffix}`;
      const rel = parentRel ? `${parentRel}/${name}` : name;
      const abs = resolveInsideRoot(root, rel);
      if (!abs) continue;
      try {
        await fsp.access(abs);
      } catch {
        return { rel, abs, name };
      }
    }
    return null;
  }

  async function upsertIndexEntry(root, checkoutRel, assetId) {
    const loaded = await loadIndex();
    if (!loaded.ok) return loaded;
    const next = {
      v: 1,
      entries: loaded.index.entries.filter(
        (row) => !(row.root === path.resolve(root) && row.checkoutRel === checkoutRel) && row.assetId !== assetId,
      ),
    };
    next.entries.push({ root: path.resolve(root), checkoutRel, assetId });
    return saveIndex(next);
  }

  async function createPackage(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const ws = requireWorkspaceDir();
    if (!ws.ok) return ws;
    const parentRel = toPosixRel(payload && payload.parentRel);
    const titleRaw = String(payload && payload.title ? payload.title : '').trim();
    const title = titleRaw ? titleRaw.slice(0, 200) : '生成中';
    const originalDataUrl = payload && payload.originalDataUrl;
    let originalBuf = PLACEHOLDER_PNG;
    let originalExt = '.png';
    if (originalDataUrl) {
      const decoded = decodeDataUrl(originalDataUrl);
      if (!decoded || !decoded.buf.length) return { ok: false, error: 'bad_data' };
      originalBuf = decoded.buf;
      originalExt = extForMime(decoded.mime, '.png');
    }
    const checkout = await allocCheckoutRel(root, parentRel, title, originalExt);
    if (!checkout) return { ok: false, error: 'alloc_failed' };
    const assetId = newWorkshopId();
    const originalId = newWorkshopId();
    const absDir = workspacePackageAbs(ws.dir, assetId);
    const originalName = `${originalId}${originalExt}`;
    try {
      await fsp.mkdir(absDir, { recursive: true });
      await fsp.writeFile(path.join(absDir, originalName), originalBuf);
      await writeFileReplace(checkout.abs, originalBuf);
      const doc = {
        v: 1,
        id: assetId,
        title,
        displayFileId: originalId,
        faceFileId: originalId,
        checkoutFileId: originalId,
        checkoutRel: checkout.rel,
        checkoutName: checkout.name,
        files: { [originalId]: { name: originalName, role: 'original' } },
        resultOrder: [],
        tags: Array.isArray(payload && payload.tags) ? payload.tags : [],
      };
      await writeManifest(absDir, doc);
      const indexed = await upsertIndexEntry(root, checkout.rel, assetId);
      if (!indexed.ok) return indexed;
    } catch (e) {
      try {
        await fsp.rm(absDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return {
      ok: true,
      assetId,
      checkoutRel: checkout.rel,
      fileId: originalId,
      displayFileId: originalId,
      faceFileId: originalId,
      checkoutFileId: originalId,
    };
  }

  async function bindLooseOriginal(root, srcRel, srcAbs) {
    const loaded = await loadIndex();
    if (!loaded.ok) return loaded;
    const existing = findIndexEntry(loaded.index, { root, checkoutRel: srcRel });
    if (existing) return readWorkspaceDoc(existing.assetId);
    const assetId = newWorkshopId();
    const originalId = newWorkshopId();
    const srcExt = path.extname(srcAbs) || '.png';
    const originalName = `${originalId}${srcExt}`;
    const absDir = workspacePackageAbs(loaded.dir, assetId);
    await fsp.mkdir(absDir, { recursive: true });
    await fsp.copyFile(srcAbs, path.join(absDir, originalName));
    const doc = {
      v: 1,
      id: assetId,
      title: path.basename(srcAbs),
      displayFileId: originalId,
      faceFileId: originalId,
      checkoutFileId: originalId,
      checkoutRel: srcRel,
      checkoutName: path.basename(srcAbs),
      files: { [originalId]: { name: originalName, role: 'original' } },
      resultOrder: [],
      tags: [],
    };
    await writeManifest(absDir, doc);
    const indexed = await upsertIndexEntry(root, srcRel, assetId);
    if (!indexed.ok) return indexed;
    return { ok: true, dir: loaded.dir, absDir, doc };
  }

  async function upgradeLoose(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const ws = requireWorkspaceDir();
    if (!ws.ok) return ws;
    const srcRel = toPosixRel(payload && payload.rel);
    const srcAbs = resolveInsideRoot(root, srcRel);
    if (!srcAbs) return { ok: false, error: 'path_escape' };
    let st;
    try {
      st = await fsp.stat(srcAbs);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    if (!st.isFile()) return { ok: false, error: 'not_file' };
    const rawDataUrl = payload && payload.dataUrl;
    const decoded = decodeDataUrl(rawDataUrl);
    if (!decoded || !decoded.buf.length) return { ok: false, error: 'bad_data' };
    if (decoded.buf.length > MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
    const bound = await bindLooseOriginal(root, srcRel, srcAbs);
    if (!bound.ok) return bound;
    const step = String(payload && payload.step ? payload.step : '').trim();
    const written = await appendWorkspaceResult(bound.doc.id, decoded, step);
    if (!written.ok) return written;
    return {
      ok: true,
      assetId: written.assetId,
      fileId: written.fileId,
      displayFileId: bound.doc.faceFileId || bound.doc.displayFileId,
      faceFileId: bound.doc.faceFileId || bound.doc.displayFileId,
      checkoutFileId: bound.doc.checkoutFileId || bound.doc.displayFileId,
      rel: srcRel,
      checkoutRel: srcRel,
    };
  }

  async function tryBindLoose(root, rel, abs) {
    if (!readWorkspaceDir()) return { ok: false, error: 'no_workspace' };
    try {
      return await bindLooseOriginal(root, rel, abs);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function allocUniqueRel(root, parentRel, name, startAt) {
    const ext = path.extname(String(name || ''));
    const stem = path.basename(String(name || ''), ext) || 'file';
    const start = Number(startAt) > 0 ? Math.floor(Number(startAt)) : 0;
    for (let i = start; i < start + 64; i += 1) {
      const nextName = i === 0 ? `${stem}${ext}` : `${stem} (${i})${ext}`;
      const rel = parentRel ? `${parentRel}/${nextName}` : nextName;
      const abs = resolveInsideRoot(root, rel);
      if (!abs) continue;
      if (!(await pathExists(abs))) return { rel, abs, name: nextName };
    }
    return null;
  }

  async function updateDocCheckoutRel(assetId, checkoutRel) {
    const packed = await readWorkspaceDoc(assetId);
    if (!packed.ok) return packed;
    packed.doc.checkoutRel = checkoutRel;
    packed.doc.checkoutName = basePosix(checkoutRel);
    await writeManifest(packed.absDir, packed.doc);
    return { ok: true };
  }

  async function remapIndexRels(root, fromRel, toRel) {
    const loaded = await loadIndex();
    if (!loaded.ok) return loaded;
    const resolved = path.resolve(root);
    const from = toPosixRel(fromRel);
    const to = toPosixRel(toRel);
    if (!from || !to || from === to) return { ok: true };
    let changed = false;
    const entries = loaded.index.entries.map((row) => {
      if (row.root !== resolved) return row;
      let nextRel = '';
      if (row.checkoutRel === from) nextRel = to;
      else if (row.checkoutRel.startsWith(`${from}/`)) nextRel = `${to}${row.checkoutRel.slice(from.length)}`;
      if (!nextRel) return row;
      changed = true;
      void updateDocCheckoutRel(row.assetId, nextRel);
      return { ...row, checkoutRel: nextRel };
    });
    if (changed) await saveIndex({ v: 1, entries });
    return { ok: true };
  }

  async function removeIndexRels(root, rel) {
    const loaded = await loadIndex();
    if (!loaded.ok) return loaded;
    const resolved = path.resolve(root);
    const from = toPosixRel(rel);
    if (!from) return { ok: true };
    const entries = loaded.index.entries.filter((row) => {
      if (row.root !== resolved) return true;
      return row.checkoutRel !== from && !row.checkoutRel.startsWith(`${from}/`);
    });
    if (entries.length !== loaded.index.entries.length) await saveIndex({ v: 1, entries });
    return { ok: true };
  }

  function normalizeRels(payload) {
    const list = Array.isArray(payload && payload.rels) ? payload.rels : [];
    const single = toPosixRel(payload && payload.rel);
    const out = [];
    for (const raw of [...list, single]) {
      const rel = toPosixRel(raw);
      if (rel && !out.includes(rel)) out.push(rel);
    }
    return out;
  }

  async function relocatePath(srcAbs, destAbs) {
    await fsp.mkdir(path.dirname(destAbs), { recursive: true });
    try {
      await fsp.rename(srcAbs, destAbs);
      return;
    } catch (err) {
      const code = err && err.code;
      if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw err;
    }
    const st = await fsp.stat(srcAbs);
    if (st.isDirectory()) await fsp.cp(srcAbs, destAbs, { recursive: true });
    else await fsp.copyFile(srcAbs, destAbs);
    await fsp.rm(srcAbs, { recursive: true, force: true });
  }

  async function trashEntries(payload) {
    const wanted = String(payload && payload.root ? payload.root : '').trim();
    const rels = normalizeRels(payload);
    if (!rels.length) return { ok: false, error: 'no_rel' };
    if (isRecycleRootId(wanted)) {
      const fsRoot = recycleDirAbs();
      if (!fsRoot) return { ok: false, error: 'no_workspace' };
      const removed = [];
      let lastError = '';
      for (const rel of rels) {
        const srcAbs = resolveInsideRoot(fsRoot, rel);
        if (!srcAbs) continue;
        if (!(await pathExists(srcAbs))) continue;
        try {
          await fsp.rm(srcAbs, { recursive: true, force: true });
          try {
            await fsp.rm(`${srcAbs}.ac-meta.json`, { force: true });
          } catch {
            /* ignore */
          }
          removed.push(rel);
        } catch (err) {
          lastError = err && err.message ? String(err.message) : 'rm_failed';
        }
      }
      if (!removed.length) return { ok: false, error: lastError || 'not_moved' };
      return { ok: true, rels: removed, permanent: true };
    }
    const roots = readRoots();
    const resolved = wanted ? path.resolve(wanted) : '';
    const root = roots.includes(resolved) ? resolved : '';
    if (!root) return { ok: false, error: 'no_root' };
    const recycleAbs = recycleDirAbs();
    if (!recycleAbs) return { ok: false, error: 'no_workspace' };
    void purgeRecycleDir(recycleAbs);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const batchAbs = path.join(recycleAbs, stamp);
    await fsp.mkdir(batchAbs, { recursive: true });
    await fsp.writeFile(
      path.join(batchAbs, '_batch.json'),
      `${JSON.stringify({ v: 1, deletedAt: Date.now(), sourceRoot: root }, null, 2)}\n`,
      'utf8',
    );
    const moved = [];
    let lastError = '';
    for (const rel of rels) {
      const srcAbs = resolveInsideRoot(root, rel);
      if (!srcAbs) continue;
      if (!(await pathExists(srcAbs))) continue;
      const destAbs = path.join(batchAbs, ...rel.split('/'));
      try {
        await relocatePath(srcAbs, destAbs);
        await fsp.writeFile(
          `${destAbs}.ac-meta.json`,
          `${JSON.stringify({ v: 1, originalRel: rel, sourceRoot: root, deletedAt: Date.now() }, null, 2)}\n`,
          'utf8',
        );
        await removeIndexRels(root, rel);
        moved.push(rel);
      } catch (err) {
        lastError = err && err.message ? String(err.message) : 'move_failed';
      }
    }
    if (!moved.length) return { ok: false, error: lastError || 'not_moved' };
    return { ok: true, rels: moved };
  }

  async function createCheckoutFile(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const parentRel = toPosixRel(payload && payload.parentRel);
    const titleRaw = String(payload && payload.title ? payload.title : '').trim();
    const title = titleRaw ? titleRaw.slice(0, 80) : '文本';
    let ext = String(payload && payload.ext ? payload.ext : '').trim().toLowerCase();
    if (ext && !ext.startsWith('.')) ext = `.${ext}`;
    let buf = Buffer.alloc(0);
    const body = payload && payload.body != null ? payload.body : null;
    const dataUrl = payload && payload.dataUrl;
    if (body != null) {
      buf = Buffer.from(String(body), 'utf8');
      if (!ext) ext = '.md';
    } else if (dataUrl) {
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded || !decoded.buf.length) return { ok: false, error: 'bad_data' };
      if (decoded.buf.length > MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
      buf = decoded.buf;
      if (!ext) ext = extForMime(decoded.mime, '.png');
    } else if (!ext) {
      ext = '.md';
    }
    const checkout = await allocCheckoutRel(root, parentRel, title, ext);
    if (!checkout) return { ok: false, error: 'alloc_failed' };
    try {
      await writeFileReplace(checkout.abs, buf);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const bound = await tryBindLoose(root, checkout.rel, checkout.abs);
    return {
      ok: true,
      rel: checkout.rel,
      name: checkout.name,
      assetId: bound && bound.ok && bound.doc ? bound.doc.id : '',
    };
  }

  async function writeCheckoutFile(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const rel = toPosixRel(payload && payload.rel);
    const abs = resolveInsideRoot(root, rel);
    if (!abs || !rel) return { ok: false, error: 'path_escape' };
    let buf = Buffer.alloc(0);
    if (payload && payload.body != null) {
      buf = Buffer.from(String(payload.body), 'utf8');
    } else if (payload && payload.dataUrl) {
      const decoded = decodeDataUrl(payload.dataUrl);
      if (!decoded || !decoded.buf.length) return { ok: false, error: 'bad_data' };
      if (decoded.buf.length > MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
      buf = decoded.buf;
    } else {
      return { ok: false, error: 'no_body' };
    }
    try {
      await writeFileReplace(abs, buf);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true, rel };
  }

  async function importFiles(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const parentRel = toPosixRel(payload && payload.parentRel);
    const destAbs = resolveInsideRoot(root, parentRel);
    if (!destAbs) return { ok: false, error: 'path_escape' };
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    if (!items.length) return { ok: false, error: 'no_items' };
    const imported = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const rawName = String(item.name || '').trim() || 'file';
      const safeName = basePosix(rawName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')) || 'file';
      const absPath = String(item.absPath || '').trim();
      if (absPath) {
        const srcAbs = path.resolve(absPath);
        if (isPathInside(destAbs, srcAbs) && path.dirname(srcAbs) === destAbs) {
          const rel = parentRel ? `${parentRel}/${path.basename(srcAbs)}` : path.basename(srcAbs);
          imported.push({ rel, skipped: true });
          continue;
        }
        let st;
        try {
          st = await fsp.stat(srcAbs);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
        const slot = await allocUniqueRel(root, parentRel, safeName, 0);
        if (!slot) continue;
        await fsp.copyFile(srcAbs, slot.abs);
        await tryBindLoose(root, slot.rel, slot.abs);
        imported.push({ rel: slot.rel });
        continue;
      }
      const decoded = decodeDataUrl(item.dataUrl);
      if (!decoded || !decoded.buf.length || decoded.buf.length > MAX_FILE_BYTES) continue;
      let name = safeName;
      if (!path.extname(name)) name = `${name}${extForMime(decoded.mime, '.png')}`;
      const slot = await allocUniqueRel(root, parentRel, name, 0);
      if (!slot) continue;
      await writeFileReplace(slot.abs, decoded.buf);
      await tryBindLoose(root, slot.rel, slot.abs);
      imported.push({ rel: slot.rel });
    }
    return { ok: true, items: imported };
  }

  async function mkdir(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const parentRel = toPosixRel(payload && payload.parentRel);
    const title = String(payload && payload.name ? payload.name : '').trim() || '组';
    const base = slugCheckoutBase(title, '组');
    for (let i = 0; i < 32; i += 1) {
      const name = i === 0 ? base : `${base}-${i + 1}`;
      const rel = parentRel ? `${parentRel}/${name}` : name;
      const abs = resolveInsideRoot(root, rel);
      if (!abs) continue;
      try {
        await fsp.mkdir(abs);
        return { ok: true, rel, name };
      } catch {
        /* collide */
      }
    }
    return { ok: false, error: 'alloc_failed' };
  }

  async function moveEntries(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const destRel = toPosixRel(payload && payload.destRel);
    const destAbs = resolveInsideRoot(root, destRel);
    if (!destAbs) return { ok: false, error: 'path_escape' };
    let destSt;
    try {
      destSt = await fsp.stat(destAbs);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    if (!destSt.isDirectory()) return { ok: false, error: 'not_dir' };
    const rels = normalizeRels(payload);
    const moved = [];
    for (const rel of rels) {
      if (!rel || rel === destRel) continue;
      if (destRel === rel || destRel.startsWith(`${rel}/`)) continue;
      const srcAbs = resolveInsideRoot(root, rel);
      if (!srcAbs) continue;
      if (!(await pathExists(srcAbs))) continue;
      const slot = await allocUniqueRel(root, destRel, basePosix(rel), 0);
      if (!slot) continue;
      await fsp.rename(srcAbs, slot.abs);
      await remapIndexRels(root, rel, slot.rel);
      moved.push({ from: rel, to: slot.rel });
    }
    return { ok: true, moved };
  }

  async function copyEntries(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const rels = normalizeRels(payload);
    const copied = [];
    for (const rel of rels) {
      const srcAbs = resolveInsideRoot(root, rel);
      if (!srcAbs) continue;
      let st;
      try {
        st = await fsp.stat(srcAbs);
      } catch {
        continue;
      }
      const parentRel = parentPosix(rel);
      const slot = await allocUniqueRel(root, parentRel, basePosix(rel), 1);
      if (!slot) continue;
      if (st.isDirectory()) await fsp.cp(srcAbs, slot.abs, { recursive: true });
      else await fsp.copyFile(srcAbs, slot.abs);
      if (st.isFile()) await tryBindLoose(root, slot.rel, slot.abs);
      copied.push({ from: rel, to: slot.rel });
    }
    return { ok: true, copied };
  }

  async function groupEntries(payload) {
    const created = await mkdir({ ...payload, name: String((payload && payload.name) || '组') });
    if (!created.ok) return created;
    const moved = await moveEntries({ ...payload, destRel: created.rel });
    if (!moved.ok) return moved;
    return { ok: true, destRel: created.rel, moved: moved.moved };
  }

  async function applyCheckout(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const ws = requireWorkspaceDir();
    if (!ws.ok) return ws;
    const assetId = String(payload && payload.assetId ? payload.assetId : '').trim();
    const rel = toPosixRel(payload && payload.rel);
    const loaded = await loadIndex();
    if (!loaded.ok) return loaded;
    const entry = assetId
      ? findIndexEntry(loaded.index, { assetId })
      : findIndexEntry(loaded.index, { root, checkoutRel: rel });
    if (!entry) return { ok: false, error: 'not_package' };
    const packed = await readWorkspaceDoc(entry.assetId);
    if (!packed.ok) return packed;
    const fileId = String(payload && payload.fileId ? payload.fileId : '').trim()
      || packed.doc.faceFileId
      || packed.doc.displayFileId;
    const rec = packed.doc.files[fileId];
    if (!rec) return { ok: false, error: 'unknown_file' };
    const srcAbs = path.join(packed.absDir, rec.name);
    const oldRel = entry.checkoutRel;
    const oldAbs = resolveInsideRoot(entry.root, oldRel);
    if (!oldAbs) return { ok: false, error: 'path_escape' };
    const srcExt = path.extname(rec.name).toLowerCase();
    const oldExt = path.extname(oldRel).toLowerCase();
    let checkoutRel = oldRel;
    let checkoutAbs = oldAbs;
    if (srcExt && srcExt !== oldExt) {
      const parentRel = parentPosix(oldRel);
      const stem = path.basename(basePosix(oldRel), oldExt) || slugCheckoutBase(packed.doc.title, 'applied');
      const slot = await allocUniqueRel(entry.root, parentRel, `${stem}${srcExt}`, 0);
      if (!slot) return { ok: false, error: 'alloc_failed' };
      checkoutRel = slot.rel;
      checkoutAbs = slot.abs;
    }
    try {
      const buf = await fsp.readFile(srcAbs);
      await writeFileReplace(checkoutAbs, buf);
      if (checkoutRel !== oldRel) {
        await trashEntries({ root: entry.root, rels: [oldRel] });
        await upsertIndexEntry(entry.root, checkoutRel, packed.doc.id);
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    packed.doc.checkoutFileId = fileId;
    packed.doc.faceFileId = fileId;
    packed.doc.displayFileId = fileId;
    packed.doc.checkoutRel = checkoutRel;
    packed.doc.checkoutName = basePosix(checkoutRel);
    await writeManifest(packed.absDir, packed.doc);
    return {
      ok: true,
      assetId: packed.doc.id,
      fileId,
      checkoutRel,
      checkoutFileId: fileId,
      faceFileId: fileId,
    };
  }

  async function setFace(payload) {
    const root = pickActiveRoot(payload);
    if (!root) return { ok: false, error: 'no_root' };
    const ws = requireWorkspaceDir();
    if (!ws.ok) return ws;
    const assetId = String(payload && payload.assetId ? payload.assetId : '').trim();
    const rel = toPosixRel(payload && payload.rel);
    const loaded = await loadIndex();
    if (!loaded.ok) return loaded;
    const entry = assetId
      ? findIndexEntry(loaded.index, { assetId })
      : findIndexEntry(loaded.index, { root, checkoutRel: rel });
    if (!entry) return { ok: false, error: 'not_package' };
    const packed = await readWorkspaceDoc(entry.assetId);
    if (!packed.ok) return packed;
    const fileId = String(payload && payload.fileId ? payload.fileId : '').trim();
    if (!fileId || !packed.doc.files[fileId]) return { ok: false, error: 'unknown_file' };
    packed.doc.faceFileId = fileId;
    await writeManifest(packed.absDir, packed.doc);
    return { ok: true, assetId: packed.doc.id, faceFileId: fileId, checkoutFileId: packed.doc.checkoutFileId, checkoutRel: entry.checkoutRel };
  }

  async function encodeThumbJpeg(abs, size) {
    if (!nativeImage) return null;
    try {
      if (typeof nativeImage.createThumbnailFromPath === 'function') {
        const img = await nativeImage.createThumbnailFromPath(abs, { width: THUMB_EDGE, height: THUMB_EDGE });
        if (img && !img.isEmpty()) return img.toJPEG(82);
      }
    } catch {
      /* fall through */
    }
    if (size > MAX_FALLBACK_DECODE_BYTES) return null;
    try {
      const img = nativeImage.createFromPath(abs);
      if (!img || img.isEmpty()) return null;
      const resized = img.resize({ width: THUMB_EDGE, height: THUMB_EDGE, quality: 'better' });
      return resized.toJPEG(82);
    } catch {
      return null;
    }
  }

  async function thumb(payload) {
    const hit = await resolveFileAbs(payload);
    if (!hit.ok) return hit;
    let st;
    try {
      st = await fsp.stat(hit.fileAbs);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    if (!st.isFile()) return { ok: false, error: 'not_file' };
    const kind = kindFromName(path.basename(hit.fileAbs));
    if (kind !== 'image') return { ok: true, kind, status: 'placeholder' };
    if (SPECIAL_RASTER_EXT.has(path.extname(hit.fileAbs).toLowerCase())) {
      return { ok: true, kind, status: 'placeholder' };
    }
    const dir = String(cacheDir() || '').trim();
    if (!dir) return { ok: true, kind, status: 'placeholder' };
    const id = thumbCacheId(hit.root, hit.fileRel, st.size, st.mtimeMs, THUMB_EDGE);
    const cachePath = path.join(dir, `${id}.jpg`);
    try {
      const cached = await fsp.readFile(cachePath);
      if (cached && cached.length) {
        return {
          ok: true,
          kind,
          status: 'ready',
          rel: hit.fileRel,
          dataUrl: `data:image/jpeg;base64,${cached.toString('base64')}`,
        };
      }
    } catch {
      /* miss */
    }
    const jpeg = await encodeThumbJpeg(hit.fileAbs, st.size);
    if (!jpeg || !jpeg.length) return { ok: true, kind, status: 'placeholder' };
    try {
      fs.mkdirSync(dir, { recursive: true });
      await fsp.writeFile(cachePath, jpeg);
    } catch {
      /* still return */
    }
    return {
      ok: true,
      kind,
      status: 'ready',
      rel: hit.fileRel,
      dataUrl: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`,
    };
  }

  async function resolveSendFile(finger) {
    const root = String(finger && finger.selectedRoot ? finger.selectedRoot : '').trim();
    if (!root) return { ok: false, error: 'no_selection' };
    const card = String(finger && finger.selectedAssetId ? finger.selectedAssetId : '').trim();
    const fileId = String(finger && finger.selectedFileId ? finger.selectedFileId : '').trim();
    const rel = toPosixRel(finger && finger.selectedRelPath);
    if (card.startsWith('wspkg:')) {
      const rest = card.slice('wspkg:'.length);
      const slash = rest.indexOf('/');
      let assetId = slash < 0 ? '' : rest.slice(slash + 1);
      try {
        if (slash >= 0) decodeURIComponent(rest.slice(0, slash));
      } catch {
        return { ok: false, error: 'no_selection' };
      }
      if (!assetId) return { ok: false, error: 'no_selection' };
      const packageRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : assetId;
      return resolveFileAbs({ root, assetId, fileId, packageRel });
    }
    if (rel) return resolveFileAbs({ root, rel });
    if (card.startsWith('wsfile:')) {
      const rest = card.slice('wsfile:'.length);
      const slash = rest.indexOf('/');
      const fileRel = slash < 0 ? '' : rest.slice(slash + 1);
      if (!fileRel) return { ok: false, error: 'no_selection' };
      const loaded = readWorkspaceDir() ? await readWorkspaceIndex(readWorkspaceDir()) : { entries: [] };
      const indexed = findIndexEntry(loaded, { root, checkoutRel: fileRel });
      return resolveFileAbs({ root, rel: fileRel, fileId });
    }
    return { ok: false, error: 'no_selection' };
  }

  return {
    state,
    pickRoot,
    removeRoot,
    list,
    thumb,
    readFile,
    getMedia,
    isAllowedMediaAbs,
    writeResult,
    createPackage,
    createCheckoutFile,
    writeCheckoutFile,
    importFiles,
    mkdir,
    moveEntries,
    copyEntries,
    trashEntries,
    groupEntries,
    upgradeLoose,
    applyCheckout,
    setFace,
    pickWorkspaceDir,
    setLibraryOpen,
    resolveFileAbs,
    resolveSendFile,
    THUMB_EDGE,
  };
}

module.exports = {
  createWorkshopFileTreeHost,
  toPosixRel,
  isRelEscape,
  resolveInsideRoot,
  kindFromName,
  mimeFromName,
  assetKindFromEntryKind,
  IMAGE_EXTS: [...IMAGE_EXT].sort(),
  SPECIAL_RASTER_EXTS: [...SPECIAL_RASTER_EXT].sort(),
  MODEL_EXTS: [...MODEL_EXT].sort(),
  TEXT_EXTS: [...TEXT_EXT].sort(),
  VIDEO_EXTS: [...VIDEO_EXT].sort(),
  thumbCacheId,
  listDir,
  listCanvas,
  parseAcAssetDoc,
  uniqueRoots,
  isPathInside,
  slugCheckoutBase,
  parseWorkshopLibrary,
  parseWorkshopLinkDoc,
  THUMB_EDGE,
  AC_ASSET_MANIFEST,
  WORKSHOP_LIBRARY_FILE,
  WORKSHOP_LIBRARY_README,
  WORKSHOP_LINKS_DIR,
  RECYCLE_DIR,
  RECYCLE_ROOT_ID,
  isRecycleRootId,
};
