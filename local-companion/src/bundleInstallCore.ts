import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { mkdir, rm, rename } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import yauzl from 'yauzl';

/** 禁止 SSRF：仅 https，且主机名在 R2 常见域或显式白名单内 */
export function assertBundleFetchUrlAllowed(urlStr: string): URL {
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

/** @deprecated 使用 assertBundleFetchUrlAllowed */
export const assertHostBundleFetchUrlAllowed = assertBundleFetchUrlAllowed;

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

export function safeJoinNoZipSlip(outDir: string, entryName: string): string {
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

export async function extractZipToDirectory(zipPath: string, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  return new Promise((resolveP, rejectP) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, strictFileNames: true }, (err, zipfile) => {
      if (err) {
        rejectP(err);
        return;
      }
      if (!zipfile) {
        rejectP(new Error('无法打开 zip'));
        return;
      }
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          try {
            const d = safeJoinNoZipSlip(outDir, entry.fileName);
            mkdirSync(d, { recursive: true });
          } catch (e) {
            rejectP(e instanceof Error ? e : new Error(String(e)));
            return;
          }
          zipfile.readEntry();
          return;
        }
        let dest: string;
        try {
          dest = safeJoinNoZipSlip(outDir, entry.fileName);
        } catch (e) {
          rejectP(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        mkdirSync(dirname(dest), { recursive: true });
        zipfile.openReadStream(entry, (e2, readStream) => {
          if (e2 || !readStream) {
            rejectP(e2 || new Error('无法读取 zip 流'));
            return;
          }
          const ws = createWriteStream(dest);
          readStream.on('error', rejectP);
          ws.on('error', rejectP);
          ws.on('finish', () => {
            zipfile.readEntry();
          });
          readStream.pipe(ws);
        });
      });
      zipfile.on('end', () => resolveP());
      zipfile.on('error', rejectP);
    });
  });
}

export function maxBundleBytes(): number {
  const raw = process.env.COMPANION_HOST_BUNDLE_MAX_BYTES?.trim();
  if (!raw) return 512 * 1024 * 1024;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 512 * 1024 * 1024;
  return Math.min(n, 1024 * 1024 * 1024);
}

export type DownloadBundleResult = {
  url: URL;
  filePath: string;
  sha256: string;
  bytes: number;
  isZip: boolean;
};

/** 流式下载到 destPath.part，校验后 rename 为 destPath */
export async function downloadBundleToFile(input: {
  url: string;
  sha256Expected: string;
  bytesExpected: number;
  destPath: string;
}): Promise<DownloadBundleResult> {
  const u = assertBundleFetchUrlAllowed(input.url);
  const sha256Expected = String(input.sha256Expected || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256Expected)) throw new Error('sha256 须为 64 位十六进制');
  const bytesExpected = Math.floor(Number(input.bytesExpected));
  if (!Number.isFinite(bytesExpected) || bytesExpected < 1) throw new Error('bytesExpected 无效');

  const cap = maxBundleBytes();
  if (bytesExpected > cap) throw new Error(`包体积超过上限 ${cap} 字节`);

  await mkdir(dirname(input.destPath), { recursive: true });
  const tmpPath = `${input.destPath}.part`;

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
      await new Promise<void>((resolveDrain, rejectDrain) => {
        ws.once('drain', resolveDrain);
        ws.once('error', rejectDrain);
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
  await rm(input.destPath, { force: true });
  await rename(tmpPath, input.destPath);

  return {
    url: u,
    filePath: input.destPath,
    sha256: sha256Expected,
    bytes: bytesExpected,
    isZip: isLikelyZipFile(input.destPath),
  };
}
