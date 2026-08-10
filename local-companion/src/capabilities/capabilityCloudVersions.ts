import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { normalizeCapabilityId, type CapabilityPackage } from './capabilityPackages.js';
import { checkCapabilityPublishGate } from './capabilityPublishGate.js';

export type CapabilityCloudVersion = {
  id: string;
  packageId: string;
  type: CapabilityPackage['type'];
  semver: string;
  note: string;
  publishedAt: string;
  publishedBy?: string;
  package: CapabilityPackage;
};

export type CapabilityCloudVersionSummary = {
  id: string;
  packageId: string;
  type: CapabilityPackage['type'];
  semver: string;
  note: string;
  publishedAt: string;
  publishedBy?: string;
  active: boolean;
};

export type CapabilityCloudStore = {
  version: 1;
  active: Record<string, string>;
  versions: Record<string, CapabilityCloudVersion[]>;
};

function capabilitiesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'capabilities'));
  return resolve(join(getRepositoryRoot(), '..', 'capabilities'));
}

function cloudStorePath(): string {
  return join(capabilitiesStateDir(), 'cloud-versions.json');
}

function emptyStore(): CapabilityCloudStore {
  return { version: 1, active: {}, versions: {} };
}

function readStore(): CapabilityCloudStore {
  try {
    const p = cloudStorePath();
    if (!existsSync(p)) return emptyStore();
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as CapabilityCloudStore;
    return parsed && parsed.version === 1 && parsed.versions ? { ...emptyStore(), ...parsed } : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store: CapabilityCloudStore): void {
  const p = cloudStorePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, p);
}

function normalizeSemver(raw: unknown, existingCount: number): string {
  const text = String(raw || '').trim();
  if (/^\d+\.\d+\.\d+$/.test(text)) return text;
  return `0.1.${Math.max(0, existingCount)}`;
}

function toCloudPackage(pkg: CapabilityPackage, semver: string): CapabilityPackage {
  return {
    ...pkg,
    source: 'cloud',
    version: semver,
  };
}

function summarize(version: CapabilityCloudVersion, activeId: string | undefined): CapabilityCloudVersionSummary {
  return {
    id: version.id,
    packageId: version.packageId,
    type: version.type,
    semver: version.semver,
    note: version.note,
    publishedAt: version.publishedAt,
    ...(version.publishedBy ? { publishedBy: version.publishedBy } : {}),
    active: version.id === activeId,
  };
}

export function listCapabilityCloudVersions(packageIdRaw?: string): CapabilityCloudVersionSummary[] {
  const store = readStore();
  const packageId = packageIdRaw ? normalizeCapabilityId(packageIdRaw) : '';
  const versions = packageId ? store.versions[packageId] || [] : Object.values(store.versions).flat();
  return versions
    .slice()
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .map((version) => summarize(version, store.active[version.packageId]));
}

export function activeCapabilityCloudVersion(packageIdRaw: string): CapabilityCloudVersion | null {
  const packageId = normalizeCapabilityId(packageIdRaw);
  if (!packageId) return null;
  const store = readStore();
  const versions = store.versions[packageId] || [];
  const activeId = store.active[packageId];
  return versions.find((item) => item.id === activeId) || versions[0] || null;
}

export function activeCapabilityCloudPackage(packageIdRaw: string): CapabilityPackage | null {
  const version = activeCapabilityCloudVersion(packageIdRaw);
  return version ? version.package : null;
}

export function listActiveCapabilityCloudPackages(): CapabilityPackage[] {
  const store = readStore();
  const out: CapabilityPackage[] = [];
  for (const packageId of Object.keys(store.versions)) {
    const version = activeCapabilityCloudVersion(packageId);
    if (version) out.push(version.package);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function publishCapabilityDraftToCloud(
  packageIdRaw: string,
  input: { semver?: string; versionNote?: string; note?: string; actorRole?: string; isAdmin?: boolean; publishedBy?: string } = {},
): { ok: true; version: CapabilityCloudVersion; versions: CapabilityCloudVersionSummary[] } | { ok: false; error: string; message: string; gate?: unknown } {
  const note = String(input.versionNote || input.note || '').trim();
  const gate = checkCapabilityPublishGate(packageIdRaw, {
    actorRole: input.actorRole,
    isAdmin: input.isAdmin,
    versionNote: note,
  });
  if (!gate.publishable || !gate.publishCandidate) {
    return { ok: false, error: gate.code, message: gate.message, gate };
  }

  const store = readStore();
  const packageId = normalizeCapabilityId(gate.publishCandidate.id);
  const existing = store.versions[packageId] || [];
  const semver = normalizeSemver(input.semver, existing.length);
  const now = new Date().toISOString();
  const pkg = toCloudPackage(gate.publishCandidate, semver);
  const version: CapabilityCloudVersion = {
    id: `${packageId}@${semver}@${Date.now()}`,
    packageId,
    type: pkg.type,
    semver,
    note,
    publishedAt: now,
    publishedBy: input.publishedBy,
    package: pkg,
  };
  store.versions[packageId] = [version].concat(existing.filter((item) => item.id !== version.id));
  store.active[packageId] = version.id;
  writeStore(store);
  return { ok: true, version, versions: listCapabilityCloudVersions(packageId) };
}

export function switchCapabilityCloudVersion(
  packageIdRaw: string,
  versionId: string,
  input: { actorRole?: string; isAdmin?: boolean } = {},
): { ok: true; version: CapabilityCloudVersion; versions: CapabilityCloudVersionSummary[] } | { ok: false; error: string; message: string } {
  if (input.isAdmin !== true && !['admin', 'super', 'owner'].includes(String(input.actorRole || '').trim().toLowerCase())) {
    return { ok: false, error: 'admin_required', message: 'Only admins can switch governed cloud capability versions.' };
  }
  const packageId = normalizeCapabilityId(packageIdRaw);
  const store = readStore();
  const version = (store.versions[packageId] || []).find((item) => item.id === versionId);
  if (!version) {
    return { ok: false, error: 'cloud_version_not_found', message: 'Only existing cloud versions can be activated.' };
  }
  store.active[packageId] = version.id;
  writeStore(store);
  return { ok: true, version, versions: listCapabilityCloudVersions(packageId) };
}
