import { listAdapterIds, REGISTERED_COMPUTE_TYPES, listRecentJobs } from './compute/jobsStore.js';
import { getRelaySupervisorStatus } from './relaySupervisor.js';
import { getRepositoryRoot, getRepositoryShallowBytesUsed, getRepositorySummary } from './repositoryVolume.js';
import { listProjectIds } from './storage/projectPaths.js';
import { getAccessPublicSummary } from './accessGate.js';
import { getSeamRepairApiUrl, SEAM_ADAPTER_ID } from './compute/seamRepairAdapter.js';
import { getPairingSessionSummary } from './pairingSession.js';

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
    description: '承接 Job → ComputeAdapter 的统一入口；`stub.ping` 可立即完成，其它类型在 Adapter 就绪后接入。',
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
  return PLUGINS.map((p) => {
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
  });
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
      note: 'stub.ping 同步完成；seam_repair 调用 WebSeamRepair（见 COMPANION_SEAM_REPAIR_URL）。',
      seamRepair: {
        adapterId: SEAM_ADAPTER_ID,
        repairEndpoint: getSeamRepairApiUrl(),
        envUrl: 'COMPANION_SEAM_REPAIR_URL',
        envTimeoutMs: 'COMPANION_SEAM_REPAIR_TIMEOUT_MS',
        inputs:
          '{ objKey, textureKey, maskKey?, outputKey? } 或 inputs[]（role: mesh|texture|mask）需已 PUT 至当前 projectId',
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
  pairing: ReturnType<typeof getPairingSessionSummary>;
  siteAuth: {
    state: 'unknown' | 'ready' | 'not_logged_in' | 'relay_unavailable';
    source: 'relay_supervisor';
    detail: string;
    nextAction: string;
  };
  access: ReturnType<typeof getAccessPublicSummary>;
  uptimeSec: number;
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
    pairing: getPairingSessionSummary(),
    siteAuth: buildSiteAuthSummary(relay),
    access: getAccessPublicSummary(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };
}
