import type { BridgeInboundMessage, BridgeOutboundMessage } from "@a-driver/protocol";
import { BridgeOrchestrator } from "./core/orchestrator/bridgeOrchestrator.js";
import { ConnectorRegistry } from "./core/plugin-runtime/connectorRegistry.js";
import { BbBrowserConnector } from "./connectors/bbBrowserConnector.js";
import { GeminiGoogleWebConnector } from "./connectors/geminiGoogleWebConnector.js";
import { WebSocketBridgeClient } from "./core/transport/webSocketBridgeClient.js";
import { COMPANION_SEMVER, buildCompanionCapabilities } from "./companion/pluginHost.js";
import { startCompanionLocalHttpServer } from "./companion/localHttpServer.js";
import { openDefaultBrowser } from "./companion/openBrowser.js";

/** 默认 `18765`；`COMPANION_HTTP_PORT=0` 关闭本机 HTTP 能力宣告（见 docs/本地伴侣-存储与计算规范.md） */
function parseCompanionHttpPort(): number | null {
  const raw = process.env.COMPANION_HTTP_PORT?.trim();
  if (raw === "0") return null;
  if (raw === undefined || raw === "") return 18_765;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 65_535) {
    console.warn("[companion-http] invalid COMPANION_HTTP_PORT, fallback 18765");
    return 18_765;
  }
  return n;
}

function shouldOpenCompanionBrowser(): boolean {
  const v = process.env.COMPANION_OPEN_BROWSER?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

type CompanionRuntimeStatusV1 = {
  protocolVersion: 1;
  companionVersion: string;
  mode: "ws" | "demo";
  wsConnected: boolean;
  wsUrl: string | null;
  deviceId: string;
  lastDisconnectReason: string | null;
  connectors: Array<{ id: string; version: string }>;
  storage: { enabled: boolean; reason?: string };
  compute: { enabled: boolean; reason?: string };
};

async function main(): Promise<void> {
  const wsUrl = process.env.BRIDGE_SERVER_WS_URL?.trim();
  const deviceId = process.env.BRIDGE_DEVICE_ID?.trim() || "local-dev-device";
  const authToken = process.env.BRIDGE_AUTH_TOKEN?.trim();
  const healthCheckIntervalMs = Number(
    process.env.BRIDGE_HEALTHCHECK_INTERVAL_MS || 60_000
  );

  const registry = new ConnectorRegistry();
  const geminiWeb = new GeminiGoogleWebConnector();
  const bbSite = new BbBrowserConnector();
  registry.register(geminiWeb);
  registry.register(bbSite);
  await geminiWeb.init({ deviceId });
  await bbSite.init({ deviceId });

  let wsClient: WebSocketBridgeClient | null = null;
  const emit = (event: BridgeOutboundMessage) => {
    console.log("[bridge-event]", JSON.stringify(event));
    wsClient?.send(event);
  };
  const orchestrator = new BridgeOrchestrator(registry, emit);
  console.log(
    "[bridge] started with connectors:",
    registry.list().map((it) => `${it.id}@${it.version}`).join(", ")
  );

  const capsSnapshot = () => buildCompanionCapabilities(registry);
  const runtime: CompanionRuntimeStatusV1 = {
    protocolVersion: 1,
    companionVersion: COMPANION_SEMVER,
    mode: wsUrl ? "ws" : "demo",
    wsConnected: false,
    wsUrl: wsUrl || null,
    deviceId,
    lastDisconnectReason: null,
    connectors: [],
    storage: { enabled: false },
    compute: { enabled: false },
  };
  const syncRuntimePlugins = () => {
    const c = capsSnapshot();
    runtime.storage = c.storage;
    runtime.compute = c.compute;
    runtime.connectors = registry.list().map((x) => ({ id: x.id, version: x.version }));
  };
  syncRuntimePlugins();

  const companionHttpPort = parseCompanionHttpPort();
  let closeCompanionHttp: (() => Promise<void>) | null = null;
  if (companionHttpPort != null) {
    const srv = startCompanionLocalHttpServer({
      port: companionHttpPort,
      getCapabilities: () => buildCompanionCapabilities(registry),
      getRuntimeStatus: () => {
        runtime.wsConnected = wsClient?.isConnected() ?? false;
        syncRuntimePlugins();
        return runtime;
      },
    });
    closeCompanionHttp = () => srv.close();
    if (shouldOpenCompanionBrowser()) {
      const url = `http://127.0.0.1:${companionHttpPort}/`;
      setTimeout(() => openDefaultBrowser(url), 500);
    }
  }

  for (const c of [geminiWeb, bbSite]) {
    const health = await c.healthCheck();
    if (!health.healthy) {
      emit({
        type: "connector.unhealthy",
        connectorId: c.id,
        reason: health.reason || "unknown reason",
      });
    }
  }

  if (healthCheckIntervalMs > 0) {
    setInterval(async () => {
      for (const c of [geminiWeb, bbSite]) {
        const nextHealth = await c.healthCheck();
        if (!nextHealth.healthy) {
          emit({
            type: "connector.unhealthy",
            connectorId: c.id,
            reason: nextHealth.reason || "unknown reason",
          });
        }
      }
    }, healthCheckIntervalMs);
  }

  if (wsUrl) {
    wsClient = new WebSocketBridgeClient({
      wsUrl,
      deviceId,
      authToken,
      onOpen: () => {
        runtime.wsConnected = true;
        runtime.lastDisconnectReason = null;
      },
      onMessage: async (message: BridgeInboundMessage) => {
        await orchestrator.onMessage(message);
      },
      onDisconnected: (reason) => {
        runtime.wsConnected = wsClient?.isConnected() ?? false;
        runtime.lastDisconnectReason = reason;
        console.warn("[bridge] transport disconnected:", reason);
        emit({
          type: "transport.disconnected",
          reason,
          at: Date.now(),
        });
        orchestrator.onTransportDisconnected(reason);
      },
    });
    wsClient.start();
    console.log("[bridge] ws mode enabled");
    return;
  }

  console.log(
    "[bridge] demo mode: set BRIDGE_SERVER_WS_URL to connect your website backend"
  );
  const demoMessages: BridgeInboundMessage[] = [
    { type: "bridge.ping", at: Date.now() },
    {
      type: "task.send_message",
      taskId: "demo-task-1",
      connectorId: "bb-site",
      payload: {
        text: process.env.BRIDGE_DEMO_TEXT?.trim() || "hello from website",
      },
    },
  ];

  for (const message of demoMessages) {
    await orchestrator.onMessage(message);
  }

  if (closeCompanionHttp) {
    console.log("[companion-http] running; Ctrl+C to exit");
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => resolve());
    });
    await closeCompanionHttp();
  }
}

void main();
