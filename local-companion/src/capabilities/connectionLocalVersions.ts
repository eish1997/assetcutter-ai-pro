import { win32 as pathWin32 } from 'node:path';

export type LocalSoftwareVersionSource =
  | 'drag_drop'
  | 'process'
  | 'registry'
  | 'common_path'
  | 'manual'
  | 'saved_target';

export type LocalSoftwareVersionStatus =
  | 'detected'
  | 'launchable'
  | 'installed'
  | 'verified'
  | 'failed';

export type LocalSoftwareVersion = {
  id: string;
  label: string;
  softwareVersion: string;
  executablePath?: string;
  shortcutPath?: string;
  installRoot?: string;
  source: LocalSoftwareVersionSource;
  status: LocalSoftwareVersionStatus;
  lastSeenAt?: string;
  lastProbeAt?: string;
  verifiedStrategyId?: string;
};

export type ConnectionLocalVersionsInput = {
  name?: unknown;
  appName?: unknown;
  manifest?: Record<string, unknown> | null;
};

export type NormalizedConnectionLocalVersions = {
  currentLocalVersion: LocalSoftwareVersion | null;
  localVersions: LocalSoftwareVersion[];
  currentLocalVersionId: string;
  defaultLocalVersionId: string;
};

export type MergeConnectionLocalVersionOptions = {
  makeCurrent?: boolean;
  makeDefault?: boolean;
};

export type VersionRouteTone = 'open' | 'repair' | 'pending';

export type VersionRouteView = {
  id: string;
  label: string;
  softwareVersion: string;
  targetLabel: string;
  routeTone: VersionRouteTone;
  routeLabel: string;
  isCurrent: boolean;
};

export type PlaceVersionSummary = {
  versionCount: number;
  openCount: number;
  summaryLabel: string;
};

const SOURCES = new Set<LocalSoftwareVersionSource>([
  'drag_drop',
  'process',
  'registry',
  'common_path',
  'manual',
  'saved_target',
]);

const STATUSES = new Set<LocalSoftwareVersionStatus>([
  'detected',
  'launchable',
  'installed',
  'verified',
  'failed',
]);

const STATUS_RANK: Record<LocalSoftwareVersionStatus, number> = {
  verified: 0,
  installed: 1,
  launchable: 2,
  detected: 3,
  failed: 4,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return '';
}

function cleanPath(value: unknown): string {
  return cleanString(value).replace(/\//g, '\\');
}

function normalizeSource(value: unknown, fallback: LocalSoftwareVersionSource): LocalSoftwareVersionSource {
  const text = cleanString(value) as LocalSoftwareVersionSource;
  return SOURCES.has(text) ? text : fallback;
}

function normalizeStatus(value: unknown, fallback: LocalSoftwareVersionStatus): LocalSoftwareVersionStatus {
  const text = cleanString(value) as LocalSoftwareVersionStatus;
  return STATUSES.has(text) ? text : fallback;
}

function stableId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/[/\\]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return normalized || 'local-version';
}

function labelForVersion(appName: string, softwareVersion: string, executablePath: string, shortcutPath: string): string {
  const basename = executablePath ? pathWin32.basename(executablePath, pathWin32.extname(executablePath)) : '';
  const base = appName || basename || '本机软件';
  return softwareVersion ? `${base} ${softwareVersion}` : base;
}

const PATH_LABEL_NOISE = new Set(['bin', 'win64', 'win32', 'x64', 'engine', 'binaries', 'binary']);

export function displayVersionLabel(
  item: Pick<LocalSoftwareVersion, 'softwareVersion' | 'label' | 'executablePath' | 'installRoot' | 'shortcutPath'>,
): string {
  const softwareVersion = cleanString(item.softwareVersion);
  if (softwareVersion) return softwareVersion;
  const paths = [item.executablePath, item.installRoot, item.shortcutPath].map(cleanPath).filter(Boolean);
  for (const rawPath of paths) {
    const maya = rawPath.match(/Maya(\d{4})/i);
    if (maya?.[1]) return maya[1];
    const ue = rawPath.match(/UE[_\s-]?(\d+(?:\.\d+)?)/i);
    if (ue?.[1]) return ue[1];
    const segments = rawPath.split(/[/\\]/).filter(Boolean);
    for (const segment of segments) {
      const lower = segment.toLowerCase();
      if (PATH_LABEL_NOISE.has(lower)) continue;
      const plainVersion = segment.match(/^v?(\d+(?:\.\d+){0,2})$/i);
      if (plainVersion?.[1]) return plainVersion[1];
      const productYear = segment.match(/^[A-Za-z]+(\d{4})$/);
      if (productYear?.[1]) return productYear[1];
    }
  }
  const label = cleanString(item.label);
  if (label) {
    const lower = label.toLowerCase();
    if (!PATH_LABEL_NOISE.has(lower)) {
      const tail = label.split(/\s+/).pop() || '';
      if (/^\d/.test(tail)) return tail;
      if (label.length <= 16) return label;
    }
  }
  const executablePath = cleanPath(item.executablePath);
  if (executablePath) {
    const base = pathWin32.basename(executablePath, pathWin32.extname(executablePath));
    if (base && !PATH_LABEL_NOISE.has(base.toLowerCase())) return base;
  }
  return '未识别版本';
}

function versionKey(item: LocalSoftwareVersion): string {
  const path = (item.executablePath || item.shortcutPath || item.installRoot || '').toLowerCase();
  if (path) return `path:${path}`;
  if (item.softwareVersion) return `version:${item.softwareVersion.toLowerCase()}`;
  return `id:${item.id}`;
}

function itemFromRecord(record: Record<string, unknown>, appName: string): LocalSoftwareVersion | null {
  const executablePath = cleanPath(record.executablePath);
  const shortcutPath = cleanPath(record.shortcutPath);
  const installRoot = cleanPath(record.installRoot) || (executablePath ? pathWin32.dirname(executablePath) : '');
  const softwareVersion = firstString(record.softwareVersion, record.versionHint, record.version);
  const label = firstString(record.label) || labelForVersion(appName, softwareVersion, executablePath, shortcutPath);
  const source = normalizeSource(record.source, 'manual');
  const fallbackStatus: LocalSoftwareVersionStatus = executablePath || shortcutPath ? 'launchable' : 'detected';
  const status = normalizeStatus(record.status, fallbackStatus);
  const id = stableId(firstString(record.id) || [source, softwareVersion, executablePath, shortcutPath, installRoot, label].filter(Boolean).join('|'));
  if (!id && !label && !softwareVersion && !executablePath && !shortcutPath && !installRoot) return null;
  return {
    id,
    label,
    softwareVersion,
    ...(executablePath ? { executablePath } : {}),
    ...(shortcutPath ? { shortcutPath } : {}),
    ...(installRoot ? { installRoot } : {}),
    source,
    status,
    ...(cleanString(record.lastSeenAt) ? { lastSeenAt: cleanString(record.lastSeenAt) } : {}),
    ...(cleanString(record.lastProbeAt) ? { lastProbeAt: cleanString(record.lastProbeAt) } : {}),
    ...(cleanString(record.verifiedStrategyId) ? { verifiedStrategyId: cleanString(record.verifiedStrategyId) } : {}),
  };
}

function legacyVersionFromManifest(manifest: Record<string, unknown>, appName: string): LocalSoftwareVersion | null {
  const executablePath = cleanPath(manifest.executablePath);
  const shortcutPath = cleanPath(manifest.shortcutPath);
  const inputPath = cleanPath(manifest.inputPath);
  const installRoot = cleanPath(manifest.installRoot) || (executablePath ? pathWin32.dirname(executablePath) : '');
  const softwareVersion = firstString(manifest.softwareVersion, manifest.versionHint, manifest.version);
  const fallbackExecutable = executablePath || (inputPath.toLowerCase().endsWith('.exe') ? inputPath : '');
  const fallbackShortcut = shortcutPath || (inputPath.toLowerCase().endsWith('.lnk') ? inputPath : '');
  if (!softwareVersion && !fallbackExecutable && !fallbackShortcut && !installRoot) return null;
  const source = cleanString(manifest.droppedFrom) === 'connection_page' ? 'drag_drop' : 'manual';
  return itemFromRecord(
    {
      id: firstString(manifest.currentLocalVersionId, manifest.defaultLocalVersionId),
      label: firstString(manifest.localVersionLabel),
      softwareVersion,
      executablePath: fallbackExecutable,
      shortcutPath: fallbackShortcut,
      installRoot,
      source,
      status: fallbackExecutable || fallbackShortcut ? 'launchable' : 'detected',
    },
    appName,
  );
}

export function normalizeConnectionLocalVersions(input?: ConnectionLocalVersionsInput | null): NormalizedConnectionLocalVersions {
  const source = asRecord(input);
  const manifest = asRecord(source.manifest);
  const appName = firstString(source.appName, source.name, manifest.appName, manifest.displayName);
  const rawVersions = Array.isArray(manifest.localVersions) ? manifest.localVersions : [];
  const items: LocalSoftwareVersion[] = [];

  for (const raw of rawVersions) {
    const item = itemFromRecord(asRecord(raw), appName);
    if (item) items.push(item);
  }

  if (!items.length) {
    const legacy = legacyVersionFromManifest(manifest, appName);
    if (legacy) items.push(legacy);
  }

  const requestedCurrentId = cleanString(manifest.currentLocalVersionId);
  const requestedDefaultId = cleanString(manifest.defaultLocalVersionId);
  const keyById = new Map<string, string>();
  const byKey = new Map<string, LocalSoftwareVersion>();
  for (const item of items) {
    const key = versionKey(item);
    keyById.set(item.id, key);
    const existing = byKey.get(key);
    if (!existing || STATUS_RANK[item.status] < STATUS_RANK[existing.status]) {
      byKey.set(key, item);
    }
  }

  const localVersions = Array.from(byKey.values()).sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    return a.label.localeCompare(b.label);
  });

  const requestedCurrentKey = requestedCurrentId ? keyById.get(requestedCurrentId) : '';
  const requestedDefaultKey = requestedDefaultId ? keyById.get(requestedDefaultId) : '';
  const defaultLocalVersion =
    localVersions.find((item) => item.id === requestedDefaultId) ||
    localVersions.find((item) => requestedDefaultKey && versionKey(item) === requestedDefaultKey) ||
    localVersions.find((item) => item.status === 'verified') ||
    localVersions.find((item) => item.status === 'installed') ||
    localVersions.find((item) => item.status === 'launchable') ||
    localVersions[0] ||
    null;
  const currentLocalVersion =
    localVersions.find((item) => item.id === requestedCurrentId) ||
    localVersions.find((item) => requestedCurrentKey && versionKey(item) === requestedCurrentKey) ||
    defaultLocalVersion;

  return {
    currentLocalVersion: currentLocalVersion || null,
    localVersions,
    currentLocalVersionId: currentLocalVersion?.id || '',
    defaultLocalVersionId: defaultLocalVersion?.id || '',
  };
}

export function versionRouteViewFor(
  item: LocalSoftwareVersion,
  opts: { isCurrent?: boolean } = {},
): VersionRouteView {
  const targetLabel = firstString(item.executablePath, item.shortcutPath, item.installRoot, '未指定位置');
  const softwareVersion = firstString(item.softwareVersion);
  const label = displayVersionLabel(item);
  let routeTone: VersionRouteTone = 'pending';
  let routeLabel = '未开通';
  switch (item.status) {
    case 'verified':
      routeTone = 'open';
      routeLabel = '已开通';
      break;
    case 'launchable':
    case 'installed':
      routeTone = 'pending';
      routeLabel = '未验证';
      break;
    case 'detected':
      routeTone = 'pending';
      routeLabel = '未开通';
      break;
    case 'failed':
      routeTone = 'repair';
      routeLabel = '需修复';
      break;
    default:
      break;
  }
  return {
    id: item.id,
    label,
    softwareVersion,
    targetLabel,
    routeTone,
    routeLabel,
    isCurrent: opts.isCurrent === true,
  };
}

export function placeSummaryFromVersionRows(rows: VersionRouteView[]): PlaceVersionSummary {
  const versionCount = rows.length;
  const openCount = rows.filter((row) => row.routeTone === 'open').length;
  const summaryLabel =
    versionCount > 0
      ? `${versionCount} 个版本${openCount > 0 ? ` · ${openCount} 条已开通` : ''}`
      : '尚无本机版本';
  return { versionCount, openCount, summaryLabel };
}

export function mergeConnectionLocalVersionManifest(
  manifestRaw: Record<string, unknown> | null | undefined,
  versionRaw: Partial<LocalSoftwareVersion>,
  options: MergeConnectionLocalVersionOptions = {},
): Record<string, unknown> {
  const manifest = asRecord(manifestRaw);
  const appName = firstString(manifest.appName, manifest.displayName);
  const item = itemFromRecord(asRecord(versionRaw), appName);
  if (!item) return { ...manifest };
  const localVersions = Array.isArray(manifest.localVersions) ? manifest.localVersions.slice() : [];
  localVersions.push(item);
  const normalized = normalizeConnectionLocalVersions({
    appName,
    manifest: {
      ...manifest,
      localVersions,
      currentLocalVersionId: options.makeCurrent ? item.id : manifest.currentLocalVersionId,
      defaultLocalVersionId: options.makeDefault ? item.id : manifest.defaultLocalVersionId,
    },
  });
  return {
    ...manifest,
    localVersions: normalized.localVersions,
    currentLocalVersionId:
      normalized.currentLocalVersionId ||
      (options.makeCurrent ? item.id : cleanString(manifest.currentLocalVersionId)),
    defaultLocalVersionId:
      normalized.defaultLocalVersionId ||
      (options.makeDefault ? item.id : cleanString(manifest.defaultLocalVersionId)),
  };
}
