import { getBlenderBridgeStatus } from '../bridges/blenderBridgeInstall.js';
import { getUnrealBridgeStatus } from '../bridges/unrealBridgeInstall.js';
import { getMayaBridgeStatus } from '../bridges/mayaBridgeInstall.js';
import { runMayaScriptJob } from '../scriptRun/mayaScriptAdapter.js';
import { readCapabilityPackageDraft, updateCapabilityPackageDraft } from './capabilityPackageStore.js';
import {
  HOST_IMPORT_FILE_ID,
  ensureSendGateImportPrimitive,
  hostIdFromPackage,
  mergeHostPrimitiveManifest,
  readHostPrimitivesFromManifest,
  resolveDriverForPackage,
  syncDriverSeedPrimitives,
} from './hostPrimitives.js';
import type { SoftwareBridgeLifecycleInput, SoftwareBridgeLifecycleResult } from './softwareBridgeDriver.js';
import { recordHostPrimitiveUsageSuccess } from './hostPrimitiveScanner.js';

function bridgePortFromManifest(manifest: Record<string, unknown>): number {
  const install = manifest.lastInstall && typeof manifest.lastInstall === 'object' ? (manifest.lastInstall as Record<string, unknown>) : {};
  const result = install.result && typeof install.result === 'object' ? (install.result as Record<string, unknown>) : {};
  const candidates = [manifest.bridgePort, manifest.port, result.port, install.port];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

async function resolveBridgePort(hostId: string, manifest: Record<string, unknown>): Promise<number> {
  const fromManifest = bridgePortFromManifest(manifest);
  if (fromManifest) return fromManifest;
  if (hostId === 'blender') {
    const status = await getBlenderBridgeStatus();
    return status.port || status.defaultPort || 0;
  }
  if (hostId === 'unreal') {
    const status = await getUnrealBridgeStatus();
    return status.port || status.defaultPort || 0;
  }
  if (hostId === 'maya') {
    const status = getMayaBridgeStatus();
    return status.port || status.defaultPort || 0;
  }
  return 0;
}

async function postHttpBridgeImport(port: number, filePath: string): Promise<SoftwareBridgeLifecycleResult> {
  if (!port) {
    return { ok: false, error: 'missing_port', message: 'Bridge port is not configured.', softwareId: 'http' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/import_file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath, path: filePath }),
      signal: controller.signal,
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: true, message: String(json.message || 'File imported via bridge.'), softwareId: 'http' };
    }
    if (res.status === 404) {
      return {
        ok: true,
        message: 'Bridge has no import endpoint yet; file path staged for host script.',
        softwareId: 'http',
        staged: true,
        filePath,
      };
    }
    const text = await res.text().catch(() => '');
    return { ok: false, error: 'import_failed', message: text || `HTTP ${res.status}`, softwareId: 'http' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'import_failed', message: msg, softwareId: 'http' };
  } finally {
    clearTimeout(timer);
  }
}

function mayaImportScript(filePath: string): string {
  const escaped = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return [
    'import maya.cmds as cmds',
    'import os',
    `path = r'${escaped}'`,
    'ext = os.path.splitext(path)[1].lower()',
    'if ext == ".fbx":',
    '    cmds.file(path, i=True, type="FBX")',
    'elif ext in (".obj",):',
    '    cmds.file(path, i=True, type="OBJ")',
    'elif ext in (".ma", ".mb"):',
    '    cmds.file(path, i=True)',
    'elif ext in (".gltf", ".glb"):',
    '    try:',
    '        import maya.cmds as _cmds',
    '        _cmds.loadPlugin("mayaGLTF", quiet=True)',
    '    except Exception:',
    '        pass',
    '    cmds.file(path, i=True)',
    'else:',
    '    cmds.file(path, i=True)',
    'print("[AssetCutter] imported", path)',
  ].join('\n');
}

async function importViaMaya(filePath: string, manifest: Record<string, unknown>): Promise<SoftwareBridgeLifecycleResult> {
  const status = getMayaBridgeStatus();
  const port = bridgePortFromManifest(manifest) || status.port || status.defaultPort;
  const run = await runMayaScriptJob(
    {
      content: mayaImportScript(filePath),
      maya: { host: '127.0.0.1', port },
      timeoutMs: 120000,
    },
    {},
  );
  if ('error' in run) {
    return { ok: false, error: 'import_failed', message: run.error, softwareId: 'maya' };
  }
  return { ok: true, message: 'Imported file into Maya.', softwareId: 'maya', stdout: run.stdout };
}

async function invokeImportFile(
  hostId: string,
  manifest: Record<string, unknown>,
  params: Record<string, unknown>,
  input?: SoftwareBridgeLifecycleInput,
): Promise<SoftwareBridgeLifecycleResult> {
  const filePath = String(params.filePath || params.path || '').trim();
  if (!filePath) {
    return { ok: false, error: 'missing_file_path', message: 'filePath is required for host.import_file.', softwareId: hostId };
  }
  const driver = resolveDriverForPackage(readCapabilityPackageDraft(String(manifest.hostDraftId || '')) || null);
  if (driver && typeof driver.invokePrimitive === 'function') {
    return driver.invokePrimitive(HOST_IMPORT_FILE_ID, { ...params, filePath }, input);
  }
  if (hostId === 'maya') {
    return importViaMaya(filePath, manifest);
  }
  if (hostId === 'blender' || hostId === 'unreal') {
    const port = await resolveBridgePort(hostId, manifest);
    return postHttpBridgeImport(port, filePath);
  }
  return {
    ok: true,
    message: 'File path prepared for host import script.',
    softwareId: hostId,
    staged: true,
    filePath,
  };
}

export async function invokeHostPrimitive(
  draftId: string,
  primitiveId: string,
  params: Record<string, unknown> = {},
  input: SoftwareBridgeLifecycleInput = {},
): Promise<{ ok: true; result: SoftwareBridgeLifecycleResult; draft?: unknown } | { ok: false; error: string; message: string; result?: SoftwareBridgeLifecycleResult }> {
  const draft = readCapabilityPackageDraft(draftId);
  if (!draft || draft.type !== 'software_connection') {
    return { ok: false, error: 'capability_not_found', message: 'Software connection draft not found.' };
  }
  const hostId = hostIdFromPackage(draft) || draft.id;
  const manifest =
    draft.manifest && typeof draft.manifest === 'object'
      ? ({ ...(draft.manifest as Record<string, unknown>), hostDraftId: draftId } as Record<string, unknown>)
      : { hostDraftId: draftId };
  const driver = resolveDriverForPackage(draft);
  let nextManifest = syncDriverSeedPrimitives(manifest, driver, hostId, input);
  nextManifest = ensureSendGateImportPrimitive(nextManifest, hostId);
  const records = readHostPrimitivesFromManifest(nextManifest, hostId);
  const record = records.find((item) => item.id === primitiveId);
  if (!record) {
    return { ok: false, error: 'primitive_not_found', message: `Primitive ${primitiveId} is not registered.` };
  }

  let result: SoftwareBridgeLifecycleResult;
  if (primitiveId === HOST_IMPORT_FILE_ID) {
    result = await invokeImportFile(hostId, nextManifest, params, input);
  } else if (driver && typeof driver.invokePrimitive === 'function') {
    result = await driver.invokePrimitive(primitiveId, params, input);
  } else {
    result = { ok: false, error: 'unsupported_primitive', message: `Invoke not implemented for ${primitiveId}.`, softwareId: hostId };
  }

  if (result.ok) {
    recordHostPrimitiveUsageSuccess(draftId, hostId, primitiveId);
    const at = new Date().toISOString();
    updateCapabilityPackageDraft(draftId, (current) => {
      const currentManifest =
        current.manifest && typeof current.manifest === 'object'
          ? ({ ...(current.manifest as Record<string, unknown>) } as Record<string, unknown>)
          : nextManifest;
      return {
        ...current,
        manifest: mergeHostPrimitiveManifest(
          currentManifest,
          {
            ...record,
            usageSuccessCount: (record.usageSuccessCount || 0) + 1,
            lastProbeMessage: String(result.message || ''),
            ...(record.status === 'verified' ? { lastProbeAt: record.lastProbeAt || at } : {}),
          },
          hostId,
        ),
      };
    });
  }

  if (!result.ok) {
    return {
      ok: false,
      error: String(result.error || 'primitive_invoke_failed'),
      message: String(result.message || 'Host primitive invoke failed.'),
      result,
    };
  }
  return { ok: true, result };
}

export async function invokeHostImportFile(
  draftId: string,
  filePath: string,
  input: SoftwareBridgeLifecycleInput = {},
): Promise<{ ok: true; result: SoftwareBridgeLifecycleResult } | { ok: false; error: string; message: string; result?: SoftwareBridgeLifecycleResult }> {
  return invokeHostPrimitive(draftId, HOST_IMPORT_FILE_ID, { filePath }, input);
}
