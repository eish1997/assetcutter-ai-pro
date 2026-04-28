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
  if (!v) return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

async function main(): Promise<void> {
  const port = envPort();
  if (port === 0) {
    console.error('[local-companion] COMPANION_HTTP_PORT=0 已关闭 HTTP，无界面。请设置端口如 18765。');
    process.exit(1);
  }

  const srv = await startCompanionHttpServer(port);
  const base = `http://127.0.0.1:${srv.port}`;
  console.log(`[local-companion] 控制台 ${base}/`);
  console.log(`[local-companion] health ${base}/v1/health`);
  console.log(`[local-companion] 卷根 COMPANION_VOLUME_ROOT=${process.env.COMPANION_VOLUME_ROOT ?? '(默认 ~/.assetcutter-companion/volume)'}`);
  console.log('[local-companion] 存储 API: GET /v1/projects , GET|PUT /v1/projects/:id/assets/:key');
  console.log('[local-companion] 计算 API: POST /v1/compute/jobs  body: { type, jobId?, projectId? }  试 { "type": "stub.ping" }');

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
