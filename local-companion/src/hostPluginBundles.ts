import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, closeSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import yauzl from 'yauzl';
import { readHostBundleRunSpecSync, type HostBundleRunSpecV1 } from './hostBundleRunSpec.js';
import { ensureRepositoryRoot } from './repositoryVolume.js';

export type HostBundleManifest = {
  kind: 'host_plugin_bundle';
  semver: string;
  label: string;
  sha256: string;
  bytes: number;
  sourceUrlHost: string;
  installedAt: string;
  /** bundle.bin 检测为 ZIP 并已解压到 extractedRelativeDir */
  bundleFormat?: 'zip' | 'bin';
  /** 相对本包目录，如 extracted */
  extractedRelativeDir?: string;
};

export type HostBundlePluginSummary = {
  dirName: string;
  semver: string;
  label: string;
  bundleFormat?: 'zip' | 'bin';
  extractedRelativeDir?: string;
  /** extracted/run.json 解析结果，缺失或非法时为 null */
  runSpec: HostBundleRunSpecV1 | null;
};

function getBundlesRoot(): string {
  return join(ensureRepositoryRoot(), 'host-bundles');
}

function safeSemverDir(semver: string): string {
  const s = semver.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
  if (!s) throw new Error('semver 无效');
  return s;
}

/** 禁止 SSRF：仅 https，且主机名在 R2 常见域或显式白名单内 */
export function assertHostBundleFetchUrlAllowed(urlStr: string): URL {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('url 非法');
  }
  if (u.protocol !== 'https:') throw new Error('仅允许 https URL');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') throw new Error('禁止本机回环地址');
  if (h.endsWith('.r2.cloudflarestorage.com')) return u;
  if (h.endsWith('.r2.dev')) return u;
  const raw = process.env.COMPANION_HOST_BUNDLE_TRUST_HOSTS?.trim();
  if (raw) {
    const allow = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allow.some((a) => a === h || (a.startsWith('*.') && h.endsWith(a.slice(1))))) return u;
  }
  throw new Error(
    'URL 主机未在白名单：须为 *.r2.cloudflarestorage.com / *.r2.dev，或在环境变量 COMPANION_HOST_BUNDLE_TRUST_HOSTS 中追加（逗号分隔）',
  );
}

/** PK\x03\x04 / 空归档等常见 ZIP 头 */
export function isLikelyZipFile(filePath: string): boolean {
  const fd = openSync(filePath, 'r');
  try {
    const b = Buffer.alloc(4);
    readSync(fd, b, 0, 4, 0);
    return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 1 || b[2] === 7);
  } finally {
    closeSync(fd);
  }
}

function safeJoinNoZipSlip(outDir: string, entryName: string): string {
  const root = resolve(outDir);
  const norm = String(entryName).replace(/\\/g, '/').replace(/^\uFEFF/, '');
  if (norm.includes('\0')) throw new Error('zip 条目含非法字符');
  const segments = norm.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) throw new Error('zip_slip');
  let acc = root;
  for (const seg of segments) {
    acc = join(acc, seg);
  }
  const resolved = resolve(acc);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error('zip_slip');
  }
  return resolved;
}

async function extractZipToDirectory(zipPath: string, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, strictFileNames: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }
      if (!zipfile) {
        reject(new Error('无法打开 zip'));
        return;
      }
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          try {
            const d = safeJoinNoZipSlip(outDir, entry.fileName);
            mkdirSync(d, { recursive: true });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
            return;
          }
          zipfile.readEntry();
          return;
        }
        let dest: string;
        try {
          dest = safeJoinNoZipSlip(outDir, entry.fileName);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        mkdirSync(dirname(dest), { recursive: true });
        zipfile.openReadStream(entry, (e2, readStream) => {
          if (e2 || !readStream) {
            reject(e2 || new Error('无法读取 zip 流'));
            return;
          }
          const ws = createWriteStream(dest);
          readStream.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', () => {
            zipfile.readEntry();
          });
          readStream.pipe(ws);
        });
      });
      zipfile.on('end', () => resolve());
      zipfile.on('error', reject);
    });
  });
}

function maxBundleBytes(): number {
  const raw = process.env.COMPANION_HOST_BUNDLE_MAX_BYTES?.trim();
  if (!raw) return 512 * 1024 * 1024;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 512 * 1024 * 1024;
  return Math.min(n, 1024 * 1024 * 1024);
}

export async function installHostPluginBundleFromUrl(input: {
  url: string;
  semver: string;
  sha256Expected: string;
  bytesExpected: number;
  label?: string;
}): Promise<{ manifest: HostBundleManifest; bundlePath: string; runSpec: HostBundleRunSpecV1 | null }> {
  const u = assertHostBundleFetchUrlAllowed(input.url);
  const semverDir = safeSemverDir(input.semver);
  const sha256Expected = String(input.sha256Expected || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256Expected)) throw new Error('sha256 须为 64 位十六进制');
  const bytesExpected = Math.floor(Number(input.bytesExpected));
  if (!Number.isFinite(bytesExpected) || bytesExpected < 1) throw new Error('bytesExpected 无效');

  const cap = maxBundleBytes();
  if (bytesExpected > cap) throw new Error(`包体积超过上限 ${cap} 字节`);

  const root = getBundlesRoot();
  await mkdir(root, { recursive: true });
  const destDir = join(root, semverDir);
  await mkdir(destDir, { recursive: true });
  const tmpPath = join(destDir, `.download-${Date.now()}.part`);
  const finalName = 'bundle.bin';
  const finalPath = join(destDir, finalName);

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 3_600_000);
  let res: Response;
  try {
    res = await fetch(input.url, { redirect: 'follow', signal: ac.signal });
  } finally {
    clearTimeout(to);
  }
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > 0 && len !== bytesExpected) {
    throw new Error(`Content-Length ${len} 与登记字节 ${bytesExpected} 不一致`);
  }
  if (!res.body) throw new Error('响应无 body');

  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  const ws = createWriteStream(tmpPath);
  const hash = createHash('sha256');
  let total = 0;
  for await (const chunk of nodeStream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > cap) {
      await rm(tmpPath, { force: true });
      throw new Error('下载超过体积上限');
    }
    hash.update(buf);
    if (!ws.write(buf)) {
      await new Promise<void>((resolve, reject) => {
        ws.once('drain', resolve);
        ws.once('error', reject);
      });
    }
  }
  ws.end();
  await finished(ws);
  if (total !== bytesExpected) {
    await rm(tmpPath, { force: true });
    throw new Error(`实际下载 ${total} 字节与登记 ${bytesExpected} 不一致`);
  }
  const digest = hash.digest('hex');
  if (digest !== sha256Expected) {
    await rm(tmpPath, { force: true });
    throw new Error('SHA256 校验失败');
  }
  await rm(finalPath, { force: true });
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, finalPath);

  let bundleFormat: 'zip' | 'bin' = 'bin';
  let extractedRelativeDir: string | undefined;
  if (isLikelyZipFile(finalPath)) {
    const extractedRoot = join(destDir, 'extracted');
    await rm(extractedRoot, { recursive: true, force: true });
    try {
      await extractZipToDirectory(finalPath, extractedRoot);
      bundleFormat = 'zip';
      extractedRelativeDir = 'extracted';
    } catch (e) {
      await rm(extractedRoot, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `ZIP 解压失败（文件头似 ZIP）：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const manifest: HostBundleManifest = {
    kind: 'host_plugin_bundle',
    semver: input.semver.trim(),
    label: String(input.label || '').trim(),
    sha256: sha256Expected,
    bytes: bytesExpected,
    sourceUrlHost: u.hostname,
    installedAt: new Date().toISOString(),
    bundleFormat,
    extractedRelativeDir,
  };
  await writeFile(join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, bundlePath: finalPath, runSpec: readHostBundleRunSpecSync(destDir) };
}

export function countHostPluginBundlesSync(): number {
  try {
    const root = getBundlesRoot();
    if (!existsSync(root)) return 0;
    let n = 0;
    for (const name of readdirSync(root)) {
      if (name.startsWith('.')) continue;
      if (existsSync(join(root, name, 'manifest.json'))) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

export async function listInstalledHostPluginBundles(): Promise<
  (HostBundleManifest & { dirName: string; bundlePath: string; runSpec: HostBundleRunSpecV1 | null })[]
> {
  const root = getBundlesRoot();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out: (HostBundleManifest & { dirName: string; bundlePath: string; runSpec: HostBundleRunSpecV1 | null })[] =
    [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const text = await readFile(join(root, name, 'manifest.json'), 'utf8');
      const parsed = JSON.parse(text) as HostBundleManifest;
      if (parsed?.kind !== 'host_plugin_bundle' || !parsed.semver) continue;
      const bundleRoot = join(root, name);
      out.push({
        ...parsed,
        dirName: name,
        bundlePath: join(bundleRoot, 'bundle.bin'),
        runSpec: readHostBundleRunSpecSync(bundleRoot),
      });
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)));
  return out;
}

/** 供 capabilities 同步列举（无异步 IO 之外的副作用） */
export function listHostBundlePluginSummariesSync(): HostBundlePluginSummary[] {
  const root = getBundlesRoot();
  if (!existsSync(root)) return [];
  const out: HostBundlePluginSummary[] = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith('.')) continue;
    const mf = join(root, name, 'manifest.json');
    if (!existsSync(mf)) continue;
    try {
      const parsed = JSON.parse(readFileSync(mf, 'utf8')) as HostBundleManifest;
      if (parsed?.kind !== 'host_plugin_bundle' || !parsed.semver) continue;
      const bundleRoot = join(root, name);
      out.push({
        dirName: name,
        semver: parsed.semver,
        label: parsed.label || '',
        bundleFormat: parsed.bundleFormat,
        extractedRelativeDir: parsed.extractedRelativeDir,
        runSpec: readHostBundleRunSpecSync(bundleRoot),
      });
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => a.semver.localeCompare(b.semver));
  return out;
}
