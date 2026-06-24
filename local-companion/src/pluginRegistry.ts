import { listAdapterIds, REGISTERED_COMPUTE_TYPES, listRecentJobs } from './compute/jobsStore.js';
import { getRelaySupervisorStatus } from './relaySupervisor.js';
import { getSamLocalSupervisorStatus } from './samLocalSupervisor.js';
import { getPaddleOcrSupervisorStatus } from './paddleOcrSupervisor.js';
import {
  buildLocalCapabilityUi,
  mergeLocalCapabilityUiWithRembgPythonProbe,
  mergeLocalCapabilityUiWithSamHttpProbe,
  type LocalCapabilityUiV1,
} from './localCapabilityUi.js';
import type { SamSegmentHealthProbeResult } from './compute/samSegmentAdapter.js';
import type { RembgHealthProbeResult } from './compute/rembgAdapter.js';
import type { PaddleOcrHealthProbeResult } from './compute/paddleOcrAdapter.js';
import { getPaddleOcrApiUrl, PADDLE_OCR_ADAPTER_ID } from './compute/paddleOcrAdapter.js';
import { getRepositoryRoot, getRepositoryShallowBytesUsed, getRepositorySummary } from './repositoryVolume.js';
import { listProjectIds } from './storage/projectPaths.js';
import { getAccessPublicSummary } from './accessGate.js';
import { getSeamRepairApiUrl, SEAM_ADAPTER_ID } from './compute/seamRepairAdapter.js';
import { getSamSegmentApiUrl, SAM_SEGMENT_ADAPTER_ID } from './compute/samSegmentAdapter.js';
import { getPairingSessionSummary } from './pairingSession.js';
import { countHostPluginBundlesSync, listHostBundlePluginSummariesSync } from './hostPluginBundles.js';
import { countShellToolsSync } from './shellToolBundles.js';
import {
  buildRuntimeLocalEnginesStatus,
  type RuntimeLocalEngineStatusV1,
} from './localEnginesRegistry.js';

export const COMPANION_SEMVER = '0.1.0';

export type PluginRole = 'compute' | 'repository' | 'relay' | 'other';

export type CompanionPluginDescriptor = {
  id: string;
  displayName: string;
  role: PluginRole;
  semver: string;
  enabled: boolean;
  /** 给人看的说明 */
  description: string;
  /** 运行态：占位，后续由真实健康检查填充 */
  health: 'ok' | 'degraded' | 'disabled';
  detail?: string;
};

const PLUGINS: CompanionPluginDescriptor[] = [
  {
    id: 'plugin.compute.local',
    displayName: '本地计算（核心）',
    role: 'compute',
    semver: '0.1.0',
    enabled: true,
    description:
      '本机引擎：内置 Job 统一入口（如 sam_segment、remove_bg、seam_repair、stub.ping）。与「扩展包」plugin.host_bundle.*（ZIP 下发）分列。',
    health: 'ok',
    detail: undefined,
  },
  {
    id: 'plugin.repository.volume',
    displayName: '本机仓库（卷）',
    role: 'repository',
    semver: '0.1.0',
    enabled: true,
    description: '本机资源平面：Volume 根目录、后续 manifest / catalog；网站侧仅持久化 AssetHandle。',
    health: 'ok',
    detail: undefined,
  },
  {
    id: 'plugin.relay.sites',
    displayName: '站点中转（Relay）',
    role: 'relay',
    semver: '—',
    enabled: false,
    description: '多站点 WSS 与 bb-browser 连接器；当前由独立进程 A-Driver/local-bridge 承载时可与本包二选一或后续合并。',
    health: 'disabled',
    detail: '未在本包启用。',
  },
];

export function listPlugins(): CompanionPluginDescriptor[] {
  const repo = getRepositorySummary();
  const shallow = getRepositoryShallowBytesUsed();
  const base = PLUGINS.map((p) => {
    if (p.id === 'plugin.compute.local') {
      const has = listRecentJobs(1).length > 0;
      return {
        ...p,
        detail: `POST /v1/compute/jobs；adapters: ${listAdapterIds().join(', ')}` + (has ? '；近期有任务' : '；无近期任务'),
      };
    }
    if (p.id === 'plugin.relay.sites') {
      const rs = getRelaySupervisorStatus();
      return {
        ...p,
        enabled: rs.running,
        health: rs.running ? 'ok' : rs.configured ? 'degraded' : 'disabled',
        semver: rs.running ? 'child' : '—',
        detail: rs.configured
          ? rs.running
            ? `子进程运行中 PID=${rs.pid ?? '—'}；COMPANION_RELAY_CMD；子 HTTP 策略=${rs.childHttpPortPolicy}`
            : '已配置 COMPANION_RELAY_CMD 但子进程未在运行（可能已退出）'
          : '未设置 COMPANION_RELAY_CMD；可配置后由宿主拉起 local-bridge（子进程默认 COMPANION_HTTP_PORT=0 避免与宿主端口冲突）',
      };
    }
    if (p.id !== 'plugin.repository.volume') return { ...p };
    const nProj = listProjectIds().length;
    const bytes = shallow != null ? `${Math.round(shallow / 1024)} KB（根目录文件浅层合计）` : '—';
    return {
      ...p,
      detail: `卷根: ${repo.rootAbsolutePath}；projects: ${nProj}；卷根浅层约 ${bytes}`,
    };
  }) as CompanionPluginDescriptor[];

  const hostSummaries = listHostBundlePluginSummariesSync();
  const hostExtras: CompanionPluginDescriptor[] = hostSummaries.map((h) => {
    const baseDetail =
      h.bundleFormat === 'zip' && h.extractedRelativeDir
        ? `host-bundles/${h.dirName}/${h.extractedRelativeDir}（已解压）`
        : `host-bundles/${h.dirName}/bundle.bin`;
    const runHint = h.runSpec
      ? h.runSpec.exec || h.runSpec.probe
        ? '；run.json 已含 exec/probe'
        : '；run.json 已解析'
      : '';
    const detail = `${baseDetail}${runHint}`;
    return {
      id: `plugin.host_bundle.${h.dirName}`,
      displayName: h.label.trim() ? `扩展包：${h.label}` : `扩展包 ${h.semver}`,
      role: 'other' as const,
      semver: h.semver,
      enabled: true,
      description:
        '主站 host_plugin_bundle（host-bundles 落盘）；用于 probe/exec 或可选发行交付。大图分割/去背景默认走本机引擎，不必安装扩展包。',
      health: 'ok' as const,
      detail,
    };
  });

  return [...base, ...hostExtras];
}

/** 与主站探测、规范对齐的聚合能力（字段可逐步与 A-Driver protocol 对齐） */
export function buildCapabilitiesPayload() {
  const plugins = listPlugins();
  const repoRoot = getRepositoryRoot();
  const relaySv = getRelaySupervisorStatus();
  return {
    protocolVersion: 1,
    companion: { semver: COMPANION_SEMVER, package: '@assetcutter/local-companion' },
    plugins: plugins.map(({ id, displayName, role, semver, enabled, health }) => ({
      id,
      displayName,
      role,
      semver,
      enabled,
      health,
    })),
    compute: {
      enabled: true,
      protocolVersion: 1,
      adapters: listAdapterIds(),
      jobTypes: Object.keys(REGISTERED_COMPUTE_TYPES),
      submitJob: 'POST /v1/compute/jobs',
      getJob: 'GET /v1/compute/jobs/:jobId',
      listJobs: 'GET /v1/compute/jobs',
      cancelJob: 'DELETE /v1/compute/jobs/:jobId',
      note:
      'stub.ping 同步完成；seam_repair 调用 WebSeamRepair（COMPANION_SEAM_REPAIR_URL）；sam_segment（本机引擎）调用 SamLocal（COMPANION_SAM_SEGMENT_URL）；remove_bg（本机引擎）调用 Python rembg（COMPANION_REMBG_PYTHON）；paddle_ocr 调用 PaddleOCR 服务（COMPANION_PADDLEOCR_URL，默认 127.0.0.1:18082）；调试 GET /v1/debug/sam-segment-health、GET /v1/debug/rembg-health、GET /v1/debug/paddleocr-health；host_bundle.exec/probe 仅针对已安装扩展包 run.json（COMPANION_HOST_BUNDLE_EXEC_TIMEOUT_MS）。',
      seamRepair: {
        adapterId: SEAM_ADAPTER_ID,
        repairEndpoint: getSeamRepairApiUrl(),
        envUrl: 'COMPANION_SEAM_REPAIR_URL',
        envTimeoutMs: 'COMPANION_SEAM_REPAIR_TIMEOUT_MS',
        inputs:
          '{ objKey, textureKey, maskKey?, outputKey? } 或 inputs[]（role: mesh|texture|mask）需已 PUT 至当前 projectId',
      },
      samSegment: {
        adapterId: SAM_SEGMENT_ADAPTER_ID,
        predictEndpoint: getSamSegmentApiUrl(),
        envUrl: 'COMPANION_SAM_SEGMENT_URL',
        envTimeoutMs: 'COMPANION_SAM_SEGMENT_TIMEOUT_MS',
        inputs: '{ imageKey, outputKey } + params.prompt（SamSegmentPromptV1）；资产须已 PUT 至当前 projectId',
      },
      paddleOcr: {
        adapterId: PADDLE_OCR_ADAPTER_ID,
        serviceUrl: getPaddleOcrApiUrl(),
        envUrl: 'COMPANION_PADDLEOCR_URL',
        envDevice: 'COMPANION_PADDLEOCR_DEVICE',
        envTimeoutMs: 'COMPANION_PADDLEOCR_TIMEOUT_MS',
        pipelines: ['pp_ocr_v5', 'pp_structure_v3'],
        inputs:
          '{ fileKey|imageKey, outputKey, markdownOutputKey? } + params.pipeline/lang/returnFormat；资产须已 PUT 至当前 projectId',
      },
    },
    storage: {
      enabled: true,
      volumeId: 'default',
      layoutVersion: 1,
      repositoryRoot: repoRoot,
      projectCount: listProjectIds().length,
      listProjects: 'GET /v1/projects',
      getManifest: 'GET /v1/projects/:projectId/manifest',
      reconcileManifest: 'POST /v1/projects/:projectId/manifest/reconcile',
      putAsset: 'PUT /v1/projects/:projectId/assets/:key',
      getAsset: 'GET /v1/projects/:projectId/assets/:key',
      getMeta: 'GET /v1/projects/:projectId/assets/:key/meta',
      deleteAsset: 'DELETE /v1/projects/:projectId/assets/:key',
      assetRelPath: 'assets/<key>/object',
      catalog: null,
      note: 'P0：单写者 manifest + 单 object 文件；分块上传为 P1。',
    },
    relay: {
      enabled: relaySv.running,
      configured: relaySv.configured,
      supervisor: relaySv,
      connectors: [] as string[],
      note: relaySv.configured
        ? '由宿主通过 COMPANION_RELAY_CMD 拉起子进程；详见本地程序开发文档。'
        : '未配置子进程；仍可独立运行 A-Driver local-bridge（勿与宿主同端口）。',
    },
    access: getAccessPublicSummary(),
  };
}

export type RuntimeStatusV1 = {
  mode: string;
  httpPort: number;
  wsConnected: boolean;
  companionSemver: string;
  plugins: ReturnType<typeof listPlugins>;
  repository: ReturnType<typeof getRepositorySummary> & {
    shallowFileBytesTotal: number | null;
  };
  storage: { layoutVersion: 1; projectCount: number; projectIds: string[] };
  compute: { recentJobCount: number; recent: ReturnType<typeof listRecentJobs> };
  relay: ReturnType<typeof getRelaySupervisorStatus>;
  /** 可选：伴侣随启 SamLocal（COMPANION_SPAWN_SAM_LOCAL_CMD） */
  samLocal: ReturnType<typeof getSamLocalSupervisorStatus>;
  /** 可选：伴侣随启 PaddleOCR 服务（COMPANION_SPAWN_PADDLEOCR_CMD / COMPANION_PADDLEOCR_PYTHON） */
  paddleOcr: ReturnType<typeof getPaddleOcrSupervisorStatus>;
  pairing: ReturnType<typeof getPairingSessionSummary>;
  siteAuth: {
    state: 'unknown' | 'ready' | 'not_logged_in' | 'relay_unavailable';
    source: 'relay_supervisor';
    detail: string;
    nextAction: string;
  };
  access: ReturnType<typeof getAccessPublicSummary>;
  uptimeSec: number;
  /** 已落盘的宿主插件包（host-bundles 各子目录 manifest.json）数量 */
  hostPluginBundles?: { installedCount: number };
  shellTools?: { installedCount: number };
  /** 本机能力一条主结论（网站 / 桌面壳；见 docs/本地伴侣-本机能力用户体验与产品化路线图.md） */
  localCapabilityUi: LocalCapabilityUiV1;
  /** 伴侣代探测 SamLocal `GET /health`（回环 URL）；用于随启未挂接但服务实际可用等场景 */
  samSegmentHttpProbe?: {
    ok: boolean;
    healthUrl: string | null;
    predictEndpoint: string;
    latencyMs?: number;
    error?: string;
    code?: string;
  };
  /** 伴侣代探测：对 COMPANION_REMBG_PYTHON 执行 `import rembg`（子进程，约数秒超时） */
  rembgPythonProbe?: {
    ok: boolean;
    pythonExecutable: string;
    latencyMs: number;
    exitCode?: number | null;
    error?: string;
    code?: string;
  };
  /** 伴侣代探测 PaddleOCR `GET /health` */
  paddleOcrHttpProbe?: {
    ok: boolean;
    serviceUrl: string;
    healthUrl: string | null;
    latencyMs?: number;
    device?: string;
    error?: string;
    code?: string;
  };
  /** P2-2：由 `localEnginesRegistry` 驱动 + 当前已接线的探测（如 Sam HTTP）聚合 */
  localEnginesStatus?: RuntimeLocalEngineStatusV1[];
};

const startedAt = Date.now();

function buildSiteAuthSummary(relay: ReturnType<typeof getRelaySupervisorStatus>) {
  const err = relay.lastError ?? '';
  const loginHint = /(not[ _-]?logged[ _-]?in|login required|site not logged in|E_SITE_NOT_LOGGED_IN)/i;
  if (loginHint.test(err)) {
    return {
      state: 'not_logged_in' as const,
      source: 'relay_supervisor' as const,
      detail: `Relay 上报登录态异常：${err}`,
      nextAction: '请在网站端重新登录目标站点后重试任务',
    };
  }
  if (relay.configured && !relay.running) {
    return {
      state: 'relay_unavailable' as const,
      source: 'relay_supervisor' as const,
      detail: 'Relay 已配置但未运行',
      nextAction: '请在托盘中执行“重新启动本地伴侣”或检查 COMPANION_RELAY_CMD',
    };
  }
  if (relay.configured && relay.running) {
    return {
      state: 'ready' as const,
      source: 'relay_supervisor' as const,
      detail: 'Relay 运行中，未发现登录态异常',
      nextAction: '无需动作',
    };
  }
  return {
    state: 'unknown' as const,
    source: 'relay_supervisor' as const,
    detail: '未配置 Relay，暂无法判断站点登录态',
    nextAction: '如需站点自动化，请先配置并启动 Relay',
  };
}

export function buildRuntimeStatus(httpPort: number): RuntimeStatusV1 {
  const repo = getRepositorySummary();
  const pids = listProjectIds();
  const recent = listRecentJobs(8);
  const relay = getRelaySupervisorStatus();
  const samLocal = getSamLocalSupervisorStatus();
  const paddleOcr = getPaddleOcrSupervisorStatus();
  return {
    mode: 'standalone-gui',
    httpPort,
    wsConnected: false,
    companionSemver: COMPANION_SEMVER,
    plugins: listPlugins(),
    repository: {
      ...repo,
      shallowFileBytesTotal: getRepositoryShallowBytesUsed(),
    },
    storage: { layoutVersion: 1, projectCount: pids.length, projectIds: pids },
    compute: { recentJobCount: recent.length, recent },
    relay,
    samLocal,
    paddleOcr,
    pairing: getPairingSessionSummary(),
    siteAuth: buildSiteAuthSummary(relay),
    access: getAccessPublicSummary(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    hostPluginBundles: { installedCount: countHostPluginBundlesSync() },
    shellTools: { installedCount: countShellToolsSync() },
    localCapabilityUi: buildLocalCapabilityUi(relay, samLocal),
  };
}

export function augmentRuntimeStatusWithLocalEngineProbes(
  base: RuntimeStatusV1,
  samProbe: SamSegmentHealthProbeResult,
  rembgProbe: RembgHealthProbeResult,
  paddleOcrProbe: PaddleOcrHealthProbeResult,
): RuntimeStatusV1 {
  const samSegmentHttpProbe = {
    ok: samProbe.ok,
    healthUrl: samProbe.healthUrl,
    predictEndpoint: samProbe.predictEndpoint,
    latencyMs: samProbe.samLocal?.latencyMs,
    error: samProbe.error,
    code: samProbe.code,
  };
  const rembgPythonProbe = {
    ok: rembgProbe.ok,
    pythonExecutable: rembgProbe.pythonExecutable,
    latencyMs: rembgProbe.latencyMs,
    exitCode: rembgProbe.exitCode,
    error: rembgProbe.error,
    code: rembgProbe.code,
  };
  const paddleOcrHttpProbe = {
    ok: paddleOcrProbe.ok,
    serviceUrl: paddleOcrProbe.serviceUrl,
    healthUrl: paddleOcrProbe.healthUrl,
    latencyMs: paddleOcrProbe.paddleOcr?.latencyMs,
    device: paddleOcrProbe.device,
    error: paddleOcrProbe.error ?? paddleOcrProbe.paddleOcr?.error,
    code: paddleOcrProbe.code,
  };
  return {
    ...base,
    samSegmentHttpProbe,
    rembgPythonProbe,
    paddleOcrHttpProbe,
    localEnginesStatus: buildRuntimeLocalEnginesStatus({
      sam: samProbe,
      rembg: rembgProbe,
      paddleOcr: {
        ok: paddleOcrProbe.ok,
        latencyMs: paddleOcrProbe.paddleOcr?.latencyMs,
        error: paddleOcrProbe.error ?? paddleOcrProbe.paddleOcr?.error,
        code: paddleOcrProbe.code,
      },
    }),
    localCapabilityUi: mergeLocalCapabilityUiWithRembgPythonProbe(
      mergeLocalCapabilityUiWithSamHttpProbe(base.localCapabilityUi, samProbe),
      rembgProbe,
    ),
  };
}
