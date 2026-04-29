import { startCompanionHttpServer } from './httpServer.js';
import { openDefaultBrowser } from './openBrowser.js';
import { startRelayIfConfigured, stopRelayChild } from './relaySupervisor.js';

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
  const base = `http://127.0.0.1:${srv.port}`;
  console.log(`[local-companion] 本机管理页 ${base}/（默认不自动打开浏览器；需要时请设置 COMPANION_OPEN_BROWSER=1）`);
  console.log(`[local-companion] health ${base}/v1/health`);
  console.log(`[local-companion] 卷根 COMPANION_VOLUME_ROOT=${process.env.COMPANION_VOLUME_ROOT ?? '(默认 ~/.assetcutter-companion/volume)'}`);
  console.log('[local-companion] 存储 API: GET /v1/projects , GET|PUT /v1/projects/:id/assets/:key');
  console.log(
    '[local-companion] 计算 API: POST /v1/compute/jobs  body: { type, jobId?, projectId?, inputs? }  试 { "type": "stub.ping" }；宿主包 { "type":"host_bundle.exec","inputs":{"dirName":"<host-bundles 目录名>"} }',
  );
  console.log('[local-companion] 宿主插件包: GET /v1/host-plugins/bundles , POST /v1/host-plugins/install-from-url（ZIP 将解压至 host-bundles/<ver>/extracted/）');

  startRelayIfConfigured();

  if (shouldOpenBrowser()) {
    setTimeout(() => openDefaultBrowser(`${base}/`), 500);
  }
}

const onShutdown = () => {
  stopRelayChild();
  process.exit(0);
};
process.once('SIGINT', onShutdown);
process.once('SIGTERM', onShutdown);

main().catch((e) => {
  console.error('[local-companion] 启动失败', e);
  process.exit(1);
});
