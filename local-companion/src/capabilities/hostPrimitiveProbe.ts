import { getBlenderBridgeStatus } from '../bridges/blenderBridgeInstall.js';
import { getUnrealBridgeStatus } from '../bridges/unrealBridgeInstall.js';
import { getAdobeBridgeStatus } from '../bridges/adobeExtendScriptBridgeInstall.js';
import { getMayaBridgeStatus } from '../bridges/mayaBridgeInstall.js';
import { probeMayaCommandPort } from '../scriptRun/mayaScriptAdapter.js';
import { readCapabilityPackageDraft, updateCapabilityPackageDraft } from './capabilityPackageStore.js';
import {
  HOST_HTTP_HEALTH_ID,
  HOST_HEARTBEAT_ID,
  HOST_IMPORT_FILE_ID,
  HOST_PROBE_CAPABILITIES_ID,
  driverPrimitiveSeeds,
  ensureSendGateImportPrimitive,
  listMapVisiblePrimitives,
  mergeHostPrimitiveManifest,
  readHostPrimitivesFromManifest,
  hostIdFromPackage,
  resolveDriverForPackage,
  syncDriverSeedPrimitives,
  type HostPrimitiveRecord,
} from './hostPrimitives.js';
import type { SoftwareBridgeLifecycleInput, SoftwareBridgeLifecycleResult } from './softwareBridgeDriver.js';

type ProbeInput = SoftwareBridgeLifecycleInput & {
  confirmed?: boolean;
};

function bridgePortFromManifest(manifest: Record<string, unknown>, fallback = 0): number {
  const install = manifest.lastInstall && typeof manifest.lastInstall === 'object' ? (manifest.lastInstall as Record<string, unknown>) : {};
  const result = install.result && typeof install.result === 'object' ? (install.result as Record<string, unknown>) : {};
  const candidates = [manifest.bridgePort, manifest.port, result.port, install.port];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return fallback;
}

async function probeHttpHealth(hostId: string, port: number): Promise<SoftwareBridgeLifecycleResult> {
  if (!port) {
    if (hostId === 'blender') {
      const status = await getBlenderBridgeStatus();
      return status.probe.ok
        ? { ok: true, message: status.probe.message, softwareId: hostId }
        : { ok: false, error: 'probe_failed', message: status.probe.message, softwareId: hostId };
    }
    if (hostId === 'unreal') {
      const status = await getUnrealBridgeStatus();
      return status.probe.ok
        ? { ok: true, message: status.probe.message, softwareId: hostId }
        : { ok: false, error: 'probe_failed', message: status.probe.message, softwareId: hostId };
    }
    return { ok: false, error: 'missing_port', message: 'HTTP health probe requires bridge port.', softwareId: hostId };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: 'probe_failed', message: `HTTP ${res.status}`, softwareId: hostId };
    }
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok
      ? { ok: true, message: 'HTTP health ok', softwareId: hostId }
      : { ok: false, error: 'probe_failed', message: 'Invalid health payload', softwareId: hostId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'probe_failed', message: msg, softwareId: hostId };
  } finally {
    clearTimeout(timer);
  }
}

async function probeHeartbeat(hostId: string): Promise<SoftwareBridgeLifecycleResult> {
  if (hostId === 'photoshop') {
    const status = await getAdobeBridgeStatus('photoshop');
    return status.probe.ok
      ? { ok: true, message: status.probe.message, softwareId: hostId }
      : { ok: false, error: 'probe_failed', message: status.probe.message, softwareId: hostId };
  }
  if (hostId === 'maya') {
    const status = getMayaBridgeStatus();
    const port = status.port || status.defaultPort;
    const probe = await probeMayaCommandPort('127.0.0.1', port);
    return probe.ok
      ? { ok: true, message: probe.message, softwareId: hostId }
      : { ok: false, error: 'probe_failed', message: probe.message, softwareId: hostId };
  }
  const status = await getAdobeBridgeStatus(hostId);
  if (status && status.probe) {
    return status.probe.ok
      ? { ok: true, message: status.probe.message, softwareId: hostId }
      : { ok: false, error: 'probe_failed', message: status.probe.message, softwareId: hostId };
  }
  return { ok: false, error: 'unsupported_host', message: `Heartbeat probe unsupported for ${hostId}`, softwareId: hostId };
}

function outerRouteVerified(manifest: Record<string, unknown>, localVersionId?: string): boolean {
  const versions = Array.isArray(manifest.localVersions) ? manifest.localVersions : [];
  const version = cleanVersionId(localVersionId);
  if (version) {
    const row = versions.find((item) => item && typeof item === 'object' && String((item as Record<string, unknown>).id) === version);
    return Boolean(row && (row as Record<string, unknown>).status === 'verified');
  }
  return versions.some((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'verified');
}

function cleanVersionId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function probeRecord(
  record: HostPrimitiveRecord,
  hostId: string,
  manifest: Record<string, unknown>,
  driverInput: ProbeInput,
  draftId: string,
): Promise<SoftwareBridgeLifecycleResult> {
  const driver = resolveDriverForPackage(readCapabilityPackageDraft(draftId));
  if (driver && typeof driver.probePrimitive === 'function') {
    return driver.probePrimitive(record.id, driverInput);
  }
  const port = bridgePortFromManifest(manifest);
  switch (record.probeKind) {
    case 'http_health':
      return probeHttpHealth(hostId, port);
    case 'heartbeat':
      return probeHeartbeat(hostId);
    case 'capabilities_list': {
      const visible = listMapVisiblePrimitives(manifest, hostId);
      return visible.length
        ? { ok: true, message: `${visible.length} primitives registered`, softwareId: hostId, count: visible.length }
        : { ok: false, error: 'probe_failed', message: 'No primitives registered', softwareId: hostId };
    }
    case 'import_smoke':
    case 'bridge_connected':
    default:
      if (!outerRouteVerified(manifest, record.localVersionId || driverInput.localVersionId)) {
        return {
          ok: false,
          error: 'outer_route_unverified',
          message: '外线路未开通，不能验证此内线。',
          softwareId: hostId,
        };
      }
      if (record.id === HOST_IMPORT_FILE_ID) {
        if (hostId === 'blender' || hostId === 'unreal') {
          return probeHttpHealth(hostId, port);
        }
        if (hostId === 'maya') {
          return probeHeartbeat(hostId);
        }
        return { ok: true, message: 'Import route bound to verified outer route.', softwareId: hostId };
      }
      return { ok: true, message: 'Inner route verified via outer connection.', softwareId: hostId };
  }
}

function applyProbeResultToManifest(
  manifest: Record<string, unknown>,
  hostId: string,
  record: HostPrimitiveRecord,
  probe: SoftwareBridgeLifecycleResult,
): Record<string, unknown> {
  const at = new Date().toISOString();
  return mergeHostPrimitiveManifest(
    manifest,
    {
      ...record,
      status: probe.ok ? 'verified' : 'failed',
      lastProbeAt: at,
      lastProbeMessage: String(probe.message || probe.error || ''),
    },
    hostId,
  );
}

export async function probeHostPrimitive(
  draftId: string,
  primitiveId: string,
  input: ProbeInput = {},
): Promise<{ ok: true; result: SoftwareBridgeLifecycleResult; draft: unknown } | { ok: false; error: string; message: string; result?: SoftwareBridgeLifecycleResult }> {
  const draft = readCapabilityPackageDraft(draftId);
  if (!draft || draft.type !== 'software_connection') {
    return { ok: false, error: 'capability_not_found', message: 'Software connection draft not found.' };
  }
  const hostId = hostIdFromPackage(draft) || draft.id;
  const manifest =
    draft.manifest && typeof draft.manifest === 'object' ? ({ ...(draft.manifest as Record<string, unknown>) } as Record<string, unknown>) : {};
  const driver = resolveDriverForPackage(draft);
  let nextManifest = syncDriverSeedPrimitives(manifest, driver, hostId, input);
  nextManifest = ensureSendGateImportPrimitive(nextManifest, hostId);
  const records = readHostPrimitivesFromManifest(nextManifest, hostId);
  const localVersionId = cleanVersionId(input.localVersionId);
  const record =
    records.find((item) => item.id === primitiveId && (!localVersionId || !item.localVersionId || item.localVersionId === localVersionId)) ||
    records.find((item) => item.id === primitiveId);
  if (!record) {
    return { ok: false, error: 'primitive_not_found', message: `Primitive ${primitiveId} is not registered for this host.` };
  }
  const probe = await probeRecord(record, hostId, nextManifest, input, draftId);
  const updated = updateCapabilityPackageDraft(draftId, (current) => {
    const currentManifest =
      current.manifest && typeof current.manifest === 'object'
        ? ({ ...(current.manifest as Record<string, unknown>) } as Record<string, unknown>)
        : nextManifest;
    const mergedManifest = applyProbeResultToManifest(currentManifest, hostId, record, probe);
    const pending = Array.isArray(mergedManifest.healthCheckPending) ? mergedManifest.healthCheckPending : [];
    mergedManifest.healthCheckPending = pending.filter(
      (item) =>
        !(
          item &&
          typeof item === 'object' &&
          String((item as Record<string, unknown>).primitiveId || '') === primitiveId &&
          String((item as Record<string, unknown>).draftId || '') === draftId
        ),
    );
    return {
      ...current,
      manifest: mergedManifest,
    };
  });
  if (!probe.ok) {
    return {
      ok: false,
      error: String(probe.error || 'primitive_probe_failed'),
      message: String(probe.message || 'Host primitive probe failed.'),
      result: probe,
    };
  }
  return { ok: true, result: probe, draft: updated };
}

export async function probeSeedPrimitivesAfterOuterProbe(
  draftId: string,
  input: SoftwareBridgeLifecycleInput = {},
): Promise<void> {
  const draft = readCapabilityPackageDraft(draftId);
  if (!draft) return;
  const hostId = hostIdFromPackage(draft) || draft.id;
  const driver = resolveDriverForPackage(draft);
  updateCapabilityPackageDraft(draftId, (current) => {
    const manifest =
      current.manifest && typeof current.manifest === 'object'
        ? ({ ...(current.manifest as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    let next = syncDriverSeedPrimitives(manifest, driver, hostId, input);
    next = ensureSendGateImportPrimitive(next, hostId);
    return { ...current, manifest: next };
  });
  const seeds = driverPrimitiveSeeds(driver, input).filter((item) => (item.tier || 'primitive') === 'primitive');
  for (const seed of seeds) {
    await probeHostPrimitive(draftId, seed.id, input);
  }
}

export async function reprobeHostPrimitives(
  draftId: string,
  primitiveIds: string[],
  input: ProbeInput,
): Promise<{ ok: boolean; results: Array<{ primitiveId: string; ok: boolean; message: string }> }> {
  if (!input.confirmed) {
    return { ok: false, results: [] };
  }
  const results: Array<{ primitiveId: string; ok: boolean; message: string }> = [];
  for (const primitiveId of primitiveIds) {
    const probe = await probeHostPrimitive(draftId, primitiveId, { ...input, confirmed: true });
    results.push({
      primitiveId,
      ok: probe.ok,
      message: probe.ok ? String(probe.result.message || 'ok') : String(probe.message || probe.error || 'failed'),
    });
  }
  return { ok: results.every((item) => item.ok), results };
}
