import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  augmentRuntimeStatusWithLocalEngineProbes,
  buildCapabilitiesPayload,
  buildRuntimeStatus,
  listPlugins,
} from './pluginRegistry.js';
import {
  getRepositoryRoot,
  getRepositorySummary,
  getRepositoryShallowBytesUsed,
} from './repositoryVolume.js';
import { listProjectIds } from './storage/projectPaths.js';
import {
  deleteAsset,
  deleteAssetDirectory,
  ensureAssetVisibleObjectFile,
  getAssetMeta,
  getManifestJson,
  putAsset,
  readAssetObjectBytes,
  reconcileManifestOrphansFromDisk,
} from './storage/assetBlob.js';
import { openProjectFile, saveProjectFile } from './storage/projectFileIO.js';
import {
  createWorkspaceProjectInRepo,
  deleteWorkspaceProjectFromRepo,
  listWorkspaceTrashProjectsFromRepo,
  listWorkspaceProjectsFromRepo,
  renameWorkspaceProjectInRepo,
  restoreWorkspaceProjectFromTrash,
} from './storage/workspaceProjects.js';
import { readWorkflowSnapshot, writeWorkflowSnapshot } from './storage/workflowStore.js';
import { listRecentJobs, submitJob, getJob, deleteJob, listJobEvents } from './compute/jobsStore.js';
import { readRequestBodyRaw } from './httpReadBody.js';
import { outboundFetch } from './outboundFetch.js';
import {
  checkBearerAuthorization,
  isBearerExemptPath,
  isOriginAllowed,
  getEffectiveAllowedOriginEntries,
} from './accessGate.js';
import { getPairingSessionSummary, revokePairingSession } from './pairingSession.js';
import { installHostPluginBundleFromUrl, listInstalledHostPluginBundles } from './hostPluginBundles.js';
import {
  getShellToolDetail,
  installShellToolBundleFromUrl,
  installExampleShellTool,
  listBuiltinShellToolExampleIds,
  listInstalledShellTools,
  resolveExampleShellToolSourceDir,
  uninstallShellTool,
} from './shellToolBundles.js';
import {
  deleteAuthoredTool,
  getAuthoredHotState,
  importAuthoredFromZip,
  installAuthoredTool,
  listAuthoredTools,
  packAuthoredTool,
  scaffoldAuthoredTool,
  upsertAuthoredFiles,
} from './shellToolAuthored.js';
import { runShellTool } from './shellToolRun.js';
import { openShellToolInHost } from './shellToolOpenInHost.js';
import { validateShellToolPackageDir } from './shellToolSpec.js';
import {
  appendCapabilityPackageEvent,
  createCapabilityPackageDraft,
  deleteCapabilityPackageDraft,
  readCapabilityPackageDraft,
  readCapabilityPackageDrafts,
  updateCapabilityPackageDraft,
} from './capabilities/capabilityPackageStore.js';
import {
  installCapabilityPackage,
  probeCapabilityPackage,
  runCapabilityLifecycle,
  uninstallCapabilityPackage,
} from './capabilities/capabilityLifecycle.js';
import { attachSoftwareConnectionState } from './capabilities/softwareConnectionState.js';
import { buildCapabilityPackageContext } from './capabilities/capabilityContext.js';
import { checkCapabilityPublishGate } from './capabilities/capabilityPublishGate.js';
import {
  listActiveCapabilityCloudPackages,
  listCapabilityCloudVersions,
  publishCapabilityDraftToCloud,
  switchCapabilityCloudVersion,
} from './capabilities/capabilityCloudVersions.js';
import {
  exportCapabilityPackageTransfer,
  importCapabilityPackageTransfer,
} from './capabilities/capabilityTransfer.js';
import { summarizeWorkflowConnectors } from './capabilities/workflowConnectorSummary.js';
import { listWorkflowRuns } from './workflows/runtime/workflowRunHistory.js';
import { listWorkflowSkills } from './workflows/runtime/workflowSkills.js';
import { preflightWorkflowCapability, runWorkflowCapability } from './workflows/runWorkflowCapability.js';
import {
  archiveWorkflowDraft,
  createWorkflowDraft,
  getWorkflowDraft,
  listWorkflowDrafts,
  publishWorkflowDraftVersion,
  rollbackWorkflowDefaultVersion,
  saveWorkflowRunAsDraft,
  testRunWorkflowDraft,
  updateWorkflowDraft,
} from './workflows/workflowDrafts.js';
import {
  createWorkflowRepairSession,
  getWorkflowRepairSession,
  listWorkflowRepairSessions,
  selectWorkflowRepairScope,
} from './workflows/workflowRepairSessions.js';
import {
  createWorkflowPin,
  deleteWorkflowPin,
  listWorkflowPins,
} from './workflows/workflowPins.js';
import { probeSamSegmentBackendHealth } from './compute/samSegmentAdapter.js';
import { probeRembgPythonHealth } from './compute/rembgAdapter.js';
import { probePaddleOcrBackendHealth } from './compute/paddleOcrAdapter.js';
import { parseRuntimeProbeCacheTtlMs } from './runtimeProbeCacheTtl.js';
import { buildScriptConnectorsPayload } from './scriptRun/scriptConnectorsSnapshot.js';
import {
  getMayaBridgeStatus,
  installMayaBridge,
  listBridgesCatalog,
  uninstallMayaBridge,
} from './bridges/mayaBridgeInstall.js';
import {
  getBlenderBridgeStatus,
  installBlenderBridge,
  uninstallBlenderBridge,
} from './bridges/blenderBridgeInstall.js';
import {
  getMaxBridgeStatus,
  installMaxBridge,
  uninstallMaxBridge,
} from './bridges/maxBridgeInstall.js';
import {
  getSubstancePainterBridgeStatus,
  installSubstancePainterBridge,
  uninstallSubstancePainterBridge,
} from './bridges/substancePainterBridgeInstall.js';
import {
  getSubstanceDesignerBridgeStatus,
  installSubstanceDesignerBridge,
  uninstallSubstanceDesignerBridge,
} from './bridges/substanceDesignerBridgeInstall.js';
import {
  getHoudiniBridgeStatus,
  installHoudiniBridge,
  uninstallHoudiniBridge,
} from './bridges/houdiniBridgeInstall.js';
import {
  getNukeBridgeStatus,
  installNukeBridge,
  uninstallNukeBridge,
} from './bridges/nukeBridgeInstall.js';
import {
  getFoundryTimelineBridgeStatus,
  installFoundryTimelineBridge,
  uninstallFoundryTimelineBridge,
  type FoundryTimelineBridgeId,
} from './bridges/foundryTimelineBridgeInstall.js';
import {
  getCinema4DBridgeStatus,
  installCinema4DBridge,
  uninstallCinema4DBridge,
} from './bridges/cinema4dBridgeInstall.js';
import {
  getDavinciResolveBridgeStatus,
  installDavinciResolveBridge,
  uninstallDavinciResolveBridge,
} from './bridges/davinciResolveBridgeInstall.js';
import {
  getFusionStudioBridgeStatus,
  installFusionStudioBridge,
  uninstallFusionStudioBridge,
} from './bridges/fusionStudioBridgeInstall.js';
import {
  getAdobeBridgeStatus,
  installAdobeBridge,
  uninstallAdobeBridge,
  type AdobeBridgeId,
} from './bridges/adobeExtendScriptBridgeInstall.js';
import {
  getUnityBridgeStatus,
  installUnityBridge,
  uninstallUnityBridge,
} from './bridges/unityBridgeInstall.js';
import {
  getZBrushBridgeStatus,
  installZBrushBridge,
  uninstallZBrushBridge,
} from './bridges/zbrushBridgeInstall.js';
import {
  getUnrealBridgeStatus,
  installUnrealBridge,
  uninstallUnrealBridge,
} from './bridges/unrealBridgeInstall.js';
import {
  getRhinoBridgeStatus,
  installRhinoBridge,
  uninstallRhinoBridge,
} from './bridges/rhinoBridgeInstall.js';
import {
  getSketchUpBridgeStatus,
  installSketchUpBridge,
  uninstallSketchUpBridge,
} from './bridges/sketchupBridgeInstall.js';
import {
  getGodotBridgeStatus,
  installGodotBridge,
  uninstallGodotBridge,
} from './bridges/godotBridgeInstall.js';
import {
  getMotionBuilderBridgeStatus,
  installMotionBuilderBridge,
  uninstallMotionBuilderBridge,
} from './bridges/motionBuilderBridgeInstall.js';
import {
  getFusion360BridgeStatus,
  installFusion360Bridge,
  uninstallFusion360Bridge,
} from './bridges/fusion360BridgeInstall.js';
import {
  getKeyShotBridgeStatus,
  installKeyShotBridge,
  uninstallKeyShotBridge,
} from './bridges/keyshotBridgeInstall.js';
import {
  getMarmosetToolbagBridgeStatus,
  installMarmosetToolbagBridge,
  uninstallMarmosetToolbagBridge,
} from './bridges/marmosetToolbagBridgeInstall.js';
import {
  getModoBridgeStatus,
  installModoBridge,
  uninstallModoBridge,
} from './bridges/modoBridgeInstall.js';
import {
  getLightWaveBridgeStatus,
  installLightWaveBridge,
  uninstallLightWaveBridge,
} from './bridges/lightwaveBridgeInstall.js';
import {
  getFreeCADBridgeStatus,
  installFreeCADBridge,
  uninstallFreeCADBridge,
} from './bridges/freecadBridgeInstall.js';
import {
  getAutoCADBridgeStatus,
  installAutoCADBridge,
  uninstallAutoCADBridge,
} from './bridges/autocadBridgeInstall.js';
import {
  getKritaBridgeStatus,
  installKritaBridge,
  uninstallKritaBridge,
} from './bridges/kritaBridgeInstall.js';
import {
  getMariBridgeStatus,
  installMariBridge,
  uninstallMariBridge,
} from './bridges/mariBridgeInstall.js';
import {
  getInkscapeBridgeStatus,
  installInkscapeBridge,
  uninstallInkscapeBridge,
} from './bridges/inkscapeBridgeInstall.js';
import {
  getGimpBridgeStatus,
  installGimpBridge,
  uninstallGimpBridge,
} from './bridges/gimpBridgeInstall.js';
import {
  getAsepriteBridgeStatus,
  installAsepriteBridge,
  uninstallAsepriteBridge,
} from './bridges/asepriteBridgeInstall.js';
import {
  getMohoBridgeStatus,
  installMohoBridge,
  uninstallMohoBridge,
} from './bridges/mohoBridgeInstall.js';
import {
  getToonBoomHarmonyBridgeStatus,
  installToonBoomHarmonyBridge,
  uninstallToonBoomHarmonyBridge,
} from './bridges/toonBoomHarmonyBridgeInstall.js';
import {
  getOpenToonzBridgeStatus,
  installOpenToonzBridge,
  uninstallOpenToonzBridge,
} from './bridges/openToonzBridgeInstall.js';
import {
  getCavalryBridgeStatus,
  installCavalryBridge,
  uninstallCavalryBridge,
} from './bridges/cavalryBridgeInstall.js';
import {
  getCloMarvelousBridgeStatus,
  installCloMarvelousBridge,
  uninstallCloMarvelousBridge,
  type CloMarvelousBridgeId,
} from './bridges/cloMarvelousBridgeInstall.js';
import {
  getRizomUvBridgeStatus,
  installRizomUvBridge,
  uninstallRizomUvBridge,
} from './bridges/rizomUvBridgeInstall.js';
import {
  getDazStudioBridgeStatus,
  installDazStudioBridge,
  uninstallDazStudioBridge,
} from './bridges/dazStudioBridgeInstall.js';
import {
  getPoserBridgeStatus,
  installPoserBridge,
  uninstallPoserBridge,
} from './bridges/poserBridgeInstall.js';
import {
  getReallusionBridgeStatus,
  installReallusionBridge,
  uninstallReallusionBridge,
  type ReallusionBridgeId,
} from './bridges/reallusionBridgeInstall.js';
import {
  getMetashapeBridgeStatus,
  installMetashapeBridge,
  uninstallMetashapeBridge,
} from './bridges/metashapeBridgeInstall.js';
import {
  getThreeDequalizerBridgeStatus,
  installThreeDequalizerBridge,
  uninstallThreeDequalizerBridge,
} from './bridges/threeDequalizerBridgeInstall.js';
import {
  getKatanaBridgeStatus,
  installKatanaBridge,
  uninstallKatanaBridge,
} from './bridges/katanaBridgeInstall.js';
import {
  getLightroomBridgeStatus,
  installLightroomBridge,
  uninstallLightroomBridge,
} from './bridges/lightroomBridgeInstall.js';
import {
  getDarktableBridgeStatus,
  installDarktableBridge,
  uninstallDarktableBridge,
} from './bridges/darktableBridgeInstall.js';
import {
  getNatronBridgeStatus,
  installNatronBridge,
  uninstallNatronBridge,
} from './bridges/natronBridgeInstall.js';
import {
  getObsStudioBridgeStatus,
  installObsStudioBridge,
  uninstallObsStudioBridge,
} from './bridges/obsStudioBridgeInstall.js';
import {
  getReaperBridgeStatus,
  installReaperBridge,
  uninstallReaperBridge,
} from './bridges/reaperBridgeInstall.js';
import {
  getVegasProBridgeStatus,
  installVegasProBridge,
  uninstallVegasProBridge,
} from './bridges/vegasProBridgeInstall.js';
import {
  getTvPaintBridgeStatus,
  installTvPaintBridge,
  uninstallTvPaintBridge,
} from './bridges/tvPaintBridgeInstall.js';
import {
  getSynfigBridgeStatus,
  installSynfigBridge,
  uninstallSynfigBridge,
} from './bridges/synfigBridgeInstall.js';
import {
  buildHostBridgeAcceptanceSummary,
  readHostBridgeAcceptance,
  writeHostBridgeAcceptanceRecord,
} from './bridges/hostBridgeAcceptance.js';
import { closeHostApp, launchHostApp, saveRunningHostTarget } from './bridges/hostAppProcess.js';
import {
  activeHostBridgeCloudVersion,
  installHostBridgeCloud,
  listHostBridgeCloudVersions,
  probeHostBridgeCloud,
  publishHostBridgeDraftToCloud,
  switchHostBridgeCloudVersion,
  syncHostBridgeCloudVersionsFromRemote,
  uninstallHostBridgeCloud,
} from './bridges/hostBridgeCloud.js';
import {
  createHostBridgeDraft,
  deleteHostBridgeDraft,
  installHostBridgeDraft,
  probeHostBridgeDraft,
  readHostBridgeDraft,
  readHostBridgeDrafts,
  uninstallHostBridgeDraft,
  validateHostBridgeDraft,
} from './bridges/hostBridgeDrafts.js';

let runtimeEngineProbesCache: {
  at: number;
  sam: Awaited<ReturnType<typeof probeSamSegmentBackendHealth>>;
  rembg: Awaited<ReturnType<typeof probeRembgPythonHealth>>;
  paddleOcr: Awaited<ReturnType<typeof probePaddleOcrBackendHealth>>;
} | null = null;

async function getCachedEngineProbes(): Promise<{
  sam: Awaited<ReturnType<typeof probeSamSegmentBackendHealth>>;
  rembg: Awaited<ReturnType<typeof probeRembgPythonHealth>>;
  paddleOcr: Awaited<ReturnType<typeof probePaddleOcrBackendHealth>>;
}> {
  const ttlMs = parseRuntimeProbeCacheTtlMs();
  const now = Date.now();
  if (ttlMs > 0 && runtimeEngineProbesCache && now - runtimeEngineProbesCache.at < ttlMs) {
    return runtimeEngineProbesCache;
  }
  const [sam, rembg, paddleOcr] = await Promise.all([
    probeSamSegmentBackendHealth(),
    probeRembgPythonHealth(),
    probePaddleOcrBackendHealth(),
  ]);
  runtimeEngineProbesCache = { at: now, sam, rembg, paddleOcr };
  return runtimeEngineProbesCache;
}

let cachedIndexHtml: string | null = null;

function withHostBridgeAcceptance<T extends { id: string }>(status: T): T & { acceptance: unknown } {
  return { ...status, acceptance: readHostBridgeAcceptance()[status.id] || null };
}

async function getBuiltInHostBridgeStatus(id: string): Promise<any | null> {
  const simple: Record<string, () => any | Promise<any>> = {
    maya: getMayaBridgeStatus,
    blender: getBlenderBridgeStatus,
    '3ds-max': getMaxBridgeStatus,
    'substance-painter': getSubstancePainterBridgeStatus,
    'substance-designer': getSubstanceDesignerBridgeStatus,
    krita: getKritaBridgeStatus,
    mari: getMariBridgeStatus,
    inkscape: getInkscapeBridgeStatus,
    gimp: getGimpBridgeStatus,
    aseprite: getAsepriteBridgeStatus,
    moho: getMohoBridgeStatus,
    'toon-boom-harmony': getToonBoomHarmonyBridgeStatus,
    opentoonz: getOpenToonzBridgeStatus,
    cavalry: getCavalryBridgeStatus,
    tvpaint: getTvPaintBridgeStatus,
    houdini: getHoudiniBridgeStatus,
    nuke: getNukeBridgeStatus,
    natron: getNatronBridgeStatus,
    'obs-studio': getObsStudioBridgeStatus,
    reaper: getReaperBridgeStatus,
    'vegas-pro': getVegasProBridgeStatus,
    synfig: getSynfigBridgeStatus,
    'cinema-4d': getCinema4DBridgeStatus,
    'davinci-resolve': getDavinciResolveBridgeStatus,
    'fusion-studio': getFusionStudioBridgeStatus,
    modo: getModoBridgeStatus,
    lightwave: getLightWaveBridgeStatus,
    freecad: getFreeCADBridgeStatus,
    autocad: getAutoCADBridgeStatus,
    'lightroom-classic': getLightroomBridgeStatus,
    darktable: getDarktableBridgeStatus,
    unity: getUnityBridgeStatus,
    zbrush: getZBrushBridgeStatus,
    unreal: getUnrealBridgeStatus,
    rhino: getRhinoBridgeStatus,
    sketchup: getSketchUpBridgeStatus,
    rizomuv: getRizomUvBridgeStatus,
    'daz-studio': getDazStudioBridgeStatus,
    poser: getPoserBridgeStatus,
    metashape: getMetashapeBridgeStatus,
    '3dequalizer': getThreeDequalizerBridgeStatus,
    katana: getKatanaBridgeStatus,
    godot: getGodotBridgeStatus,
    motionbuilder: getMotionBuilderBridgeStatus,
    'fusion-360': getFusion360BridgeStatus,
    keyshot: getKeyShotBridgeStatus,
    'marmoset-toolbag': getMarmosetToolbagBridgeStatus,
  };
  if (simple[id]) return await simple[id]();
  if (id === 'nuke-studio' || id === 'hiero') return await getFoundryTimelineBridgeStatus(id);
  if (
    id === 'photoshop' ||
    id === 'illustrator' ||
    id === 'after-effects' ||
    id === 'premiere' ||
    id === 'indesign' ||
    id === 'audition' ||
    id === 'media-encoder' ||
    id === 'animate' ||
    id === 'adobe-bridge'
  ) {
    return await getAdobeBridgeStatus(id as AdobeBridgeId);
  }
  if (id === 'marvelous-designer' || id === 'clo') return await getCloMarvelousBridgeStatus(id as CloMarvelousBridgeId);
  if (id === 'iclone' || id === 'character-creator') return await getReallusionBridgeStatus(id as ReallusionBridgeId);
  return null;
}

function probeResultFromBridgeStatus(status: any): { connected: boolean; message: string } {
  const probe = status && typeof status === 'object' ? status.probe : null;
  const connected = Boolean(probe && probe.ok === true);
  const message =
    (probe && typeof probe.message === 'string' && probe.message) ||
    (typeof status?.message === 'string' && status.message) ||
    (connected ? '真实连接探测成功。' : '真实连接尚未成功，请启动宿主并加载桥接后再探测。');
  return { connected, message };
}

/** 桌面壳 spawn 的 cwd 恒为伴侣根目录；bundle 为 `<bundle>/public`，源码为 `local-companion/public` */
function resolvePublicIndexHtmlPath(): string {
  const fromCwd = join(process.cwd(), 'public', 'index.html');
  if (existsSync(fromCwd)) return fromCwd;
  const here = dirname(fileURLToPath(import.meta.url));
  // CJS 单文件 bundle：main.cjs 与 public/ 同级；tsx 源码：src/ → ../public
  const candidates = [join(here, 'public', 'index.html'), join(here, '..', 'public', 'index.html')];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function loadIndexHtml(): string {
  if (cachedIndexHtml) return cachedIndexHtml;
  const p = resolvePublicIndexHtmlPath();
  cachedIndexHtml = readFileSync(p, 'utf8');
  return cachedIndexHtml;
}

function readOrigin(req: IncomingMessage): string | undefined {
  const h = req.headers.origin;
  return typeof h === 'string' ? h : undefined;
}

function sendJson(
  res: ServerResponse,
  code: number,
  body: unknown,
  origin: string | undefined,
  extraHeaders?: Record<string, string>,
): void {
  const o = origin ?? '*';
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, html: string, origin?: string): void {
  const o = origin ?? '*';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': o,
  });
  res.end(html);
}

function preflight(res: ServerResponse, origin: string | undefined): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Disposition',
  });
  res.end();
}

function sendSseHeaders(res: ServerResponse, origin: string | undefined): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Expose-Headers': 'Content-Disposition',
  });
}

function sanitizeCompanionDownloadFilename(name: string): string {
  const s = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 120);
  return s || 'model.bin';
}

function guessCompanionAssetDownloadFilename(key: string, mime: string): string {
  const k = String(key || '').toLowerCase();
  const ct = String(mime || '').toLowerCase();
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return 'asset.jpg';
  if (ct.includes('image/png')) return 'asset.png';
  if (ct.includes('image/webp')) return 'asset.webp';
  if (ct.includes('image/gif')) return 'asset.gif';
  if (ct.includes('image/svg')) return 'asset.svg';
  if (ct.includes('video/mp4')) return 'asset.mp4';
  if (ct.includes('video/webm')) return 'asset.webm';
  if (ct.includes('video/quicktime')) return 'asset.mov';
  if (ct.includes('video/x-m4v')) return 'asset.m4v';
  if (ct.includes('text/plain')) return 'asset.txt';
  if (k.includes('fbx') || ct.includes('fbx')) return 'model.fbx';
  if (k.includes('gltf') || ct.includes('gltf+json')) return 'model.gltf';
  if (ct.includes('gltf-binary') || ct.includes('model/gltf')) return 'model.glb';
  return 'asset.bin';
}

function sniffMediaMimeFromHead(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    return 'video/mp4';
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'video/webm';
  }
  return null;
}

function normalizeImportedContentType(header: string | null, body: Buffer): string {
  const ct = String(header || '').split(';')[0]!.trim().toLowerCase();
  if (ct && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream') return ct;
  return sniffMediaMimeFromHead(body) || 'application/octet-stream';
}

function extensionFromCompanionMime(mime: string): string {
  const guessed = guessCompanionAssetDownloadFilename('', mime);
  const dot = guessed.lastIndexOf('.');
  return dot >= 0 ? guessed.slice(dot) : '.bin';
}

function ensureCompanionDownloadFilename(hinted: string | null, key: string, mime: string): string {
  const base = sanitizeCompanionDownloadFilename(
    hinted?.trim() ? hinted : guessCompanionAssetDownloadFilename(key, mime)
  );
  if (/\.[a-z0-9]{2,8}$/i.test(base)) return base;
  return `${base}${extensionFromCompanionMime(mime)}`;
}

function openFolderInSystem(folderPath: string): { ok: true } | { error: string; code: string } {
  try {
    const platform = process.platform;
    const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [folderPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { ok: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'open_folder_failed',
      code: 'STORAGE_OPEN_FOLDER_FAILED',
    };
  }
}

function writeSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  httpPort: number,
): Promise<void> {
  const origin = readOrigin(req);
  const urlStr = req.url || '/';
  const method = (req.method ?? 'GET').toUpperCase();
  const u = new URL(urlStr, 'http://127.0.0.1');
  const path = u.pathname;

  if (method === 'OPTIONS') {
    if (!isOriginAllowed(origin, getEffectiveAllowedOriginEntries())) {
      sendJson(res, 403, { error: 'origin_not_allowed', code: 'AUTH_ORIGIN_DENIED' }, origin);
      return;
    }
    preflight(res, origin);
    return;
  }

  if (!isOriginAllowed(origin, getEffectiveAllowedOriginEntries())) {
    sendJson(res, 403, { error: 'origin_not_allowed', code: 'AUTH_ORIGIN_DENIED' }, origin);
    return;
  }

  if (!isBearerExemptPath(path, method, origin)) {
    const ah = req.headers.authorization;
    const ahv = Array.isArray(ah) ? ah[0] : ah;
    const bc = checkBearerAuthorization(ahv);
    if (bc !== 'ok') {
      const code =
        bc === 'missing' ? 'AUTH_TOKEN_REQUIRED' : bc === 'revoked' ? 'AUTH_TOKEN_REVOKED' : 'AUTH_TOKEN_INVALID';
      const err = bc === 'missing' ? 'bearer_required' : bc === 'revoked' ? 'bearer_revoked' : 'bearer_invalid';
      sendJson(res, 401, { error: err, code }, origin, { 'WWW-Authenticate': 'Bearer' });
      return;
    }
  }

  try {
    if (path === '/v1/health' && method === 'GET') {
      sendJson(
        res,
        200,
        { ok: true, service: 'assetcutter-local-companion', time: new Date().toISOString() },
        origin,
      );
      return;
    }

    if (path === '/v1/capabilities' && method === 'GET') {
      sendJson(res, 200, buildCapabilitiesPayload(), origin);
      return;
    }

    if (path === '/v1/workflows/skills' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        workflows: listWorkflowSkills().map((workflow) => ({
          ...workflow,
          connectorSummaries: summarizeWorkflowConnectors(workflow),
        })),
      }, origin);
      return;
    }

    if (path === '/v1/workflows/runs' && method === 'GET') {
      sendJson(res, 200, { ok: true, runs: listWorkflowRuns() }, origin);
      return;
    }

    if (path === '/v1/workflows/repair-sessions' && method === 'GET') {
      sendJson(res, 200, { ok: true, repairSessions: listWorkflowRepairSessions() }, origin);
      return;
    }

    if (path === '/v1/workflows/pins' && method === 'GET') {
      const scope = u.searchParams.get('scope') || undefined;
      sendJson(res, 200, {
        ok: true,
        pins: listWorkflowPins({
          scope: scope === 'home' ||
            scope === 'project' ||
            scope === 'connection' ||
            scope === 'object' ||
            scope === 'workspace'
            ? scope
            : undefined,
        }),
      }, origin);
      return;
    }

    if (path === '/v1/workflows/pins' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const scope = body.scope && typeof body.scope === 'object' && !Array.isArray(body.scope)
        ? body.scope as Parameters<typeof createWorkflowPin>[0]['scope']
        : null;
      const versionPolicy = body.versionPolicy && typeof body.versionPolicy === 'object' && !Array.isArray(body.versionPolicy)
        ? body.versionPolicy as Parameters<typeof createWorkflowPin>[0]['versionPolicy']
        : undefined;
      if (!scope || typeof body.workflowId !== 'string') {
        sendJson(res, 400, { ok: false, error: 'workflow_pin_invalid_body' }, origin);
        return;
      }
      const result = createWorkflowPin({
        pinId: typeof body.pinId === 'string' ? body.pinId : undefined,
        scope,
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
        versionPolicy,
        workflowId: body.workflowId,
      });
      sendJson(res, result.ok ? 201 : 400, result, origin);
      return;
    }

    const workflowPinMatch = path.match(/^\/v1\/workflows\/pins\/([^/]+)$/);
    if (workflowPinMatch && method === 'DELETE') {
      const result = deleteWorkflowPin({
        pinId: decodeURIComponent(workflowPinMatch[1]!),
      });
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    const workflowRepairSessionMatch = path.match(/^\/v1\/workflows\/repair-sessions\/([^/]+)$/);
    if (workflowRepairSessionMatch && method === 'GET') {
      const result = getWorkflowRepairSession(decodeURIComponent(workflowRepairSessionMatch[1]!));
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    if (workflowRepairSessionMatch && method === 'PATCH') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const scope = body.scope === 'run_only' ||
        body.scope === 'update_draft' ||
        body.scope === 'new_version' ||
        body.scope === 'rollback_default_version'
        ? body.scope
        : null;
      if (!scope) {
        sendJson(res, 400, { ok: false, error: 'workflow_repair_scope_invalid' }, origin);
        return;
      }
      const result = selectWorkflowRepairScope({
        scope,
        sessionId: decodeURIComponent(workflowRepairSessionMatch[1]!),
      });
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    if (path === '/v1/workflows/drafts' && method === 'GET') {
      sendJson(res, 200, { ok: true, drafts: listWorkflowDrafts() }, origin);
      return;
    }

    if (path === '/v1/workflows/drafts' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const source = body.source && typeof body.source === 'object' && !Array.isArray(body.source)
        ? body.source as Parameters<typeof createWorkflowDraft>[0]['source']
        : undefined;
      const result = createWorkflowDraft({
        description: typeof body.description === 'string' ? body.description : undefined,
        draftId: typeof body.draftId === 'string' ? body.draftId : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
        source,
        workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      });
      sendJson(res, result.ok ? 201 : 400, result, origin);
      return;
    }

    const workflowDraftTestRunMatch = path.match(/^\/v1\/workflows\/drafts\/([^/]+)\/test-run$/);
    if (workflowDraftTestRunMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = await testRunWorkflowDraft({
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        draftId: decodeURIComponent(workflowDraftTestRunMatch[1]!),
        params: body.params && typeof body.params === 'object' && !Array.isArray(body.params)
          ? body.params as Record<string, unknown>
          : undefined,
      });
      sendJson(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    const workflowDraftPublishMatch = path.match(/^\/v1\/workflows\/drafts\/([^/]+)\/publish$/);
    if (workflowDraftPublishMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = publishWorkflowDraftVersion({
        changeSummary: typeof body.changeSummary === 'string' ? body.changeSummary : undefined,
        draftId: decodeURIComponent(workflowDraftPublishMatch[1]!),
        semver: typeof body.semver === 'string' ? body.semver : undefined,
      });
      sendJson(res, result.ok ? 201 : 400, result, origin);
      return;
    }

    const workflowDraftMatch = path.match(/^\/v1\/workflows\/drafts\/([^/]+)$/);
    if (workflowDraftMatch && method === 'GET') {
      const result = getWorkflowDraft(decodeURIComponent(workflowDraftMatch[1]!));
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    if (workflowDraftMatch && method === 'PATCH') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = updateWorkflowDraft({
        defaultInput: body.defaultInput && typeof body.defaultInput === 'object' && !Array.isArray(body.defaultInput)
          ? body.defaultInput as Record<string, unknown>
          : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        draftId: decodeURIComponent(workflowDraftMatch[1]!),
        inputSchema: body.inputSchema && typeof body.inputSchema === 'object' && !Array.isArray(body.inputSchema)
          ? body.inputSchema as Parameters<typeof updateWorkflowDraft>[0]['inputSchema']
          : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
        requiredConnectors: Array.isArray(body.requiredConnectors)
          ? body.requiredConnectors as Parameters<typeof updateWorkflowDraft>[0]['requiredConnectors']
          : undefined,
        status:
          body.status === 'draft' ||
          body.status === 'ready_for_validation' ||
          body.status === 'validated' ||
          body.status === 'blocked'
            ? body.status
            : undefined,
      });
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    if (workflowDraftMatch && method === 'DELETE') {
      const result = archiveWorkflowDraft({
        draftId: decodeURIComponent(workflowDraftMatch[1]!),
      });
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    const workflowRollbackMatch = path.match(/^\/v1\/workflows\/([^/]+)\/rollback$/);
    if (workflowRollbackMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const versionId = typeof body.versionId === 'string' ? body.versionId : '';
      const result = rollbackWorkflowDefaultVersion({
        versionId,
        workflowId: decodeURIComponent(workflowRollbackMatch[1]!),
      });
      sendJson(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    const workflowRunSaveDraftMatch = path.match(/^\/v1\/workflows\/runs\/([^/]+)\/save-draft$/);
    if (workflowRunSaveDraftMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = saveWorkflowRunAsDraft({
        draftId: typeof body.draftId === 'string' ? body.draftId : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
        runId: decodeURIComponent(workflowRunSaveDraftMatch[1]!),
      });
      sendJson(res, result.ok ? 201 : 400, result, origin);
      return;
    }

    const workflowRunRepairSessionMatch = path.match(/^\/v1\/workflows\/runs\/([^/]+)\/repair-session$/);
    if (workflowRunRepairSessionMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = createWorkflowRepairSession({
        runId: decodeURIComponent(workflowRunRepairSessionMatch[1]!),
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      });
      sendJson(res, result.ok ? 201 : 400, result, origin);
      return;
    }

    const workflowPreflightMatch = path.match(/^\/v1\/workflows\/([^/]+)\/preflight$/);
    if (workflowPreflightMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = await preflightWorkflowCapability({
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        params: body.params,
        workflowId: decodeURIComponent(workflowPreflightMatch[1]!),
      });
      sendJson(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    const workflowRunMatch = path.match(/^\/v1\/workflows\/([^/]+)\/run$/);
    if (workflowRunMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = await runWorkflowCapability({
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        params: body.params,
        reusedFromRunId: typeof body.reusedFromRunId === 'string' ? body.reusedFromRunId : undefined,
        workflowId: decodeURIComponent(workflowRunMatch[1]!),
      });
      sendJson(res, result.ok ? 200 : 424, result, origin);
      return;
    }

    if (path === '/v1/capability-packages/drafts' && method === 'GET') {
      sendJson(res, 200, { drafts: readCapabilityPackageDrafts().map((draft) => attachSoftwareConnectionState(draft)) }, origin);
      return;
    }

    if (path === '/v1/capability-packages/cloud' && method === 'GET') {
      sendJson(res, 200, { packages: listActiveCapabilityCloudPackages(), versions: listCapabilityCloudVersions() }, origin);
      return;
    }

    if (path === '/v1/capability-packages/import' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = importCapabilityPackageTransfer(body.bundle || body);
      sendJson(res, result.ok ? 201 : 400, result, origin);
      return;
    }

    if (path === '/v1/capability-packages/drafts' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = createCapabilityPackageDraft({
        id: typeof body.id === 'string' ? body.id : undefined,
        type: body.type === 'software_connection' || body.type === 'tool' || body.type === 'workflow' ? body.type : undefined,
        name: typeof body.name === 'string' ? body.name : '',
        appName: typeof body.appName === 'string' ? body.appName : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        tags: Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean) : undefined,
        templateHint: typeof body.templateHint === 'string' ? body.templateHint : undefined,
        semver: typeof body.semver === 'string' ? body.semver : undefined,
        manifest: body.manifest && typeof body.manifest === 'object' && !Array.isArray(body.manifest) ? (body.manifest as Record<string, unknown>) : undefined,
        createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'copilot',
      });
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error, messages: result.messages }, origin);
        return;
      }
      sendJson(res, 201, { ok: true, draft: result.draft }, origin);
      return;
    }

    const capabilityTransferExportMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/export$/);
    if (capabilityTransferExportMatch && method === 'GET') {
      const result = exportCapabilityPackageTransfer(decodeURIComponent(capabilityTransferExportMatch[1]!));
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    const capabilityDraftDeleteMatch = path.match(/^\/v1\/capability-packages\/drafts\/([^/]+)$/);
    if (capabilityDraftDeleteMatch && method === 'DELETE') {
      const deleted = deleteCapabilityPackageDraft(decodeURIComponent(capabilityDraftDeleteMatch[1]!));
      sendJson(res, deleted ? 200 : 404, deleted ? { ok: true, deleted: true } : { error: 'draft_not_found' }, origin);
      return;
    }

    const capabilityLocalVersionMatch = path.match(/^\/v1\/capability-packages\/drafts\/([^/]+)\/local-version$/);
    if (capabilityLocalVersionMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' }, origin);
          return;
        }
      }
      const localVersionId = typeof body.localVersionId === 'string' ? body.localVersionId.trim() : '';
      if (!localVersionId) {
        sendJson(res, 400, { ok: false, error: 'local_version_id_required' }, origin);
        return;
      }
      const packageId = decodeURIComponent(capabilityLocalVersionMatch[1]!);
      const currentDraft = readCapabilityPackageDraft(packageId);
      if (!currentDraft) {
        sendJson(res, 404, { ok: false, error: 'draft_not_found' }, origin);
        return;
      }
      if (currentDraft.type !== 'software_connection') {
        sendJson(res, 400, { ok: false, error: 'not_software_connection' }, origin);
        return;
      }
      const currentManifest = currentDraft.manifest && typeof currentDraft.manifest === 'object' ? currentDraft.manifest : {};
      const versions = Array.isArray(currentManifest.localVersions) ? currentManifest.localVersions : [];
      const matched = versions.some((item) => item && typeof item === 'object' && String((item as Record<string, unknown>).id || '') === localVersionId);
      if (!matched) {
        sendJson(res, 400, { ok: false, error: 'local_version_not_found' }, origin);
        return;
      }
      const updated = updateCapabilityPackageDraft(packageId, (current) => {
        const manifest = current.manifest && typeof current.manifest === 'object' ? current.manifest : {};
        return {
          ...current,
          manifest: {
            ...manifest,
            currentLocalVersionId: localVersionId,
            ...(body.makeDefault === false ? {} : { defaultLocalVersionId: localVersionId }),
          },
        };
      });
      if (!updated) {
        sendJson(res, 404, { ok: false, error: 'draft_not_found' }, origin);
        return;
      }
      sendJson(res, 200, { ok: true, draft: attachSoftwareConnectionState(updated) }, origin);
      return;
    }

    const capabilityContextMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/context$/);
    if (capabilityContextMatch && method === 'GET') {
      const result = buildCapabilityPackageContext(decodeURIComponent(capabilityContextMatch[1]!));
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    const capabilityPublishGateMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/publish-gate$/);
    if (capabilityPublishGateMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = checkCapabilityPublishGate(decodeURIComponent(capabilityPublishGateMatch[1]!), {
        actorRole: typeof body.actorRole === 'string' ? body.actorRole : undefined,
        isAdmin: body.isAdmin === true,
        versionNote: typeof body.versionNote === 'string' ? body.versionNote : undefined,
      });
      sendJson(res, result.publishable ? 200 : result.code === 'capability_not_found' ? 404 : 422, result, origin);
      return;
    }

    const capabilityCloudVersionsMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/cloud-versions$/);
    if (capabilityCloudVersionsMatch && method === 'GET') {
      sendJson(res, 200, { versions: listCapabilityCloudVersions(decodeURIComponent(capabilityCloudVersionsMatch[1]!)) }, origin);
      return;
    }

    if (capabilityCloudVersionsMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = publishCapabilityDraftToCloud(decodeURIComponent(capabilityCloudVersionsMatch[1]!), {
        semver: typeof body.semver === 'string' ? body.semver : undefined,
        versionNote: typeof body.versionNote === 'string' ? body.versionNote : typeof body.note === 'string' ? body.note : undefined,
        actorRole: typeof body.actorRole === 'string' ? body.actorRole : undefined,
        isAdmin: body.isAdmin === true,
        publishedBy: typeof body.publishedBy === 'string' ? body.publishedBy : undefined,
      });
      sendJson(res, result.ok ? 201 : result.error === 'capability_not_found' ? 404 : 422, result, origin);
      return;
    }

    const capabilityCloudSwitchMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/cloud-versions\/([^/]+)\/activate$/);
    if (capabilityCloudSwitchMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = switchCapabilityCloudVersion(
        decodeURIComponent(capabilityCloudSwitchMatch[1]!),
        decodeURIComponent(capabilityCloudSwitchMatch[2]!),
        {
          actorRole: typeof body.actorRole === 'string' ? body.actorRole : undefined,
          isAdmin: body.isAdmin === true,
        },
      );
      sendJson(res, result.ok ? 200 : result.error === 'cloud_version_not_found' ? 404 : 403, result, origin);
      return;
    }

    const capabilityEventMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/events$/);
    if (capabilityEventMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const draft = appendCapabilityPackageEvent(decodeURIComponent(capabilityEventMatch[1]!), {
        kind: typeof body.kind === 'string' ? body.kind : 'event',
        ok: body.ok === true,
        message: typeof body.message === 'string' ? body.message : '',
        detail: body.detail,
      });
      if (!draft) {
        sendJson(res, 404, { ok: false, error: 'capability_not_found' }, origin);
        return;
      }
      sendJson(res, 200, { ok: true, draft }, origin);
      return;
    }

    const capabilityLifecycleMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/(install|probe|uninstall)$/);
    if (capabilityLifecycleMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const input = {
        targetDir: typeof body.targetDir === 'string' ? body.targetDir : undefined,
        scriptsDirs: Array.isArray(body.scriptsDirs) ? body.scriptsDirs.map(String).filter(Boolean) : undefined,
        port: Number.isFinite(Number(body.port)) ? Number(body.port) : undefined,
        executablePath: typeof body.executablePath === 'string' ? body.executablePath : undefined,
        targetId: typeof body.targetId === 'string' ? body.targetId : undefined,
        versionId: typeof body.versionId === 'string' ? body.versionId : undefined,
        localVersionId: typeof body.localVersionId === 'string' ? body.localVersionId : undefined,
      };
      const id = decodeURIComponent(capabilityLifecycleMatch[1]!);
      const action = capabilityLifecycleMatch[2]!;
      const result =
        action === 'install'
          ? await installCapabilityPackage(id, input)
          : action === 'probe'
            ? await probeCapabilityPackage(id, input)
            : await uninstallCapabilityPackage(id, input);
      if (!result.ok) {
        sendJson(res, action === 'probe' ? 424 : 422, result, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    const capabilityLifecycleRunMatch = path.match(/^\/v1\/capability-packages\/([^/]+)\/lifecycle$/);
    if (capabilityLifecycleRunMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const action = String(body.action || '').trim();
      const result = await runCapabilityLifecycle(decodeURIComponent(capabilityLifecycleRunMatch[1]!), action as any, {
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        historyPath: typeof body.historyPath === 'string' ? body.historyPath : undefined,
        targetDir: typeof body.targetDir === 'string' ? body.targetDir : undefined,
        scriptsDirs: Array.isArray(body.scriptsDirs) ? body.scriptsDirs.map(String).filter(Boolean) : undefined,
        port: Number.isFinite(Number(body.port)) ? Number(body.port) : undefined,
        actionId: typeof body.actionId === 'string' ? body.actionId : undefined,
        params: body.params,
        actorRole: typeof body.actorRole === 'string' ? body.actorRole : undefined,
        isAdmin: body.isAdmin === true,
        semver: typeof body.semver === 'string' ? body.semver : undefined,
        versionId: typeof body.versionId === 'string' ? body.versionId : undefined,
        localVersionId: typeof body.localVersionId === 'string' ? body.localVersionId : undefined,
        versionNote: typeof body.versionNote === 'string' ? body.versionNote : undefined,
        publishedBy: typeof body.publishedBy === 'string' ? body.publishedBy : undefined,
        currentStrategyId: typeof body.currentStrategyId === 'string' ? body.currentStrategyId : undefined,
      });
      if (!result.ok) {
        sendJson(res, action === 'probe' || action === 'run' ? 424 : 422, result, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/debug/sam-segment-health' && method === 'GET') {
      const payload = await probeSamSegmentBackendHealth();
      sendJson(res, 200, payload, origin);
      return;
    }

    if (path === '/v1/debug/rembg-health' && method === 'GET') {
      const payload = await probeRembgPythonHealth();
      sendJson(res, 200, payload, origin);
      return;
    }

    if (path === '/v1/debug/paddleocr-health' && method === 'GET') {
      const payload = await probePaddleOcrBackendHealth();
      sendJson(res, 200, payload, origin);
      return;
    }

    if (path === '/v1/runtime-status' && method === 'GET') {
      const base = buildRuntimeStatus(httpPort);
      const { sam: samProbe, rembg: rembgProbe, paddleOcr: paddleOcrProbe } = await getCachedEngineProbes();
      sendJson(res, 200, augmentRuntimeStatusWithLocalEngineProbes(base, samProbe, rembgProbe, paddleOcrProbe), origin);
      return;
    }

    if (path === '/v1/script-connectors' && method === 'GET') {
      const mayaHostRaw = u.searchParams.get('mayaHost');
      const mayaPortRaw = u.searchParams.get('mayaPort');
      const mayaPortParsed = mayaPortRaw != null && mayaPortRaw !== '' ? Number.parseInt(mayaPortRaw, 10) : NaN;
      const bustCache =
        u.searchParams.get('bustCache') === '1' || u.searchParams.get('force') === '1';
      const payload = await buildScriptConnectorsPayload({
        ...(mayaHostRaw != null && mayaHostRaw !== '' ? { mayaHost: mayaHostRaw } : {}),
        ...(Number.isFinite(mayaPortParsed) && mayaPortParsed > 0 ? { mayaPort: mayaPortParsed } : {}),
        ...(bustCache ? { bustCache: true } : {}),
      });
      sendJson(res, 200, payload, origin);
      return;
    }

    if (path === '/v1/bridges' && method === 'GET') {
      const acceptance = readHostBridgeAcceptance();
      sendJson(res, 200, { bridges: listBridgesCatalog(), acceptance, acceptanceSummary: buildHostBridgeAcceptanceSummary(acceptance) }, origin);
      return;
    }

    if (path === '/v1/bridges/drafts' && method === 'GET') {
      sendJson(res, 200, { drafts: readHostBridgeDrafts() }, origin);
      return;
    }

    if (path === '/v1/bridges/drafts' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const existingIds = listBridgesCatalog().filter((entry) => entry.source !== 'draft').map((entry) => entry.id);
      try {
        const result = createHostBridgeDraft(
          {
            id: typeof body.id === 'string' ? body.id : undefined,
            name: String(body.name || ''),
            category: typeof body.category === 'string' ? (body.category as never) : undefined,
            defaultPort: typeof body.defaultPort === 'number' ? body.defaultPort : undefined,
            connectorLabel: typeof body.connectorLabel === 'string' ? body.connectorLabel : undefined,
            templateId: typeof body.templateId === 'string' ? (body.templateId as never) : undefined,
            entryFile: typeof body.entryFile === 'string' ? body.entryFile : undefined,
            tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
            description: typeof body.description === 'string' ? body.description : undefined,
            createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'copilot',
          },
          existingIds,
        );
        if (!result.ok) {
          sendJson(res, 400, { error: result.error, messages: result.messages }, origin);
          return;
        }
        sendJson(res, 201, { ok: true, draft: result.draft }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { error: msg }, origin);
      }
      return;
    }

    const bridgeDraftValidateMatch = path.match(/^\/v1\/bridges\/drafts\/([^/]+)\/validate$/);
    if (bridgeDraftValidateMatch && method === 'POST') {
      const id = decodeURIComponent(bridgeDraftValidateMatch[1]!);
      const draft = readHostBridgeDrafts().find((item) => item.id === id);
      if (!draft) {
        sendJson(res, 404, { error: 'draft_not_found' }, origin);
        return;
      }
      const existingIds = listBridgesCatalog().filter((entry) => entry.source !== 'draft').map((entry) => entry.id);
      sendJson(res, 200, { ok: true, validation: validateHostBridgeDraft(draft, existingIds) }, origin);
      return;
    }

    const bridgeDraftDeleteMatch = path.match(/^\/v1\/bridges\/drafts\/([^/]+)$/);
    if (bridgeDraftDeleteMatch && method === 'DELETE') {
      const deleted = deleteHostBridgeDraft(decodeURIComponent(bridgeDraftDeleteMatch[1]!));
      sendJson(res, deleted ? 200 : 404, deleted ? { ok: true, deleted: true } : { error: 'draft_not_found' }, origin);
      return;
    }

    if (path === '/v1/bridges/cloud' && method === 'GET') {
      sendJson(res, 200, { versions: listHostBridgeCloudVersions() }, origin);
      return;
    }

    if (path === '/v1/bridges/cloud/sync' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const result = syncHostBridgeCloudVersionsFromRemote(Array.isArray(body.versions) ? (body.versions as never) : []);
      sendJson(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    const bridgeCloudPublishMatch = path.match(/^\/v1\/bridges\/([^/]+)\/cloud\/publish$/);
    if (bridgeCloudPublishMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const result = publishHostBridgeDraftToCloud(decodeURIComponent(bridgeCloudPublishMatch[1]!), {
        semver: typeof body.semver === 'string' ? body.semver : undefined,
        note: typeof body.note === 'string' ? body.note : undefined,
        publishedBy: typeof body.publishedBy === 'string' ? body.publishedBy : undefined,
      });
      sendJson(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    const bridgeCloudVersionsMatch = path.match(/^\/v1\/bridges\/([^/]+)\/cloud\/versions$/);
    if (bridgeCloudVersionsMatch && method === 'GET') {
      sendJson(res, 200, { versions: listHostBridgeCloudVersions(decodeURIComponent(bridgeCloudVersionsMatch[1]!)) }, origin);
      return;
    }

    const bridgeCloudSwitchMatch = path.match(/^\/v1\/bridges\/([^/]+)\/cloud\/versions\/([^/]+)\/activate$/);
    if (bridgeCloudSwitchMatch && method === 'POST') {
      const result = switchHostBridgeCloudVersion(
        decodeURIComponent(bridgeCloudSwitchMatch[1]!),
        decodeURIComponent(bridgeCloudSwitchMatch[2]!),
      );
      sendJson(res, result.ok ? 200 : 404, result, origin);
      return;
    }

    const bridgeProcessMatch = path.match(/^\/v1\/bridges\/([^/]+)\/(launch|close|discover-running)$/);
    if (bridgeProcessMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const hostId = decodeURIComponent(bridgeProcessMatch[1]!);
      const action = bridgeProcessMatch[2]!;
      const result =
        action === 'launch'
          ? launchHostApp(hostId, {
              executablePath: typeof body.executablePath === 'string' ? body.executablePath : undefined,
              versionId: typeof body.versionId === 'string' ? body.versionId : undefined,
              targetId: typeof body.targetId === 'string' ? body.targetId : undefined,
            })
          : action === 'discover-running'
            ? saveRunningHostTarget(hostId)
            : closeHostApp(hostId);
      sendJson(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    const bridgeDraftRuntimeMatch = path.match(/^\/v1\/bridges\/([^/]+)(?:\/(install|probe|uninstall))?$/);
    if (bridgeDraftRuntimeMatch) {
      const id = decodeURIComponent(bridgeDraftRuntimeMatch[1]!);
      const action = bridgeDraftRuntimeMatch[2] || 'status';
      const draft = readHostBridgeDraft(id);
      if (draft) {
        if (method === 'GET' && action === 'status') {
          sendJson(res, 200, { ...draft, installed: Boolean(draft.installs && draft.installs.length), installs: draft.installs || [] }, origin);
          return;
        }
        if (method === 'POST' && action === 'install') {
          const raw = await readRequestBodyRaw(req);
          let body: Record<string, unknown> = {};
          if (raw.length > 0) {
            try {
              body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
            } catch {
              sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
              return;
            }
          }
          const result = installHostBridgeDraft(id, {
            targetDir: typeof body.targetDir === 'string' ? body.targetDir : undefined,
            scriptsDir: typeof body.scriptsDir === 'string' ? body.scriptsDir : undefined,
            scriptsDirs: Array.isArray(body.scriptsDirs) ? body.scriptsDirs.map(String) : undefined,
            port: typeof body.port === 'number' ? body.port : undefined,
          });
          sendJson(res, result.ok ? 200 : 400, result, origin);
          return;
        }
        if (method === 'POST' && action === 'probe') {
          const result = await probeHostBridgeDraft(id);
          sendJson(res, result.ok ? 200 : 400, result, origin);
          return;
        }
        if (method === 'POST' && action === 'uninstall') {
          const result = uninstallHostBridgeDraft(id);
          sendJson(res, result.ok ? 200 : 400, result, origin);
          return;
        }
      }
      const cloud = activeHostBridgeCloudVersion(id);
      if (cloud) {
        if (method === 'GET' && action === 'status') {
          sendJson(res, 200, { ...cloud.definition, source: 'cloud', cloudVersion: cloud.semver, cloudVersionId: cloud.id }, origin);
          return;
        }
        if (method === 'POST' && action === 'install') {
          const raw = await readRequestBodyRaw(req);
          let body: Record<string, unknown> = {};
          if (raw.length > 0) {
            try {
              body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
            } catch {
              sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
              return;
            }
          }
          const result = installHostBridgeCloud(id, {
            targetDir: typeof body.targetDir === 'string' ? body.targetDir : undefined,
            scriptsDir: typeof body.scriptsDir === 'string' ? body.scriptsDir : undefined,
            scriptsDirs: Array.isArray(body.scriptsDirs) ? body.scriptsDirs.map(String) : undefined,
            port: typeof body.port === 'number' ? body.port : undefined,
          });
          sendJson(res, result.ok ? 200 : 400, result, origin);
          return;
        }
        if (method === 'POST' && action === 'probe') {
          const result = await probeHostBridgeCloud(id);
          sendJson(res, result.ok ? 200 : 400, result, origin);
          return;
        }
        if (method === 'POST' && action === 'uninstall') {
          const result = uninstallHostBridgeCloud(id);
          sendJson(res, result.ok ? 200 : 400, result, origin);
          return;
        }
      }
      if (method === 'POST' && action === 'probe') {
        const status = await getBuiltInHostBridgeStatus(id);
        if (status) {
          const probe = probeResultFromBridgeStatus(status);
          let acceptance: unknown = null;
          try {
            acceptance = writeHostBridgeAcceptanceRecord(id, {
              ok: probe.connected,
              message: probe.message,
            });
          } catch {
            acceptance = readHostBridgeAcceptance()[id] || null;
          }
          sendJson(res, 200, {
            ok: true,
            id,
            connected: probe.connected,
            message: probe.message,
            status,
            acceptance,
          }, origin);
          return;
        }
      }
    }

    if (path === '/v1/bridges/maya' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(getMayaBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/blender' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getBlenderBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/3ds-max' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getMaxBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/substance-painter' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getSubstancePainterBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/substance-designer' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getSubstanceDesignerBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/krita' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getKritaBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/mari' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getMariBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/inkscape' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getInkscapeBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/gimp' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getGimpBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/aseprite' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getAsepriteBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/moho' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getMohoBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/toon-boom-harmony' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getToonBoomHarmonyBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/opentoonz' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getOpenToonzBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/cavalry' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getCavalryBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/tvpaint' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getTvPaintBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/houdini' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getHoudiniBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/nuke' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getNukeBridgeStatus()), origin);
      return;
    }

    if ((path === '/v1/bridges/nuke-studio' || path === '/v1/bridges/hiero') && method === 'GET') {
      const id = path.endsWith('/hiero') ? 'hiero' : 'nuke-studio';
      sendJson(res, 200, withHostBridgeAcceptance(await getFoundryTimelineBridgeStatus(id)), origin);
      return;
    }

    if (path === '/v1/bridges/natron' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getNatronBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/obs-studio' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getObsStudioBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/reaper' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getReaperBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/vegas-pro' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getVegasProBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/synfig' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getSynfigBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/cinema-4d' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getCinema4DBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/davinci-resolve' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getDavinciResolveBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/fusion-studio' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getFusionStudioBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/modo' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getModoBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/lightwave' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getLightWaveBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/freecad' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getFreeCADBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/autocad' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getAutoCADBridgeStatus()), origin);
      return;
    }

    if (
      (path === '/v1/bridges/photoshop' ||
        path === '/v1/bridges/illustrator' ||
        path === '/v1/bridges/after-effects' ||
        path === '/v1/bridges/premiere' ||
        path === '/v1/bridges/indesign' ||
        path === '/v1/bridges/audition' ||
        path === '/v1/bridges/media-encoder' ||
        path === '/v1/bridges/animate' ||
        path === '/v1/bridges/adobe-bridge') &&
      method === 'GET'
    ) {
      const id = path.split('/').pop() as AdobeBridgeId;
      sendJson(res, 200, withHostBridgeAcceptance(await getAdobeBridgeStatus(id)), origin);
      return;
    }

    if (path === '/v1/bridges/lightroom-classic' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getLightroomBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/darktable' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getDarktableBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/unity' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getUnityBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/zbrush' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getZBrushBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/unreal' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getUnrealBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/rhino' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getRhinoBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/sketchup' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getSketchUpBridgeStatus()), origin);
      return;
    }

    if ((path === '/v1/bridges/marvelous-designer' || path === '/v1/bridges/clo') && method === 'GET') {
      const id = path.endsWith('/clo') ? 'clo' : 'marvelous-designer';
      sendJson(res, 200, withHostBridgeAcceptance(await getCloMarvelousBridgeStatus(id)), origin);
      return;
    }

    if (path === '/v1/bridges/rizomuv' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getRizomUvBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/daz-studio' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getDazStudioBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/poser' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getPoserBridgeStatus()), origin);
      return;
    }

    if ((path === '/v1/bridges/iclone' || path === '/v1/bridges/character-creator') && method === 'GET') {
      const id = path.endsWith('/iclone') ? 'iclone' : 'character-creator';
      sendJson(res, 200, withHostBridgeAcceptance(await getReallusionBridgeStatus(id)), origin);
      return;
    }

    if (path === '/v1/bridges/metashape' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getMetashapeBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/3dequalizer' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getThreeDequalizerBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/katana' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getKatanaBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/godot' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getGodotBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/motionbuilder' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getMotionBuilderBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/fusion-360' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getFusion360BridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/keyshot' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getKeyShotBridgeStatus()), origin);
      return;
    }

    if (path === '/v1/bridges/marmoset-toolbag' && method === 'GET') {
      sendJson(res, 200, withHostBridgeAcceptance(await getMarmosetToolbagBridgeStatus()), origin);
      return;
    }

    const bridgeAcceptanceMatch = path.match(/^\/v1\/bridges\/([^/]+)\/acceptance$/);
    if (bridgeAcceptanceMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      try {
        const rec = writeHostBridgeAcceptanceRecord(bridgeAcceptanceMatch[1]!, {
          ok: Boolean(body.ok),
          message: typeof body.message === 'string' ? body.message : '',
        });
        sendJson(res, 200, { ok: true, acceptance: rec }, origin);
      } catch (e) {
        const code = e instanceof Error ? e.message : String(e || 'acceptance_record_failed');
        sendJson(
          res,
          400,
          {
            ok: false,
            error: code,
            message:
              code === 'acceptance_evidence_required'
                ? '成功验收必须填写真实软件版本、路径或探测信号。'
                : code === 'acceptance_host_not_in_required_groups'
                  ? '该宿主不属于最终真实软件验收门禁，不能记录为成功验收。'
                  : '验收记录保存失败。',
          },
          origin,
        );
      }
      return;
    }

    if (path === '/v1/bridges/maya/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installMayaBridge({
        versions,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        const code = result.error === 'bridge_source_missing' ? 500 : 422;
        sendJson(res, code, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/maya/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const result = uninstallMayaBridge({ versions, scriptsDirs });
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/blender/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const startupDirs = Array.isArray(body.startupDirs)
        ? body.startupDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installBlenderBridge({
        versions,
        startupDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/blender/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const startupDirs = Array.isArray(body.startupDirs)
        ? body.startupDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallBlenderBridge({ versions, startupDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/3ds-max/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const startupDirs = Array.isArray(body.startupDirs)
        ? body.startupDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installMaxBridge({
        versions,
        startupDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/3ds-max/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const startupDirs = Array.isArray(body.startupDirs)
        ? body.startupDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallMaxBridge({ versions, startupDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/substance-painter/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installSubstancePainterBridge({
        targets,
        pluginDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/substance-painter/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallSubstancePainterBridge({ targets, pluginDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/substance-designer/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installSubstanceDesignerBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/substance-designer/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallSubstanceDesignerBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/krita/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installKritaBridge({
        targets,
        pluginDirs,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/krita/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallKritaBridge({ targets, pluginDirs, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/mari/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installMariBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/mari/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallMariBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/inkscape/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const extensionsDirs = Array.isArray(body.extensionsDirs)
        ? body.extensionsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installInkscapeBridge({
        targets,
        extensionsDirs,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/inkscape/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const extensionsDirs = Array.isArray(body.extensionsDirs)
        ? body.extensionsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallInkscapeBridge({ targets, extensionsDirs, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/gimp/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installGimpBridge({
        targets,
        pluginDirs,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/gimp/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallGimpBridge({ targets, pluginDirs, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/aseprite/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installAsepriteBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/aseprite/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallAsepriteBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/moho/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installMohoBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/moho/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallMohoBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/toon-boom-harmony/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installToonBoomHarmonyBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/toon-boom-harmony/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallToonBoomHarmonyBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/opentoonz/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installOpenToonzBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/opentoonz/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallOpenToonzBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/cavalry/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installCavalryBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/cavalry/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallCavalryBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/tvpaint/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : typeof body.targetDir === 'string' && body.targetDir.trim()
          ? [body.targetDir.trim()]
          : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installTvPaintBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/tvpaint/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallTvPaintBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/houdini/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const prefsDirs = Array.isArray(body.prefsDirs)
        ? body.prefsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installHoudiniBridge({
        targets,
        prefsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/houdini/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const prefsDirs = Array.isArray(body.prefsDirs)
        ? body.prefsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallHoudiniBridge({ targets, prefsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/nuke/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const userDirs = Array.isArray(body.userDirs)
        ? body.userDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installNukeBridge({
        targets,
        userDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/nuke/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const userDirs = Array.isArray(body.userDirs)
        ? body.userDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallNukeBridge({ targets, userDirs }), origin);
      return;
    }

    const foundryTimelineInstallMatch = path.match(/^\/v1\/bridges\/(nuke-studio|hiero)\/install$/);
    if (foundryTimelineInstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const userDirs = Array.isArray(body.userDirs)
        ? body.userDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installFoundryTimelineBridge(foundryTimelineInstallMatch[1] as FoundryTimelineBridgeId, {
        targets,
        userDirs,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    const foundryTimelineUninstallMatch = path.match(/^\/v1\/bridges\/(nuke-studio|hiero)\/uninstall$/);
    if (foundryTimelineUninstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const userDirs = Array.isArray(body.userDirs)
        ? body.userDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(
        res,
        200,
        uninstallFoundryTimelineBridge(foundryTimelineUninstallMatch[1] as FoundryTimelineBridgeId, {
          targets,
          userDirs,
          scriptsDirs,
        }),
        origin,
      );
      return;
    }

    if (path === '/v1/bridges/natron/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const userDirs = Array.isArray(body.userDirs)
        ? body.userDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installNatronBridge({
        targets,
        userDirs,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/natron/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const userDirs = Array.isArray(body.userDirs)
        ? body.userDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallNatronBridge({ targets, userDirs, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/obs-studio/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installObsStudioBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/obs-studio/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallObsStudioBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/reaper/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installReaperBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/reaper/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallReaperBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/vegas-pro/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installVegasProBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/vegas-pro/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallVegasProBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/synfig/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installSynfigBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/synfig/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallSynfigBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/cinema-4d/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installCinema4DBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/cinema-4d/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallCinema4DBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/davinci-resolve/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installDavinciResolveBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/davinci-resolve/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallDavinciResolveBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/fusion-studio/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installFusionStudioBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/fusion-studio/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallFusionStudioBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/rhino/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installRhinoBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/rhino/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallRhinoBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/sketchup/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installSketchUpBridge({
        targets,
        pluginDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/sketchup/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const pluginDirs = Array.isArray(body.pluginDirs)
        ? body.pluginDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallSketchUpBridge({ targets, pluginDirs }), origin);
      return;
    }

    const cloMarvelousInstallMatch = path.match(/^\/v1\/bridges\/(marvelous-designer|clo)\/install$/);
    if (cloMarvelousInstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installCloMarvelousBridge(cloMarvelousInstallMatch[1] as CloMarvelousBridgeId, {
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    const cloMarvelousUninstallMatch = path.match(/^\/v1\/bridges\/(marvelous-designer|clo)\/uninstall$/);
    if (cloMarvelousUninstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallCloMarvelousBridge(cloMarvelousUninstallMatch[1] as CloMarvelousBridgeId, { targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/rizomuv/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installRizomUvBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/rizomuv/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallRizomUvBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/daz-studio/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installDazStudioBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/daz-studio/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallDazStudioBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/poser/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installPoserBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/poser/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallPoserBridge({ targets, scriptsDirs }), origin);
      return;
    }

    const reallusionInstallMatch = path.match(/^\/v1\/bridges\/(iclone|character-creator)\/install$/);
    if (reallusionInstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installReallusionBridge(reallusionInstallMatch[1] as ReallusionBridgeId, {
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    const reallusionUninstallMatch = path.match(/^\/v1\/bridges\/(iclone|character-creator)\/uninstall$/);
    if (reallusionUninstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallReallusionBridge(reallusionUninstallMatch[1] as ReallusionBridgeId, { targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/metashape/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installMetashapeBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/metashape/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallMetashapeBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/3dequalizer/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installThreeDequalizerBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/3dequalizer/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallThreeDequalizerBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/katana/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installKatanaBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/katana/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallKatanaBridge({ targets, scriptsDirs }), origin);
      return;
    }

    const adobeInstallMatch = path.match(/^\/v1\/bridges\/(photoshop|illustrator|after-effects|premiere|indesign|audition|media-encoder|animate|adobe-bridge)\/install$/);
    if (adobeInstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installAdobeBridge(adobeInstallMatch[1] as AdobeBridgeId, {
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    const adobeUninstallMatch = path.match(/^\/v1\/bridges\/(photoshop|illustrator|after-effects|premiere|indesign|audition|media-encoder|animate|adobe-bridge)\/uninstall$/);
    if (adobeUninstallMatch && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallAdobeBridge(adobeUninstallMatch[1] as AdobeBridgeId, { targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/lightroom-classic/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installLightroomBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/lightroom-classic/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallLightroomBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/darktable/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const configDirs = Array.isArray(body.configDirs)
        ? body.configDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installDarktableBridge({
        targets,
        configDirs,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/darktable/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const configDirs = Array.isArray(body.configDirs)
        ? body.configDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallDarktableBridge({ targets, configDirs, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/unity/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const projectDirs = Array.isArray(body.projectDirs)
        ? body.projectDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installUnityBridge({
        targets,
        projectDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/unity/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const projectDirs = Array.isArray(body.projectDirs)
        ? body.projectDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallUnityBridge({ targets, projectDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/godot/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const projectDirs = Array.isArray(body.projectDirs)
        ? body.projectDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installGodotBridge({
        targets,
        projectDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/godot/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const projectDirs = Array.isArray(body.projectDirs)
        ? body.projectDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallGodotBridge({ targets, projectDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/motionbuilder/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const startupDirs = Array.isArray(body.startupDirs)
        ? body.startupDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installMotionBuilderBridge({
        versions,
        startupDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/motionbuilder/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const versions = Array.isArray(body.versions)
        ? body.versions.map((x) => String(x)).filter(Boolean)
        : undefined;
      const startupDirs = Array.isArray(body.startupDirs)
        ? body.startupDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallMotionBuilderBridge({ versions, startupDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/fusion-360/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const addinsDirs = Array.isArray(body.addinsDirs)
        ? body.addinsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installFusion360Bridge({
        targets,
        addinsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/fusion-360/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const addinsDirs = Array.isArray(body.addinsDirs)
        ? body.addinsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallFusion360Bridge({ targets, addinsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/keyshot/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installKeyShotBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/keyshot/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallKeyShotBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/marmoset-toolbag/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installMarmosetToolbagBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/marmoset-toolbag/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallMarmosetToolbagBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/modo/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installModoBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/modo/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallModoBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/lightwave/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installLightWaveBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/lightwave/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallLightWaveBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/freecad/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const modDirs = Array.isArray(body.modDirs)
        ? body.modDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installFreeCADBridge({
        targets,
        modDirs,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/freecad/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const modDirs = Array.isArray(body.modDirs)
        ? body.modDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallFreeCADBridge({ targets, modDirs, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/autocad/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installAutoCADBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/autocad/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallAutoCADBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/zbrush/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : typeof body.targetDir === 'string' && body.targetDir.trim()
          ? [body.targetDir.trim()]
          : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installZBrushBridge({
        targets,
        scriptsDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/zbrush/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const scriptsDirs = Array.isArray(body.scriptsDirs)
        ? body.scriptsDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallZBrushBridge({ targets, scriptsDirs }), origin);
      return;
    }

    if (path === '/v1/bridges/unreal/install' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const projectDirs = Array.isArray(body.projectDirs)
        ? body.projectDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      const portRaw = body.port != null ? Number(body.port) : undefined;
      const result = installUnrealBridge({
        targets,
        projectDirs,
        ...(Number.isFinite(portRaw as number) ? { port: portRaw as number } : {}),
      });
      if (!result.ok) {
        sendJson(res, 422, { error: result.error, message: result.message }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (path === '/v1/bridges/unreal/uninstall' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const targets = Array.isArray(body.targets)
        ? body.targets.map((x) => String(x)).filter(Boolean)
        : undefined;
      const projectDirs = Array.isArray(body.projectDirs)
        ? body.projectDirs.map((x) => String(x)).filter(Boolean)
        : undefined;
      sendJson(res, 200, uninstallUnrealBridge({ targets, projectDirs }), origin);
      return;
    }

    if (path === '/v1/pairing/session' && method === 'GET') {
      sendJson(res, 200, { pairing: getPairingSessionSummary() }, origin);
      return;
    }

    if (path === '/v1/pairing/revoke' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let reason = '';
      if (raw.length > 0) {
        try {
          const parsed = JSON.parse(raw.toString('utf8')) as { reason?: string };
          reason = typeof parsed.reason === 'string' ? parsed.reason : '';
        } catch {
          /* ignore bad JSON reason; still revoke */
        }
      }
      sendJson(res, 200, { pairing: revokePairingSession(reason || 'manual_api_revoke') }, origin);
      return;
    }

    if (path === '/v1/plugins' && method === 'GET') {
      sendJson(res, 200, { plugins: listPlugins() }, origin);
      return;
    }

    if (path === '/v1/host-plugins/bundles' && method === 'GET') {
      const bundles = await listInstalledHostPluginBundles();
      sendJson(res, 200, { bundles }, origin);
      return;
    }

    if (path === '/v1/host-plugins/install-from-url' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      try {
        const url = typeof body.url === 'string' ? body.url.trim() : '';
        const semver = typeof body.semver === 'string' ? body.semver.trim() : '';
        const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim() : '';
        const bytes = body.bytes;
        const label = typeof body.label === 'string' ? body.label : '';
        if (!url || !semver || !sha256) {
          sendJson(res, 400, { error: '缺少 url / semver / sha256', code: 'BAD_BODY' }, origin);
          return;
        }
        const result = await installHostPluginBundleFromUrl({
          url,
          semver,
          sha256Expected: sha256,
          bytesExpected: typeof bytes === 'number' ? bytes : Number(bytes),
          label,
        });
        sendJson(res, 200, { ok: true, manifest: result.manifest, bundlePath: result.bundlePath }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { error: msg, code: 'HOST_BUNDLE_INSTALL_FAILED' }, origin);
      }
      return;
    }

    const mShellToolRun = path.match(/^\/v1\/shell-tools\/([a-z][a-z0-9-]{1,63})\/run$/);
    if (mShellToolRun && method === 'POST') {
      const toolId = mShellToolRun[1]!;
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const actionId = typeof body.actionId === 'string' ? body.actionId : undefined;
      const params = body.params;
      const result = await runShellTool({ toolId, actionId, params });
      if (!result.ok) {
        const code =
          result.error === 'tool_not_found'
            ? 404
            : result.error === 'permission_denied'
              ? 403
              : result.error === 'run_timeout'
                ? 504
                : result.error === 'run_not_configured' || result.error === 'invalid_params'
                  ? 422
                  : 400;
        sendJson(res, code, { error: result.error }, origin);
        return;
      }
      sendJson(
        res,
        200,
        {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        origin,
      );
      return;
    }

    const mShellToolOpenInHost = path.match(
      /^\/v1\/shell-tools\/([a-z][a-z0-9-]{1,63})\/open-in-host$/,
    );
    const mShellToolOpenInMaya = path.match(
      /^\/v1\/shell-tools\/([a-z][a-z0-9-]{1,63})\/open-in-maya$/,
    );
    if ((mShellToolOpenInHost || mShellToolOpenInMaya) && method === 'POST') {
      const toolId = (mShellToolOpenInHost || mShellToolOpenInMaya)![1]!;
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const result = await openShellToolInHost(toolId, {
        host: mShellToolOpenInMaya ? 'maya' : typeof body.host === 'string' ? body.host : 'maya',
        mayaHost: typeof body.mayaHost === 'string' ? body.mayaHost : undefined,
        mayaPort: body.mayaPort as number | string | undefined,
      });
      if (!result.ok) {
        const code =
          result.error === 'tool_not_found'
            ? 404
            : result.error === 'permission_denied'
              ? 403
              : result.error === 'maya_not_connected'
                ? 503
                : result.error === 'maya_not_configured' || result.error === 'host_unsupported'
                  ? 422
                  : 400;
        sendJson(
          res,
          code,
          { error: result.error, message: result.message, code: result.code || result.error },
          origin,
        );
        return;
      }
      sendJson(
        res,
        200,
        { ok: true, host: result.host, message: result.message, stdout: result.stdout || '' },
        origin,
      );
      return;
    }

    // Authored routes must run before /v1/shell-tools/:id (id would otherwise match "authored").
    if (path === '/v1/shell-tools/authored' && method === 'GET') {
      const tools = await listAuthoredTools();
      sendJson(res, 200, { tools }, origin);
      return;
    }

    if (path === '/v1/shell-tools/authored/scaffold' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      try {
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        const result = await scaffoldAuthoredTool({
          id,
          name: typeof body.name === 'string' ? body.name : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
          overwrite: Boolean(body.overwrite),
        });
        let installed = null as Awaited<ReturnType<typeof installAuthoredTool>> | null;
        if (body.install !== false) {
          installed = await installAuthoredTool(result.toolId);
        }
        sendJson(
          res,
          200,
          { ok: true, toolId: result.toolId, path: result.path, installed: Boolean(installed), manifest: installed?.manifest },
          origin,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = msg === 'authored_exists' ? 409 : 400;
        sendJson(res, code, { error: msg }, origin);
      }
      return;
    }

    if (path === '/v1/shell-tools/authored' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      try {
        const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';
        const files = Array.isArray(body.files) ? body.files : [];
        const normalized = files.map((f) => {
          const row = f as { path?: unknown; content?: unknown };
          return { path: String(row.path || ''), content: String(row.content ?? '') };
        });
        const result = await upsertAuthoredFiles({ toolId, files: normalized });
        sendJson(res, 200, { ok: true, ...result, hot: getAuthoredHotState(result.toolId) }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { error: msg }, origin);
      }
      return;
    }

    if (path === '/v1/shell-tools/authored/import' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      try {
        const zipPath = typeof body.zipPath === 'string' ? body.zipPath.trim() : '';
        const result = await importAuthoredFromZip(zipPath);
        sendJson(res, 200, { ok: true, toolId: result.toolId, manifest: result.manifest }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { error: msg }, origin);
      }
      return;
    }

    const mAuthoredId = path.match(/^\/v1\/shell-tools\/authored\/([a-z][a-z0-9-]{1,63})$/);
    if (mAuthoredId && method === 'DELETE') {
      const ok = await deleteAuthoredTool(mAuthoredId[1]!);
      if (!ok) {
        sendJson(res, 404, { error: 'authored_not_found' }, origin);
        return;
      }
      sendJson(res, 200, { ok: true }, origin);
      return;
    }

    const mAuthoredInstall = path.match(/^\/v1\/shell-tools\/authored\/([a-z][a-z0-9-]{1,63})\/install$/);
    if (mAuthoredInstall && method === 'POST') {
      try {
        const result = await installAuthoredTool(mAuthoredInstall[1]!);
        sendJson(res, 200, { ok: true, toolId: result.toolId, manifest: result.manifest }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, msg === 'authored_not_found' ? 404 : 400, { error: msg }, origin);
      }
      return;
    }

    const mAuthoredPack = path.match(/^\/v1\/shell-tools\/authored\/([a-z][a-z0-9-]{1,63})\/pack$/);
    if (mAuthoredPack && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      try {
        const destZipPath = typeof body.destZipPath === 'string' ? body.destZipPath.trim() : undefined;
        const result = await packAuthoredTool(mAuthoredPack[1]!, destZipPath || undefined);
        sendJson(res, 200, { ok: true, ...result }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, msg === 'authored_not_found' ? 404 : 400, { error: msg }, origin);
      }
      return;
    }

    const mAuthoredHot = path.match(/^\/v1\/shell-tools\/authored\/([a-z][a-z0-9-]{1,63})\/hot$/);
    if (mAuthoredHot && method === 'GET') {
      const hot = getAuthoredHotState(mAuthoredHot[1]!);
      if (!hot) {
        sendJson(res, 400, { error: 'invalid_tool_id' }, origin);
        return;
      }
      sendJson(res, 200, hot, origin);
      return;
    }

    const mReviewStatus = path.match(/^\/v1\/shell-tools\/([a-z][a-z0-9-]{1,63})\/review-status$/);
    if (mReviewStatus && method === 'POST') {
      const toolId = mReviewStatus[1]!;
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      try {
        const { readFile, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { ensureRepositoryRoot } = await import('./repositoryVolume.js');
        const p = join(ensureRepositoryRoot(), 'shell-tools', toolId, 'manifest.json');
        const cur = JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
        if (typeof body.reviewStatus === 'string') cur.reviewStatus = body.reviewStatus;
        if (typeof body.submissionId === 'string') cur.submissionId = body.submissionId;
        await writeFile(p, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
        sendJson(res, 200, { ok: true, toolId, reviewStatus: cur.reviewStatus, submissionId: cur.submissionId }, origin);
      } catch {
        sendJson(res, 404, { error: 'tool_not_found' }, origin);
      }
      return;
    }

    const mShellToolId = path.match(/^\/v1\/shell-tools\/([a-z][a-z0-9-]{1,63})$/);
    if (mShellToolId && method === 'GET') {
      const detail = await getShellToolDetail(mShellToolId[1]!);
      if (!detail) {
        sendJson(res, 404, { error: 'tool_not_found' }, origin);
        return;
      }
      const hot = getAuthoredHotState(mShellToolId[1]!);
      sendJson(
        res,
        200,
        {
          tool: detail.tool,
          panel: detail.panel,
          permissions: detail.permissions,
          installedAt: detail.installedAt,
          origin: detail.origin || null,
          reviewStatus: detail.reviewStatus || null,
          contentRev: hot?.contentRev ?? detail.contentRev ?? 0,
          draftError: hot?.draftError ?? detail.draftError ?? null,
          watching: hot?.watching ?? false,
        },
        origin,
      );
      return;
    }

    if (mShellToolId && method === 'DELETE') {
      const ok = await uninstallShellTool(mShellToolId[1]!);
      if (!ok) {
        sendJson(res, 404, { error: 'tool_not_found' }, origin);
        return;
      }
      sendJson(res, 200, { ok: true }, origin);
      return;
    }

    if (path === '/v1/shell-tools' && method === 'GET') {
      const tools = await listInstalledShellTools();
      sendJson(res, 200, { tools }, origin);
      return;
    }

    if (path === '/v1/shell-tools/example-available' && method === 'GET') {
      const exampleIds = listBuiltinShellToolExampleIds();
      const dir = resolveExampleShellToolSourceDir();
      if (!dir) {
        sendJson(res, 200, { available: false, examples: [] }, origin);
        return;
      }
      const validation = validateShellToolPackageDir(dir);
      if (!validation.ok) {
        sendJson(res, 200, { available: false, examples: [] }, origin);
        return;
      }
      const examples = exampleIds
        .map((id) => {
          const d = resolveExampleShellToolSourceDir(id);
          if (!d) return null;
          const v = validateShellToolPackageDir(d);
          if (!v.ok) return null;
          return {
            toolId: v.tool.id,
            name: v.tool.name,
            description: v.tool.description,
            semver: v.tool.semver,
            tags: v.tool.tags ?? [],
          };
        })
        .filter(Boolean);
      sendJson(
        res,
        200,
        {
          available: true,
          toolId: validation.tool.id,
          name: validation.tool.name,
          description: validation.tool.description,
          semver: validation.tool.semver,
          tags: validation.tool.tags ?? [],
          examples,
        },
        origin,
      );
      return;
    }

    if (path === '/v1/shell-tools/install-example' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      const exampleId =
        typeof body.exampleId === 'string'
          ? body.exampleId.trim()
          : typeof body.toolId === 'string'
            ? body.toolId.trim()
            : undefined;
      try {
        const result = await installExampleShellTool(exampleId || undefined);
        sendJson(res, 200, { ok: true, toolId: result.toolId, manifest: result.manifest }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const error =
          msg === 'example_tool_unavailable'
            ? 'example_tool_unavailable'
            : msg.includes('install_staging_failed')
              ? 'install_staging_failed'
              : msg.includes('tool_invalid_manifest')
                ? 'tool_invalid_manifest'
                : 'install_failed';
        const code = error === 'install_staging_failed' ? 500 : error === 'example_tool_unavailable' ? 404 : 400;
        sendJson(res, code, { error, message: msg }, origin);
      }
      return;
    }

    if (path === '/v1/shell-tools/install-from-url' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json' }, origin);
          return;
        }
      }
      try {
        const url = typeof body.url === 'string' ? body.url.trim() : '';
        const semver = typeof body.semver === 'string' ? body.semver.trim() : '';
        const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim() : '';
        const bytes = body.bytes;
        const label = typeof body.label === 'string' ? body.label : '';
        if (!url || !semver || !sha256) {
          sendJson(res, 400, { error: 'invalid_params', message: '缺少 url / semver / sha256' }, origin);
          return;
        }
        const result = await installShellToolBundleFromUrl({
          url,
          semver,
          sha256Expected: sha256,
          bytesExpected: typeof bytes === 'number' ? bytes : Number(bytes),
          label,
        });
        sendJson(res, 200, { ok: true, toolId: result.toolId, manifest: result.manifest }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const error =
          msg.includes('SHA256') || msg.includes('字节')
            ? 'install_checksum_mismatch'
            : msg.includes('install_staging_failed')
              ? 'install_staging_failed'
              : msg.includes('tool_invalid_manifest')
                ? 'tool_invalid_manifest'
                : 'install_failed';
        const code = error === 'install_staging_failed' ? 500 : 400;
        sendJson(res, code, { error, message: msg }, origin);
      }
      return;
    }

    if (path === '/v1/repository/summary' && method === 'GET') {
      sendJson(
        res,
        200,
        {
          ...getRepositorySummary(),
          shallowFileBytesTotal: getRepositoryShallowBytesUsed(),
          volumeRootConfigured: getRepositoryRoot(),
        },
        origin,
      );
      return;
    }

    if (path === '/v1/projects' && method === 'GET') {
      sendJson(res, 200, { projectIds: listProjectIds() }, origin);
      return;
    }

    if (path === '/v1/workspace/projects' && method === 'GET') {
      sendJson(res, 200, { projects: listWorkspaceProjectsFromRepo() }, origin);
      return;
    }

    if (path === '/v1/workspace/trash/projects' && method === 'GET') {
      sendJson(res, 200, { items: listWorkspaceTrashProjectsFromRepo() }, origin);
      return;
    }

    if (path === '/v1/workspace/projects' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'WORKSPACE_PROJECT_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as { name?: string };
      const created = createWorkspaceProjectInRepo(String(body.name || ''));
      sendJson(res, 201, { ok: true, project: created }, origin);
      return;
    }

    const mWorkspaceProject = path.match(/^\/v1\/workspace\/projects\/([^/]+)$/);
    if (mWorkspaceProject && method === 'PATCH') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'WORKSPACE_PROJECT_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as { name?: string };
      const updated = renameWorkspaceProjectInRepo(decodeURIComponent(mWorkspaceProject[1]!), String(body.name || ''));
      sendJson(res, 200, { ok: true, project: updated }, origin);
      return;
    }

    if (mWorkspaceProject && method === 'DELETE') {
      const out = deleteWorkspaceProjectFromRepo(decodeURIComponent(mWorkspaceProject[1]!));
      sendJson(res, 200, out, origin);
      return;
    }

    const mWorkspaceTrashRestore = path.match(/^\/v1\/workspace\/trash\/projects\/([^/]+)\/restore$/);
    if (mWorkspaceTrashRestore && method === 'POST') {
      const out = restoreWorkspaceProjectFromTrash(decodeURIComponent(mWorkspaceTrashRestore[1]!));
      sendJson(res, 200, out, origin);
      return;
    }

    if (path === '/v1/compute/jobs' && method === 'GET') {
      sendJson(res, 200, { jobs: listRecentJobs(30) }, origin);
      return;
    }

    if (path === '/v1/projects/save-as' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'PROJECT_FILE_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as {
        filePath?: string;
        projectId?: string;
        projectName?: string;
        bundle?: unknown;
      };
      if (!body.bundle || typeof body.bundle !== 'object') {
        sendJson(res, 400, { error: 'bundle_required', code: 'PROJECT_FILE_BUNDLE_REQUIRED' }, origin);
        return;
      }
      const out = saveProjectFile({
        filePath: String(body.filePath || ''),
        ...(body.projectId ? { projectId: String(body.projectId) } : {}),
        ...(body.projectName ? { projectName: String(body.projectName) } : {}),
        bundle: body.bundle,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          ...out,
          deprecated: true,
          message: 'DEPRECATED: use /v1/workspace/projects APIs instead',
        },
        origin,
        {
          Deprecation: 'true',
          Sunset: 'Wed, 31 Dec 2026 23:59:59 GMT',
        }
      );
      return;
    }

    if (path === '/v1/projects/open' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'PROJECT_FILE_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as { filePath?: string };
      const out = openProjectFile({ filePath: String(body.filePath || '') });
      sendJson(
        res,
        200,
        {
          ok: true,
          ...out,
          deprecated: true,
          message: 'DEPRECATED: use /v1/workspace/projects APIs instead',
        },
        origin,
        {
          Deprecation: 'true',
          Sunset: 'Wed, 31 Dec 2026 23:59:59 GMT',
        }
      );
      return;
    }

    const mManifest = path.match(/^\/v1\/projects\/([^/]+)\/manifest$/);
    if (mManifest && method === 'GET') {
      const r = getManifestJson(mManifest[1]!);
      if ('ok' in r) sendJson(res, 200, r.body, origin);
      else
        sendJson(
          res,
          r.code === 'STORAGE_NOT_FOUND' ? 404 : 400,
          { error: r.error, code: r.code },
          origin,
        );
      return;
    }

    const mManifestReconcile = path.match(/^\/v1\/projects\/([^/]+)\/manifest\/reconcile$/);
    if (mManifestReconcile && method === 'POST') {
      const out = reconcileManifestOrphansFromDisk(mManifestReconcile[1]!);
      if ('error' in out) {
        const status = out.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, status, { error: out.error, code: out.code }, origin);
      } else {
        sendJson(res, 200, { ok: true, added: out.added, keys: out.keys }, origin);
      }
      return;
    }

    const mWorkflow = path.match(/^\/v1\/projects\/([^/]+)\/workflow$/);
    if (mWorkflow && method === 'GET') {
      const r = readWorkflowSnapshot(mWorkflow[1]!);
      if ('ok' in r) sendJson(res, 200, r.body, origin);
      else
        sendJson(
          res,
          r.code === 'STORAGE_NOT_FOUND' ? 404 : 400,
          { error: r.error, code: r.code },
          origin,
        );
      return;
    }
    if (mWorkflow && method === 'PUT') {
      const raw = await readRequestBodyRaw(req);
      let parsed: { assets?: unknown[]; pending?: unknown[]; capabilityRefs?: unknown[] } = {};
      try {
        parsed = JSON.parse(Buffer.from(raw).toString('utf8') || '{}') as typeof parsed;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'BAD_REQUEST' }, origin);
        return;
      }
      const out = writeWorkflowSnapshot(mWorkflow[1]!, {
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        ...(Array.isArray(parsed.capabilityRefs) ? { capabilityRefs: parsed.capabilityRefs } : {}),
      });
      if ('ok' in out) sendJson(res, 200, { ok: true, workflow: out.body }, origin);
      else
        sendJson(
          res,
          out.code === 'STORAGE_INVALID_ID' ? 400 : 500,
          { error: out.error, code: out.code },
          origin,
        );
      return;
    }

    const mMeta = path.match(/^\/v1\/projects\/([^/]+)\/assets\/(.+)\/meta$/);
    if (mMeta && method === 'GET') {
      const key = decodeURIComponent(mMeta[2]!);
      const r = getAssetMeta(mMeta[1]!, key);
      if ('error' in r) {
        const status = r.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, status, { error: r.error, code: r.code }, origin);
      } else {
        sendJson(
          res,
          200,
          {
            projectId: r.projectId,
            key: r.entry.key,
            relPath: r.entry.relPath,
            byteSize: r.entry.byteSize,
            mime: r.entry.mime,
            updatedAt: r.entry.updatedAt,
            onDisk: r.exists,
          },
          origin,
        );
      }
      return;
    }

    const mAssetReveal = path.match(/^\/v1\/projects\/([^/]+)\/assets\/(.+)\/reveal$/);
    if (mAssetReveal && method === 'POST') {
      const pid = mAssetReveal[1]!;
      const key = decodeURIComponent(mAssetReveal[2]!);
      const meta = getAssetMeta(pid, key);
      if ('error' in meta) {
        const status = meta.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, status, { error: meta.error, code: meta.code }, origin);
        return;
      }
      if (!meta.exists) {
        sendJson(res, 404, { error: 'object_missing', code: 'STORAGE_NOT_FOUND' }, origin);
        return;
      }
      const visible = ensureAssetVisibleObjectFile(pid, key, meta.entry.mime);
      if ('error' in visible) {
        sendJson(res, 400, { error: visible.error, code: visible.code }, origin);
        return;
      }
      const opened = openFolderInSystem(visible.dir);
      if ('error' in opened) {
        sendJson(res, 500, { error: opened.error, code: opened.code }, origin);
        return;
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          projectId: pid,
          key,
          dir: visible.dir,
          visibleRelPath: visible.visibleRelPath,
          filename: visible.filename,
        },
        origin,
      );
      return;
    }

    const mAssetImportUrl = path.match(/^\/v1\/projects\/([^/]+)\/assets\/(.+)\/import-url$/);
    if (mAssetImportUrl && method === 'POST') {
      const importKey = decodeURIComponent(mAssetImportUrl[2]!);
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      const sourceUrl = typeof body.url === 'string' ? body.url.trim() : '';
      if (!/^https?:\/\//i.test(sourceUrl)) {
        sendJson(res, 400, { error: 'invalid_url', code: 'STORAGE_INVALID_BODY' }, origin);
        return;
      }
      try {
        // Prefer TRIPO_PROXY/HTTPS_PROXY (Node fetch alone often cannot reach CDN from CN).
        const upstream = await outboundFetch(sourceUrl, { redirect: 'follow' });
        if (!upstream.ok) {
          sendJson(res, 502, { error: `upstream_http_${upstream.status}`, code: 'STORAGE_IMPORT_FAILED' }, origin);
          return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (buf.length === 0) {
          sendJson(res, 400, { error: 'empty_upstream_body', code: 'STORAGE_INVALID_BODY' }, origin);
          return;
        }
        const contentType = normalizeImportedContentType(upstream.headers.get('content-type'), buf);
        const out = putAsset(mAssetImportUrl[1]!, importKey, buf, contentType);
        sendJson(
          res,
          201,
          {
            key: importKey,
            projectId: mAssetImportUrl[1],
            contentType,
            ...out,
          },
          origin,
        );
      } catch (e) {
        sendJson(
          res,
          502,
          { error: e instanceof Error ? e.message : 'import_url_failed', code: 'STORAGE_IMPORT_FAILED' },
          origin,
        );
      }
      return;
    }

    const mAssetDirectory = path.match(/^\/v1\/projects\/([^/]+)\/asset-directories\/([^/]+)$/);
    if (mAssetDirectory && method === 'DELETE') {
      const d = deleteAssetDirectory(mAssetDirectory[1]!, decodeURIComponent(mAssetDirectory[2]!));
      if ('ok' in d) {
        sendJson(res, 200, { ok: true, assetId: decodeURIComponent(mAssetDirectory[2]!), projectId: mAssetDirectory[1], deletedKeys: d.deletedKeys }, origin);
      } else {
        const st = d.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, st, { error: d.error, code: d.code }, origin);
      }
      return;
    }

    const mAsset = path.match(/^\/v1\/projects\/([^/]+)\/assets\/(.+)$/);
    if (mAsset && method === 'GET') {
      const pid = mAsset[1]!;
      const key = decodeURIComponent(mAsset[2]!);
      const meta = getAssetMeta(pid, key);
      if ('error' in meta) {
        const status = meta.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, status, { error: meta.error, code: meta.code }, origin);
        return;
      }
      if (!meta.exists) {
        sendJson(res, 404, { error: 'object_missing', code: 'STORAGE_NOT_FOUND' }, origin);
        return;
      }
      const body = readAssetObjectBytes(pid, key);
      if (!('ok' in body && body.ok)) {
        const e = body as { error: string; code: string };
        sendJson(res, 400, { error: e.error, code: e.code }, origin);
        return;
      }
      const ct = meta.entry.mime || 'application/octet-stream';
      const wantDownload = u.searchParams.get('download') === '1';
      const headers: Record<string, string> = {
        'Content-Type': ct,
        'Content-Length': String(body.body.length),
        'Access-Control-Allow-Origin': origin ?? '*',
        'Access-Control-Expose-Headers': 'Content-Disposition',
      };
      if (wantDownload) {
        const hinted = u.searchParams.get('filename');
        const fn = ensureCompanionDownloadFilename(hinted, key.split('/').pop() || key, ct);
        headers['Content-Disposition'] = `attachment; filename="${fn}"`;
      }
      res.writeHead(200, headers);
      res.end(body.body);
      return;
    }

    if (mAsset && method === 'PUT') {
      const body = await readRequestBodyRaw(req);
      if (body.length === 0) {
        sendJson(res, 400, { error: 'empty_body', code: 'STORAGE_INVALID_BODY' }, origin);
        return;
      }
      const ct = req.headers['content-type'];
      const ctStr = Array.isArray(ct) ? ct[0] : ct;
      const key = decodeURIComponent(mAsset[2]!);
      const out = putAsset(mAsset[1]!, key, body, ctStr);
      sendJson(
        res,
        201,
        {
          key,
          projectId: mAsset[1],
          ...out,
        },
        origin,
      );
      return;
    }

    if (mAsset && method === 'DELETE') {
      const key = decodeURIComponent(mAsset[2]!);
      const d = deleteAsset(mAsset[1]!, key);
      if ('ok' in d) sendJson(res, 200, { ok: true, key, projectId: mAsset[1] }, origin);
      else {
        const st = d.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, st, { error: d.error, code: d.code }, origin);
      }
      return;
    }

    if (path === '/v1/compute/jobs' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        const t = raw.length ? raw.toString('utf8') : '{}';
        data = JSON.parse(t) as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'COMPUTE_INVALID_BODY' }, origin);
        return;
      }
      if (data && typeof data === 'object' && data !== null && 'job' in data) {
        data = (data as { job: unknown }).job;
      }
      const s = await submitJob(data);
      if (s && 'ok' in s && s.ok) {
        sendJson(res, 201, { jobId: s.job.jobId, status: s.job.status, job: s.job }, origin);
        return;
      }
      const err = s as { error: string; code: string };
      const code = err.code || 'COMPUTE_ERROR';
      const st = code === 'COMPUTE_DUPLICATE' ? 409 : 400;
      sendJson(res, st, { error: err.error, code: err.code }, origin);
      return;
    }

    const mJob = path.match(/^\/v1\/compute\/jobs\/([^/]+)$/);
    if (mJob && method === 'GET') {
      const j = getJob(mJob[1]!);
      if (!j) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      sendJson(res, 200, { job: j }, origin);
      return;
    }

    const mJobEvents = path.match(/^\/v1\/compute\/jobs\/([^/]+)\/events$/);
    if (mJobEvents && method === 'GET') {
      const jobId = mJobEvents[1]!;
      if (!getJob(jobId)) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      const afterSeqRaw = u.searchParams.get('afterSeq');
      const limitRaw = u.searchParams.get('limit');
      const afterSeq = afterSeqRaw ? Number.parseInt(afterSeqRaw, 10) : 0;
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
      const events = listJobEvents(jobId, Number.isFinite(afterSeq) ? afterSeq : 0, Number.isFinite(limit) ? limit : 100);
      const nextAfterSeq = events.length ? events[events.length - 1]!.seq : Number.isFinite(afterSeq) ? afterSeq : 0;
      sendJson(res, 200, { jobId, events, nextAfterSeq }, origin);
      return;
    }

    const mJobStream = path.match(/^\/v1\/compute\/jobs\/([^/]+)\/stream$/);
    if (mJobStream && method === 'GET') {
      const jobId = mJobStream[1]!;
      if (!getJob(jobId)) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      const afterSeqRaw = u.searchParams.get('afterSeq');
      let cursor = afterSeqRaw ? Number.parseInt(afterSeqRaw, 10) : 0;
      if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

      sendSseHeaders(res, origin);
      writeSse(res, 'ready', { jobId, afterSeq: cursor });
      const timer = setInterval(() => {
        const events = listJobEvents(jobId, cursor, 100);
        if (events.length > 0) {
          for (const e of events) {
            writeSse(res, 'job.event', e);
            cursor = Math.max(cursor, e.seq);
            if (e.type === 'reply.completed' || e.type === 'task.failed' || e.type === 'task.cancelled') {
              writeSse(res, 'job.end', { jobId, seq: e.seq, type: e.type });
              clearInterval(timer);
              res.end();
              return;
            }
          }
        } else {
          writeSse(res, 'keepalive', { afterSeq: cursor, at: Date.now() });
        }
      }, 1200);

      req.on('close', () => {
        clearInterval(timer);
      });
      return;
    }

    if (mJob && method === 'DELETE') {
      const j = getJob(mJob[1]!);
      if (!j) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      const removed = deleteJob(mJob[1]!);
      sendJson(
        res,
        200,
        { ok: removed, jobId: mJob[1], message: 'cancel or drop from memory' },
        origin,
      );
      return;
    }

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      try {
        sendHtml(res, loadIndexHtml(), origin);
      } catch {
        sendJson(res, 500, { error: 'dashboard_read_failed' }, origin);
      }
      return;
    }

    sendJson(res, 404, { error: 'not_found', path: path + u.search }, origin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'payload_too_large') {
      sendJson(res, 413, { error: 'payload_too_large', code: 'PAYLOAD_TOO_LARGE' }, origin);
    } else if (msg === 'invalid_projectId' || msg === 'invalid_key' || msg.startsWith('invalid_')) {
      sendJson(res, 400, { error: msg, code: 'STORAGE_INVALID_ID' }, origin);
    } else if (
      msg === 'PROJECT_FILE_PATH_REQUIRED' ||
      msg === 'PROJECT_FILE_PATH_MUST_BE_ABSOLUTE' ||
      msg === 'PROJECT_FILE_DIR_NOT_FOUND' ||
      msg === 'PROJECT_FILE_FORMAT_UNSUPPORTED'
    ) {
      sendJson(res, 400, { error: msg.toLowerCase(), code: msg }, origin);
    } else if (
      msg === 'WORKSPACE_PROJECT_NAME_REQUIRED' ||
      msg === 'WORKSPACE_PROJECT_NAME_INVALID' ||
      msg === 'WORKSPACE_PROJECT_ID_INVALID' ||
      msg === 'WORKSPACE_PROJECT_ALREADY_EXISTS' ||
      msg === 'WORKSPACE_TRASH_ID_INVALID'
    ) {
      sendJson(res, 400, { error: msg.toLowerCase(), code: msg }, origin);
    } else if (msg === 'WORKSPACE_PROJECT_NOT_FOUND') {
      sendJson(res, 404, { error: 'workspace_project_not_found', code: msg }, origin);
    } else if (msg === 'WORKSPACE_TRASH_NOT_FOUND') {
      sendJson(res, 404, { error: 'workspace_trash_not_found', code: msg }, origin);
    } else if (msg === 'PROJECT_FILE_NOT_FOUND') {
      sendJson(res, 404, { error: 'project_file_not_found', code: msg }, origin);
    } else {
      sendJson(res, 500, { error: 'internal', message: msg }, origin);
    }
  }
}
