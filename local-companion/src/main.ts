import { startCompanionHttpServer, type CompanionHttpServer } from './httpServer.js';
import {
  loadRepoEnvLocalProxies,
  outboundProxyConfigured,
} from './loadRepoEnvLocalProxies.js';
import { openDefaultBrowser } from './openBrowser.js';
import { startRelayIfConfigured, stopRelayChild } from './relaySupervisor.js';
import { startSamLocalIfConfigured, stopSamLocalChild } from './samLocalSupervisor.js';
import { startPaddleOcrIfConfigured, stopPaddleOcrChild } from './paddleOcrSupervisor.js';

/** 供信号处理里优雅关端口，避免 tsx watch 重启时 EADDRINUSE */
let companionHttp: CompanionHttpServer | null = null;

/** 须在任何 outboundFetch 之前：裸 local-companion:dev 也能吃到仓库代理 */
const appliedProxyKeys = loadRepoEnvLocalProxies();
if (appliedProxyKeys.length > 0) {
  console.log(`[local-companion] 已从仓库 .env.local 加载出站代理键: ${appliedProxyKeys.join(', ')}`);
}

function envPort(): number {
  const raw = process.env.COMPANION_HTTP_PORT?.trim();
  if (raw === '0') return 0;
  const n = raw ? Number.parseInt(raw, 10) : 18765;
  if (!Number.isFinite(n) || n < 0 || n > 65535) return 18765;
  return n;
}

function shouldOpenBrowser(): boolean {
  const v = process.env.COMPANION_OPEN_BROWSER?.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  /** 默认不自动打开浏览器：本机管理页由桌面壳或用户手动打开；开发期可设 COMPANION_OPEN_BROWSER=1 */
  return false;
}

async function main(): Promise<void> {
  const port = envPort();
  if (port === 0) {
    console.error('[local-companion] COMPANION_HTTP_PORT=0 已关闭 HTTP，无界面。请设置端口如 18765。');
    process.exit(1);
  }

  const srv = await startCompanionHttpServer(port);
  companionHttp = srv;
  const base = `http://127.0.0.1:${srv.port}`;
  console.log(`[local-companion] 本机管理页 ${base}/（默认不自动打开浏览器；需要时请设置 COMPANION_OPEN_BROWSER=1）`);
  console.log(`[local-companion] health ${base}/v1/health`);
  console.log(
    `[local-companion] 出站代理: ${outboundProxyConfigured() ? '已配置 (TRIPO_PROXY/HTTPS_PROXY/HTTP_PROXY)' : '未配置 — import-url 拉 CDN 可能失败'}`
  );
  console.log(`[local-companion] 卷根 COMPANION_VOLUME_ROOT=${process.env.COMPANION_VOLUME_ROOT ?? '(默认 ~/.assetcutter-companion/volume)'}`);
  console.log('[local-companion] 存储 API: GET /v1/projects , GET|PUT /v1/projects/:id/assets/:key');
  console.log(
    '[local-companion] 计算 API: POST /v1/compute/jobs  body: { type, jobId?, projectId?, inputs?, params? }  试 { "type": "stub.ping" }；sam_segment 见 COMPANION_SAM_SEGMENT_URL；调试 GET /v1/debug/sam-segment-health；宿主包 { "type":"host_bundle.exec","inputs":{"dirName":"<host-bundles 目录名>"} }',
  );
  console.log('[local-companion] 扩展包: GET /v1/host-plugins/bundles , POST /v1/host-plugins/install-from-url（ZIP 将解压至 host-bundles/<ver>/extracted/）');
  console.log(
    '[local-companion] 小工具: GET /v1/shell-tools , POST /v1/shell-tools/install-from-url , POST /v1/shell-tools/:id/run , POST /v1/shell-tools/:id/open-in-host',
  );

  startRelayIfConfigured();
  startSamLocalIfConfigured();
  startPaddleOcrIfConfigured();

  try {
    const { bootstrapAuthoredWatchers } = await import('./shellToolAuthored.js');
    await bootstrapAuthoredWatchers();
    console.log('[local-companion] 已启动用户自建小工具热重载监视');
  } catch (e) {
    console.warn('[local-companion] authored watchers bootstrap failed:', e instanceof Error ? e.message : e);
  }

  if (shouldOpenBrowser()) {
    setTimeout(() => openDefaultBrowser(`${base}/`), 500);
  }
}

async function shutdown() {
  stopRelayChild();
  stopSamLocalChild();
  stopPaddleOcrChild();
  try {
    if (companionHttp) {
      await companionHttp.close();
      companionHttp = null;
    }
  } catch (e) {
    console.error('[local-companion] HTTP 关闭异常', e);
  }
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

main().catch((e) => {
  console.error('[local-companion] 启动失败', e);
  process.exit(1);
});
