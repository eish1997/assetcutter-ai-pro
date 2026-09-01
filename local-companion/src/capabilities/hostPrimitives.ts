import type { SoftwareBridgeDriver, SoftwareBridgeLifecycleInput } from './softwareBridgeDriver.js';
import { resolveSoftwareBridgeDriver } from './softwareBridgeRegistry.js';
import type { CapabilityPackage } from './capabilityPackages.js';
import type { VersionRouteTone } from './connectionLocalVersions.js';

export const HOST_IMPORT_FILE_ID = 'host.import_file';
export const HOST_HTTP_HEALTH_ID = 'host.http_health';
export const HOST_HEARTBEAT_ID = 'host.heartbeat';
export const HOST_PROBE_CAPABILITIES_ID = 'host.probe_capabilities';

export type HostPrimitiveTier = 'primitive' | 'composed';
export type HostPrimitiveProbeKind =
  | 'http_health'
  | 'heartbeat'
  | 'bridge_connected'
  | 'import_smoke'
  | 'capabilities_list';
export type HostPrimitiveStatus = 'pending' | 'verified' | 'failed';
export type HostPrimitiveSeedSource = 'driver' | 'send_gate' | 'promotion';

export type HostPrimitiveSeed = {
  id: string;
  label: string;
  tier?: HostPrimitiveTier;
  probeKind: HostPrimitiveProbeKind;
  dependsOn?: string[];
  seed?: HostPrimitiveSeedSource;
};

export type HostPrimitiveRecord = {
  id: string;
  label: string;
  hostId: string;
  tier: HostPrimitiveTier;
  probeKind: HostPrimitiveProbeKind;
  dependsOn?: string[];
  status: HostPrimitiveStatus;
  lastProbeAt?: string;
  lastProbeMessage?: string;
  localVersionId?: string;
  seed?: HostPrimitiveSeedSource;
  usageSuccessCount?: number;
};

export type InternalRouteView = {
  id: string;
  label: string;
  routeTone: VersionRouteTone;
  routeLabel: string;
  lastProbeAt?: string;
  localVersionId?: string;
};

export type PlaceRouteSummary = {
  externalOpenCount: number;
  internalOpenCount: number;
  internalCount: number;
  summaryLabel: string;
};

export type HealthCheckPendingEntry = {
  draftId: string;
  hostId: string;
  hostName: string;
  primitiveId: string;
  primitiveLabel: string;
  reason: string;
  staleDays?: number;
};

export type HostPrimitiveScannerState = {
  usageByKey: Record<string, number>;
  lastPromotionScanAt?: string;
  lastHealthScanAt?: string;
  healthCheckPending: HealthCheckPendingEntry[];
  lastHealthPromptAtByDraft: Record<string, string>;
};

const DEFAULT_TIER: HostPrimitiveTier = 'composed';
const PRIMITIVE_STATUSES = new Set<HostPrimitiveStatus>(['pending', 'verified', 'failed']);

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeTier(value: unknown, fallback: HostPrimitiveTier = DEFAULT_TIER): HostPrimitiveTier {
  const text = cleanString(value);
  return text === 'primitive' || text === 'composed' ? text : fallback;
}

function normalizeProbeKind(value: unknown, fallback: HostPrimitiveProbeKind = 'bridge_connected'): HostPrimitiveProbeKind {
  const text = cleanString(value) as HostPrimitiveProbeKind;
  const allowed: HostPrimitiveProbeKind[] = [
    'http_health',
    'heartbeat',
    'bridge_connected',
    'import_smoke',
    'capabilities_list',
  ];
  return allowed.includes(text) ? text : fallback;
}

function normalizeStatus(value: unknown, fallback: HostPrimitiveStatus = 'pending'): HostPrimitiveStatus {
  const text = cleanString(value) as HostPrimitiveStatus;
  return PRIMITIVE_STATUSES.has(text) ? text : fallback;
}

function primitiveKey(record: Pick<HostPrimitiveRecord, 'id' | 'localVersionId'>): string {
  const version = cleanString(record.localVersionId);
  return version ? `${record.id}@${version}` : record.id;
}

export function hostIdFromPackage(pkg: CapabilityPackage | null | undefined): string {
  if (!pkg) return '';
  const manifest = asRecord(pkg.manifest);
  return cleanString(manifest.hostId || manifest.softwareId || pkg.id);
}

export function defaultDriverPrimitiveSeeds(driverId: string): HostPrimitiveSeed[] {
  const hostId = cleanString(driverId);
  const seeds: HostPrimitiveSeed[] = [
    {
      id: HOST_IMPORT_FILE_ID,
      label: '导入文件',
      tier: 'primitive',
      probeKind: 'bridge_connected',
      seed: 'driver',
    },
    {
      id: HOST_PROBE_CAPABILITIES_ID,
      label: '基础能力清单',
      tier: 'primitive',
      probeKind: 'capabilities_list',
      seed: 'driver',
    },
  ];
  if (hostId === 'blender' || hostId === 'unreal') {
    seeds.push({
      id: HOST_HTTP_HEALTH_ID,
      label: 'HTTP 健康',
      tier: 'primitive',
      probeKind: 'http_health',
      seed: 'driver',
    });
  } else {
    seeds.push({
      id: HOST_HEARTBEAT_ID,
      label: '桥接心跳',
      tier: 'primitive',
      probeKind: 'heartbeat',
      seed: 'driver',
    });
  }
  return seeds;
}

export function driverPrimitiveSeeds(
  driver: SoftwareBridgeDriver | null | undefined,
  input?: SoftwareBridgeLifecycleInput,
): HostPrimitiveSeed[] {
  if (!driver) return [];
  if (typeof driver.primitives === 'function') {
    const custom = driver.primitives(input);
    if (Array.isArray(custom) && custom.length) return custom;
  }
  return defaultDriverPrimitiveSeeds(driver.id);
}

export function normalizeHostPrimitiveRecord(raw: unknown, hostId: string): HostPrimitiveRecord | null {
  const row = asRecord(raw);
  const id = cleanString(row.id);
  if (!id) return null;
  const dependsOn = Array.isArray(row.dependsOn) ? row.dependsOn.map(String).filter(Boolean) : undefined;
  const usage = Number(row.usageSuccessCount);
  return {
    id,
    label: cleanString(row.label) || id,
    hostId: cleanString(row.hostId) || hostId,
    tier: normalizeTier(row.tier, 'primitive'),
    probeKind: normalizeProbeKind(row.probeKind),
    ...(dependsOn && dependsOn.length ? { dependsOn } : {}),
    status: normalizeStatus(row.status),
    ...(cleanString(row.lastProbeAt) ? { lastProbeAt: cleanString(row.lastProbeAt) } : {}),
    ...(cleanString(row.lastProbeMessage) ? { lastProbeMessage: cleanString(row.lastProbeMessage) } : {}),
    ...(cleanString(row.localVersionId) ? { localVersionId: cleanString(row.localVersionId) } : {}),
    ...(cleanString(row.seed) ? { seed: cleanString(row.seed) as HostPrimitiveSeedSource } : {}),
    ...(Number.isFinite(usage) && usage >= 0 ? { usageSuccessCount: Math.floor(usage) } : {}),
  };
}

export function readHostPrimitivesFromManifest(
  manifest: Record<string, unknown> | null | undefined,
  hostId: string,
): HostPrimitiveRecord[] {
  const list = Array.isArray(manifest?.hostPrimitives) ? manifest.hostPrimitives : [];
  const out: HostPrimitiveRecord[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const normalized = normalizeHostPrimitiveRecord(item, hostId);
    if (!normalized) continue;
    const key = primitiveKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function readHealthCheckPending(manifest: Record<string, unknown> | null | undefined): HealthCheckPendingEntry[] {
  const list = Array.isArray(manifest?.healthCheckPending) ? manifest.healthCheckPending : [];
  const out: HealthCheckPendingEntry[] = [];
  for (const item of list) {
    const row = asRecord(item);
    const draftId = cleanString(row.draftId);
    const primitiveId = cleanString(row.primitiveId);
    if (!draftId || !primitiveId) continue;
    out.push({
      draftId,
      hostId: cleanString(row.hostId),
      hostName: cleanString(row.hostName) || draftId,
      primitiveId,
      primitiveLabel: cleanString(row.primitiveLabel) || primitiveId,
      reason: cleanString(row.reason) || 'stale_probe',
      ...(Number.isFinite(Number(row.staleDays)) ? { staleDays: Number(row.staleDays) } : {}),
    });
  }
  return out;
}

export function internalRouteViewFor(record: HostPrimitiveRecord): InternalRouteView | null {
  if (record.tier !== 'primitive') return null;
  let routeTone: VersionRouteTone = 'pending';
  let routeLabel = '未验证';
  if (record.status === 'verified') {
    routeTone = 'open';
    routeLabel = '已开通';
  } else if (record.status === 'failed') {
    routeTone = 'repair';
    routeLabel = '需修复';
  }
  return {
    id: record.id,
    label: record.label,
    routeTone,
    routeLabel,
    ...(record.lastProbeAt ? { lastProbeAt: record.lastProbeAt } : {}),
    ...(record.localVersionId ? { localVersionId: record.localVersionId } : {}),
  };
}

export function internalRouteRowsForManifest(
  manifest: Record<string, unknown> | null | undefined,
  hostId: string,
  localVersionId?: string,
): InternalRouteView[] {
  const version = cleanString(localVersionId);
  return readHostPrimitivesFromManifest(manifest, hostId)
    .filter((item) => item.tier === 'primitive')
    .filter((item) => !version || !item.localVersionId || item.localVersionId === version)
    .map((item) => internalRouteViewFor(item))
    .filter((item): item is InternalRouteView => Boolean(item));
}

export function placeRouteSummaryFromCounts(
  externalOpenCount: number,
  internalOpenCount: number,
  internalCount: number,
  versionCount: number,
): PlaceRouteSummary {
  const externalLabel = versionCount > 0 ? `官道 ${externalOpenCount}` : '尚无官道';
  const internalLabel = internalCount > 0 ? `内线 ${internalOpenCount}` : '';
  const summaryLabel = internalLabel ? `${externalLabel} · ${internalLabel}` : externalLabel;
  return {
    externalOpenCount,
    internalOpenCount,
    internalCount,
    summaryLabel,
  };
}

export function mergeHostPrimitiveManifest(
  manifest: Record<string, unknown>,
  patch: Partial<HostPrimitiveRecord> & Pick<HostPrimitiveRecord, 'id'>,
  hostId: string,
): Record<string, unknown> {
  const current = readHostPrimitivesFromManifest(manifest, hostId);
  const key = primitiveKey({ id: patch.id, localVersionId: patch.localVersionId });
  const next = [...current];
  const index = next.findIndex((item) => primitiveKey(item) === key);
  const base =
    index >= 0
      ? next[index]!
      : normalizeHostPrimitiveRecord(
          {
            id: patch.id,
            label: patch.label || patch.id,
            tier: patch.tier || 'primitive',
            probeKind: patch.probeKind || 'bridge_connected',
            status: 'pending',
            hostId,
          },
          hostId,
        )!;
  const merged: HostPrimitiveRecord = {
    ...base,
    ...patch,
    id: patch.id,
    hostId: hostId || base.hostId,
    tier: normalizeTier(patch.tier, base.tier),
    probeKind: normalizeProbeKind(patch.probeKind, base.probeKind),
    status: normalizeStatus(patch.status, base.status),
  };
  if (index >= 0) next[index] = merged;
  else next.push(merged);
  return {
    ...manifest,
    hostPrimitives: next,
  };
}

export function syncDriverSeedPrimitives(
  manifest: Record<string, unknown>,
  driver: SoftwareBridgeDriver | null | undefined,
  hostId: string,
  input?: SoftwareBridgeLifecycleInput,
): Record<string, unknown> {
  let next = { ...manifest };
  for (const seed of driverPrimitiveSeeds(driver, input)) {
    if (normalizeTier(seed.tier, 'primitive') !== 'primitive') continue;
    next = mergeHostPrimitiveManifest(
      next,
      {
        id: seed.id,
        label: seed.label,
        tier: 'primitive',
        probeKind: seed.probeKind,
        ...(seed.dependsOn ? { dependsOn: seed.dependsOn } : {}),
        seed: seed.seed || 'driver',
        status: 'pending',
      },
      hostId,
    );
  }
  return next;
}

export function ensureSendGateImportPrimitive(
  manifest: Record<string, unknown>,
  hostId: string,
): Record<string, unknown> {
  return mergeHostPrimitiveManifest(
    manifest,
    {
      id: HOST_IMPORT_FILE_ID,
      label: '导入文件',
      tier: 'primitive',
      probeKind: 'bridge_connected',
      seed: 'send_gate',
      status: normalizeHostPrimitiveRecord(
        readHostPrimitivesFromManifest(manifest, hostId).find((item) => item.id === HOST_IMPORT_FILE_ID),
        hostId,
      )?.status || 'pending',
    },
    hostId,
  );
}

export function writeHealthCheckPendingManifest(
  manifest: Record<string, unknown>,
  pending: HealthCheckPendingEntry[],
): Record<string, unknown> {
  return {
    ...manifest,
    healthCheckPending: pending,
  };
}

export function resolveDriverForPackage(pkg: CapabilityPackage | null | undefined): SoftwareBridgeDriver | null {
  if (!pkg) return null;
  return resolveSoftwareBridgeDriver(pkg);
}

export function listMapVisiblePrimitives(
  manifest: Record<string, unknown> | null | undefined,
  hostId: string,
): HostPrimitiveRecord[] {
  return readHostPrimitivesFromManifest(manifest, hostId).filter((item) => item.tier === 'primitive');
}

export function primitiveUsageKey(draftId: string, primitiveId: string, hostId: string): string {
  return `${draftId}::${hostId}::${primitiveId}`;
}
