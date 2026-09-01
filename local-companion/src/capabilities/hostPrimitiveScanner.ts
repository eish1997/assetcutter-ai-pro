import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import {
  HOST_IMPORT_FILE_ID,
  mergeHostPrimitiveManifest,
  primitiveUsageKey,
  readHealthCheckPending,
  readHostPrimitivesFromManifest,
  writeHealthCheckPendingManifest,
  hostIdFromPackage,
  type HealthCheckPendingEntry,
  type HostPrimitiveScannerState,
} from './hostPrimitives.js';
import { readCapabilityPackageDrafts, updateCapabilityPackageDraft } from './capabilityPackageStore.js';
import { probeHostPrimitive } from './hostPrimitiveProbe.js';
import { normalizeHostPrimitiveMetadata } from './hostPrimitiveCatalog.js';

const PROMOTION_DEPENDS_ON_MIN = 2;
const PROMOTION_USAGE_MIN = 5;
const HEALTH_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const HOST_PRIMITIVE_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

function scannerStatePath(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  const base = sb ? resolve(join(sb, 'capabilities')) : resolve(join(getRepositoryRoot(), '..', 'capabilities'));
  return join(base, 'host-primitive-scanner-state.json');
}

function readScannerState(): HostPrimitiveScannerState {
  const fallback: HostPrimitiveScannerState = {
    usageByKey: {},
    healthCheckPending: [],
    lastHealthPromptAtByDraft: {},
  };
  try {
    const raw = JSON.parse(readFileSync(scannerStatePath(), 'utf8')) as HostPrimitiveScannerState;
    return {
      usageByKey: raw.usageByKey && typeof raw.usageByKey === 'object' ? raw.usageByKey : {},
      healthCheckPending: Array.isArray(raw.healthCheckPending) ? raw.healthCheckPending : [],
      lastHealthPromptAtByDraft:
        raw.lastHealthPromptAtByDraft && typeof raw.lastHealthPromptAtByDraft === 'object'
          ? raw.lastHealthPromptAtByDraft
          : {},
      ...(raw.lastPromotionScanAt ? { lastPromotionScanAt: raw.lastPromotionScanAt } : {}),
      ...(raw.lastHealthScanAt ? { lastHealthScanAt: raw.lastHealthScanAt } : {}),
    };
  } catch {
    return fallback;
  }
}

function writeScannerState(state: HostPrimitiveScannerState): void {
  const path = scannerStatePath();
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function recordHostPrimitiveUsageSuccess(draftId: string, hostId: string, primitiveId: string): void {
  const state = readScannerState();
  const key = primitiveUsageKey(draftId, primitiveId, hostId);
  state.usageByKey[key] = (state.usageByKey[key] || 0) + 1;
  writeScannerState(state);
}

function outerRouteOpen(manifest: Record<string, unknown>): boolean {
  const versions = Array.isArray(manifest.localVersions) ? manifest.localVersions : [];
  return versions.some((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'verified');
}

function dependsOnCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const draft of readCapabilityPackageDrafts()) {
    const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
    const meta = normalizeHostPrimitiveMetadata(manifest);
    if (meta.tier !== 'composed') continue;
    for (const dep of meta.dependsOn) {
      counts.set(dep, (counts.get(dep) || 0) + 1);
    }
    const hostId = hostIdFromPackage(draft);
    if (hostId && meta.hostPrimitiveId) {
      counts.set(`${hostId}::${meta.hostPrimitiveId}`, (counts.get(`${hostId}::${meta.hostPrimitiveId}`) || 0) + 1);
    }
  }
  return counts;
}

export function scanPromotions(): { promoted: number } {
  const state = readScannerState();
  const dependsOn = dependsOnCounts();
  let promoted = 0;
  for (const draft of readCapabilityPackageDrafts()) {
    if (draft.type !== 'software_connection' && draft.type !== 'tool' && draft.type !== 'workflow') continue;
    const manifest = draft.manifest && typeof draft.manifest === 'object' ? ({ ...(draft.manifest as Record<string, unknown>) } as Record<string, unknown>) : {};
    const hostId = hostIdFromPackage(draft) || draft.id;
    const meta = normalizeHostPrimitiveMetadata(manifest);
    if (meta.tier === 'primitive') continue;
    const candidateId = meta.hostPrimitiveId || (draft.type === 'tool' ? `tool.${draft.id}` : `workflow.${draft.id}`);
    const usageKey = primitiveUsageKey(draft.id, candidateId, hostId);
    const usage = state.usageByKey[usageKey] || 0;
    const depCount = (dependsOn.get(candidateId) || 0) + (dependsOn.get(`${hostId}::${candidateId}`) || 0);
    const shouldPromote = depCount >= PROMOTION_DEPENDS_ON_MIN || usage >= PROMOTION_USAGE_MIN;
    if (!shouldPromote) continue;
    if (draft.type !== 'software_connection') continue;
    updateCapabilityPackageDraft(draft.id, (current) => {
      const currentManifest =
        current.manifest && typeof current.manifest === 'object'
          ? ({ ...(current.manifest as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      if (!outerRouteOpen(currentManifest)) return current;
      const next = mergeHostPrimitiveManifest(
        currentManifest,
        {
          id: candidateId,
          label: meta.hostPrimitiveLabel || draft.name,
          tier: 'primitive',
          probeKind: (meta.probeKind as 'bridge_connected') || 'bridge_connected',
          ...(meta.dependsOn.length ? { dependsOn: meta.dependsOn } : {}),
          seed: 'promotion',
          status: 'pending',
        },
        hostId,
      );
      return { ...current, manifest: next };
    });
    promoted += 1;
    void probeHostPrimitive(draft.id, candidateId);
  }
  state.lastPromotionScanAt = new Date().toISOString();
  writeScannerState(state);
  return { promoted };
}

export function scanHealthStale(): { pending: number } {
  const now = Date.now();
  const pendingEntries: HealthCheckPendingEntry[] = [];
  for (const draft of readCapabilityPackageDrafts()) {
    if (draft.type !== 'software_connection') continue;
    const manifest = draft.manifest && typeof draft.manifest === 'object' ? (draft.manifest as Record<string, unknown>) : {};
    if (!outerRouteOpen(manifest)) continue;
    const hostId = hostIdFromPackage(draft) || draft.id;
    for (const record of readHostPrimitivesFromManifest(manifest, hostId)) {
      if (record.tier !== 'primitive') continue;
      const lastProbeAt = record.lastProbeAt ? Date.parse(record.lastProbeAt) : 0;
      const stale = record.status === 'failed' || !lastProbeAt || now - lastProbeAt > HEALTH_STALE_MS;
      if (!stale) continue;
      pendingEntries.push({
        draftId: draft.id,
        hostId,
        hostName: draft.name,
        primitiveId: record.id,
        primitiveLabel: record.label,
        reason: record.status === 'failed' ? 'failed' : 'stale_probe',
        staleDays: lastProbeAt ? Math.floor((now - lastProbeAt) / (24 * 60 * 60 * 1000)) : undefined,
      });
    }
    updateCapabilityPackageDraft(draft.id, (current) => {
      const currentManifest =
        current.manifest && typeof current.manifest === 'object'
          ? ({ ...(current.manifest as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const scoped = pendingEntries.filter((item) => item.draftId === draft.id);
      return {
        ...current,
        manifest: writeHealthCheckPendingManifest(currentManifest, scoped),
      };
    });
  }
  const state = readScannerState();
  state.healthCheckPending = pendingEntries;
  state.lastHealthScanAt = new Date().toISOString();
  writeScannerState(state);
  return { pending: pendingEntries.length };
}

export function listHealthCheckPending(): HealthCheckPendingEntry[] {
  const fromDrafts: HealthCheckPendingEntry[] = [];
  for (const draft of readCapabilityPackageDrafts()) {
    if (draft.type !== 'software_connection') continue;
    const manifest = draft.manifest && typeof draft.manifest === 'object' ? (draft.manifest as Record<string, unknown>) : {};
    fromDrafts.push(...readHealthCheckPending(manifest));
  }
  if (fromDrafts.length) return fromDrafts;
  return readScannerState().healthCheckPending;
}

export function markHealthPrompted(draftId: string): void {
  const state = readScannerState();
  state.lastHealthPromptAtByDraft[draftId] = new Date().toISOString();
  writeScannerState(state);
}

export function shouldPromptHealthCheck(draftId: string): boolean {
  const state = readScannerState();
  const last = state.lastHealthPromptAtByDraft[draftId];
  if (!last) return true;
  return Date.now() - Date.parse(last) > 24 * 60 * 60 * 1000;
}

export function startHostPrimitiveScanner(): { stop: () => void } {
  const run = () => {
    try {
      scanPromotions();
      scanHealthStale();
    } catch (e) {
      console.warn('[host-primitive-scanner]', e instanceof Error ? e.message : e);
    }
  };
  run();
  const timer = setInterval(run, HOST_PRIMITIVE_SCAN_INTERVAL_MS);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
  };
}

export function seedSendGateImportOnAllConnections(): void {
  for (const draft of readCapabilityPackageDrafts()) {
    if (draft.type !== 'software_connection') continue;
    const hostId = hostIdFromPackage(draft) || draft.id;
    updateCapabilityPackageDraft(draft.id, (current) => {
      const manifest =
        current.manifest && typeof current.manifest === 'object'
          ? ({ ...(current.manifest as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const existing = readHostPrimitivesFromManifest(manifest, hostId).find((item) => item.id === HOST_IMPORT_FILE_ID);
      if (existing) return current;
      return {
        ...current,
        manifest: mergeHostPrimitiveManifest(
          manifest,
          {
            id: HOST_IMPORT_FILE_ID,
            label: '导入文件',
            tier: 'primitive',
            probeKind: 'bridge_connected',
            seed: 'send_gate',
            status: 'pending',
          },
          hostId,
        ),
      };
    });
  }
}
