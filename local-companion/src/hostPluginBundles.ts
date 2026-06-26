import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertBundleFetchUrlAllowed,
  assertHostBundleFetchUrlAllowed,
  downloadBundleToFile,
  extractZipToDirectory,
  isLikelyZipFile,
} from './bundleInstallCore.js';
import { readHostBundleRunSpecSync, type HostBundleRunSpecV1 } from './hostBundleRunSpec.js';
import { ensureRepositoryRoot } from './repositoryVolume.js';

export { assertHostBundleFetchUrlAllowed, assertBundleFetchUrlAllowed, isLikelyZipFile };

export type HostBundleManifest = {
  kind: 'host_plugin_bundle';
  semver: string;
  label: string;
  sha256: string;
  bytes: number;
  sourceUrlHost: string;
  installedAt: string;
  bundleFormat?: 'zip' | 'bin';
  extractedRelativeDir?: string;
};

export type HostBundlePluginSummary = {
  dirName: string;
  semver: string;
  label: string;
  bundleFormat?: 'zip' | 'bin';
  extractedRelativeDir?: string;
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

export async function installHostPluginBundleFromUrl(input: {
  url: string;
  semver: string;
  sha256Expected: string;
  bytesExpected: number;
  label?: string;
}): Promise<{ manifest: HostBundleManifest; bundlePath: string; runSpec: HostBundleRunSpecV1 | null }> {
  const semverDir = safeSemverDir(input.semver);
  const root = getBundlesRoot();
  await mkdir(root, { recursive: true });
  const destDir = join(root, semverDir);
  await mkdir(destDir, { recursive: true });
  const finalPath = join(destDir, 'bundle.bin');

  const dl = await downloadBundleToFile({
    url: input.url,
    sha256Expected: input.sha256Expected,
    bytesExpected: input.bytesExpected,
    destPath: finalPath,
    allowCatalogInstallHost: true,
  });

  let bundleFormat: 'zip' | 'bin' = 'bin';
  let extractedRelativeDir: string | undefined;
  if (dl.isZip) {
    const extractedRoot = join(destDir, 'extracted');
    await rm(extractedRoot, { recursive: true, force: true });
    try {
      await extractZipToDirectory(finalPath, extractedRoot);
      bundleFormat = 'zip';
      extractedRelativeDir = 'extracted';
    } catch (e) {
      await rm(extractedRoot, { recursive: true, force: true }).catch(() => {});
      throw new Error(`ZIP 解压失败（文件头似 ZIP）：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const manifest: HostBundleManifest = {
    kind: 'host_plugin_bundle',
    semver: input.semver.trim(),
    label: String(input.label || '').trim(),
    sha256: dl.sha256,
    bytes: dl.bytes,
    sourceUrlHost: dl.url.hostname,
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
