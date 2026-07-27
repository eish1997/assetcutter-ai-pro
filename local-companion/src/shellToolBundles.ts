import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { downloadBundleToFile, extractZipToDirectory } from './bundleInstallCore.js';
import { ensureRepositoryRoot } from './repositoryVolume.js';
import {
  TOOL_ID_PATTERN,
  validateShellToolPackageDir,
  type ShellToolPanelSpecV1,
  type ShellToolSpecV1,
} from './shellToolSpec.js';

export const EXAMPLE_SHELL_TOOL_ID = 'image-format-converter';

export type ShellToolBundleManifest = {
  kind: 'shell_tool_bundle';
  toolId: string;
  semver: string;
  label: string;
  sha256: string;
  bytes: number;
  sourceUrlHost: string;
  installedAt: string;
  bundleFormat: 'zip' | 'bin';
  extractedRelativeDir: 'extracted';
};

export type ShellToolSummary = {
  id: string;
  name: string;
  description: string;
  semver: string;
  icon?: string;
  installedAt: string;
  permissions: ShellToolSpecV1['permissions'];
  tags?: string[];
};

export type ShellToolDetail = ShellToolSummary & {
  tool: ShellToolSpecV1;
  panel: ShellToolPanelSpecV1;
  bundlePath: string;
};

function getShellToolsRoot(): string {
  return join(ensureRepositoryRoot(), 'shell-tools');
}

function toolDir(toolId: string): string {
  return join(getShellToolsRoot(), toolId);
}

function extractedDir(toolId: string): string {
  return join(toolDir(toolId), 'extracted');
}

export function assertSafeToolId(id: string): string | null {
  const s = id.trim();
  if (!TOOL_ID_PATTERN.test(s)) return null;
  return s;
}

/** Per-toolId install mutex — prevents concurrent commits corrupting the same tool dir. */
const installCommitLocks = new Map<string, Promise<unknown>>();

function withShellToolInstallLock<T>(toolId: string, fn: () => Promise<T>): Promise<T> {
  const prior = installCommitLocks.get(toolId) ?? Promise.resolve();
  const job = prior.catch(() => {}).then(fn);
  installCommitLocks.set(toolId, job);
  return job.finally(() => {
    if (installCommitLocks.get(toolId) === job) installCommitLocks.delete(toolId);
  });
}

/** staging 内含 extracted/ 与 bundle.bin，原子提交到 shell-tools/<toolId>/ */
export async function commitShellToolStagingPackage(input: {
  toolId: string;
  stagingDir: string;
  manifest: Omit<ShellToolBundleManifest, 'toolId' | 'installedAt'> & { toolId?: string };
}): Promise<{ toolId: string; manifest: ShellToolBundleManifest }> {
  const toolId = assertSafeToolId(input.toolId);
  if (!toolId) throw new Error('tool_invalid_manifest');

  return withShellToolInstallLock(toolId, async () => {
    const stagingExtracted = join(input.stagingDir, 'extracted');
    const stagingBundle = join(input.stagingDir, 'bundle.bin');
    if (!existsSync(stagingExtracted) || !existsSync(stagingBundle)) {
      throw new Error('install_staging_failed');
    }

    const validation = validateShellToolPackageDir(stagingExtracted);
    if (!validation.ok) {
      throw new Error(validation.error === 'tool_invalid_manifest' ? 'tool_invalid_manifest' : validation.error);
    }
    if (validation.tool.id !== toolId) {
      throw new Error('tool_invalid_manifest');
    }

    const destRoot = toolDir(toolId);
    await mkdir(getShellToolsRoot(), { recursive: true });
    await mkdir(destRoot, { recursive: true });

    const destExtracted = join(destRoot, 'extracted');
    const destBak = join(destRoot, 'extracted.bak');
    const destBundle = join(destRoot, 'bundle.bin');

    const prevExtracted = existsSync(destExtracted);
    if (prevExtracted) {
      await rm(destBak, { recursive: true, force: true });
      await rename(destExtracted, destBak);
    }

    const fullManifest: ShellToolBundleManifest = {
      kind: 'shell_tool_bundle',
      toolId,
      semver: input.manifest.semver,
      label: input.manifest.label,
      sha256: input.manifest.sha256,
      bytes: input.manifest.bytes,
      sourceUrlHost: input.manifest.sourceUrlHost,
      installedAt: new Date().toISOString(),
      bundleFormat: input.manifest.bundleFormat,
      extractedRelativeDir: 'extracted',
    };

    try {
      await cp(stagingExtracted, destExtracted, { recursive: true });
      await cp(stagingBundle, destBundle);
      await writeFile(join(destRoot, 'manifest.json'), `${JSON.stringify(fullManifest, null, 2)}\n`, 'utf8');
      if (prevExtracted) {
        await rm(destBak, { recursive: true, force: true }).catch(() => {});
      }
    } catch (e) {
      if (prevExtracted && existsSync(destBak)) {
        await rm(destExtracted, { recursive: true, force: true }).catch(() => {});
        await rename(destBak, destExtracted).catch(() => {});
      } else if (!prevExtracted) {
        await rm(destRoot, { recursive: true, force: true }).catch(() => {});
      }
      throw new Error(`install_staging_failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { toolId, manifest: fullManifest };
  });
}

export async function installShellToolBundleFromUrl(input: {
  url: string;
  semver: string;
  sha256Expected: string;
  bytesExpected: number;
  label?: string;
}): Promise<{ toolId: string; manifest: ShellToolBundleManifest }> {
  const installRoot = join(getShellToolsRoot(), '.install-staging', randomUUID());
  await mkdir(installRoot, { recursive: true });
  const bundlePath = join(installRoot, 'bundle.bin');

  try {
    const dl = await downloadBundleToFile({
      url: input.url,
      sha256Expected: input.sha256Expected,
      bytesExpected: input.bytesExpected,
      destPath: bundlePath,
      allowCatalogInstallHost: true,
    });

    let bundleFormat: 'zip' | 'bin' = 'bin';
    const extractedRoot = join(installRoot, 'extracted');
    if (dl.isZip) {
      await mkdir(extractedRoot, { recursive: true });
      try {
        await extractZipToDirectory(bundlePath, extractedRoot);
        bundleFormat = 'zip';
      } catch (e) {
        throw new Error(`ZIP 解压失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      throw new Error('小工具包须为 ZIP 格式');
    }

    const validation = validateShellToolPackageDir(extractedRoot);
    if (!validation.ok) {
      throw new Error(validation.error === 'tool_invalid_manifest' ? 'tool_invalid_manifest' : validation.error);
    }

    return await commitShellToolStagingPackage({
      toolId: validation.tool.id,
      stagingDir: installRoot,
      manifest: {
        kind: 'shell_tool_bundle',
        semver: input.semver.trim() || validation.tool.semver,
        label: String(input.label || validation.tool.name).trim(),
        sha256: dl.sha256,
        bytes: dl.bytes,
        sourceUrlHost: dl.url.hostname,
        bundleFormat,
        extractedRelativeDir: 'extracted',
      },
    });
  } finally {
    await rm(installRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/** toolId → packages/shell-tools/<folder> */
const BUILTIN_SHELL_TOOL_EXAMPLE_FOLDERS: Record<string, string> = {
  'image-format-converter': 'example-image-converter',
  'transfer-maps-batch': 'transfer-maps-batch',
};

const BUILTIN_SHELL_TOOL_EXAMPLE_IDS = Object.keys(BUILTIN_SHELL_TOOL_EXAMPLE_FOLDERS);

/** 解析内置示例包目录（开发仓库或 COMPANION_SHELL_TOOL_EXAMPLE_DIR）。 */
export function resolveExampleShellToolSourceDir(exampleId?: string): string | null {
  const want = String(exampleId || EXAMPLE_SHELL_TOOL_ID).trim() || EXAMPLE_SHELL_TOOL_ID;
  const fromEnv = process.env.COMPANION_SHELL_TOOL_EXAMPLE_DIR?.trim();
  if (fromEnv && existsSync(join(fromEnv, 'tool.json'))) {
    // Env override applies to the default example only; explicit exampleId must match package id.
    if (!exampleId) return resolve(fromEnv);
    try {
      const raw = JSON.parse(readFileSync(join(fromEnv, 'tool.json'), 'utf8')) as { id?: string };
      if (raw.id === want) return resolve(fromEnv);
    } catch {
      /* fall through to repo candidates */
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const folder = BUILTIN_SHELL_TOOL_EXAMPLE_FOLDERS[want] || want;
  const candidates = [
    join(process.cwd(), 'packages', 'shell-tools', folder),
    join(here, '..', '..', 'packages', 'shell-tools', folder),
    join(here, '..', 'packages', 'shell-tools', folder),
    join(here, '..', 'shell-tools', folder),
    join(here, folder),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'tool.json'))) return resolve(c);
  }
  return null;
}

export function listBuiltinShellToolExampleIds(): string[] {
  return BUILTIN_SHELL_TOOL_EXAMPLE_IDS.filter((id) => Boolean(resolveExampleShellToolSourceDir(id)));
}

export async function installExampleShellTool(
  exampleId?: string,
): Promise<{ toolId: string; manifest: ShellToolBundleManifest }> {
  const dir = resolveExampleShellToolSourceDir(exampleId);
  if (!dir) throw new Error('example_tool_unavailable');
  return installShellToolFromLocalDir(dir);
}

/** 从本地目录安装（开发/测试）：目录内含 tool.json 等，等同 extracted 根 */
export async function installShellToolFromLocalDir(sourceDir: string): Promise<{ toolId: string; manifest: ShellToolBundleManifest }> {
  const validation = validateShellToolPackageDir(sourceDir);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const installRoot = join(getShellToolsRoot(), '.install-staging', randomUUID());
  const extractedRoot = join(installRoot, 'extracted');
  await mkdir(extractedRoot, { recursive: true });
  await cp(sourceDir, extractedRoot, { recursive: true });
  await writeFile(join(installRoot, 'bundle.bin'), '', 'utf8');

  try {
    return await commitShellToolStagingPackage({
      toolId: validation.tool.id,
      stagingDir: installRoot,
      manifest: {
        kind: 'shell_tool_bundle',
        semver: validation.tool.semver,
        label: validation.tool.name,
        sha256: '0'.repeat(64),
        bytes: 0,
        sourceUrlHost: 'local',
        bundleFormat: 'zip',
        extractedRelativeDir: 'extracted',
      },
    });
  } finally {
    await rm(installRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function readManifest(toolId: string): Promise<ShellToolBundleManifest | null> {
  const p = join(toolDir(toolId), 'manifest.json');
  try {
    const parsed = JSON.parse(await readFile(p, 'utf8')) as ShellToolBundleManifest;
    if (parsed?.kind !== 'shell_tool_bundle' || parsed.toolId !== toolId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listInstalledShellTools(): Promise<ShellToolSummary[]> {
  const root = getShellToolsRoot();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out: ShellToolSummary[] = [];
  for (const name of names) {
    if (name.startsWith('.') || name === '.install-staging') continue;
    const id = assertSafeToolId(name);
    if (!id) continue;
    const manifest = await readManifest(id);
    const ext = extractedDir(id);
    const validation = validateShellToolPackageDir(ext);
    if (!manifest || !validation.ok) continue;
    out.push({
      id: validation.tool.id,
      name: validation.tool.name,
      description: validation.tool.description,
      semver: validation.tool.semver,
      icon: validation.tool.icon,
      installedAt: manifest.installedAt,
      permissions: validation.tool.permissions,
      ...(validation.tool.tags?.length ? { tags: validation.tool.tags } : {}),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return out;
}

export async function getShellToolDetail(toolIdRaw: string): Promise<ShellToolDetail | null> {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) return null;
  const manifest = await readManifest(toolId);
  if (!manifest) return null;
  const validation = validateShellToolPackageDir(extractedDir(toolId));
  if (!validation.ok) return null;
  return {
    id: validation.tool.id,
    name: validation.tool.name,
    description: validation.tool.description,
    semver: validation.tool.semver,
    icon: validation.tool.icon,
    installedAt: manifest.installedAt,
    permissions: validation.tool.permissions,
    tool: validation.tool,
    panel: validation.panel,
    bundlePath: join(toolDir(toolId), 'bundle.bin'),
  };
}

export async function uninstallShellTool(toolIdRaw: string): Promise<boolean> {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) return false;
  const dir = toolDir(toolId);
  if (!existsSync(join(dir, 'manifest.json'))) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

export function countShellToolsSync(): number {
  const root = getShellToolsRoot();
  if (!existsSync(root)) return 0;
  let n = 0;
  for (const name of readdirSync(root)) {
    if (name.startsWith('.')) continue;
    if (assertSafeToolId(name) && existsSync(join(root, name, 'manifest.json'))) n += 1;
  }
  return n;
}

function resolveExtractedWorkDir(extractedRoot: string, cwdRel: string | undefined): string {
  const sub = (cwdRel && cwdRel.trim() !== '' ? cwdRel.trim() : '.') || '.';
  const target = sub === '.' ? extractedRoot : join(extractedRoot, sub);
  const resolved = resolve(target);
  const er = resolve(extractedRoot);
  if (resolved !== er && !resolved.startsWith(er + sep)) {
    throw new Error('cwd 超出 extracted 根目录');
  }
  return resolved;
}

export function getShellToolExtractedRoot(toolId: string): string | null {
  const id = assertSafeToolId(toolId);
  if (!id) return null;
  const ext = extractedDir(id);
  return existsSync(ext) ? ext : null;
}

export { resolveExtractedWorkDir };
