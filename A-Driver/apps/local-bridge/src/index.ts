import type { BridgeInboundMessage, BridgeOutboundMessage } from "@a-driver/protocol";
import { BridgeOrchestrator } from "./core/orchestrator/bridgeOrchestrator.js";
import { ConnectorRegistry } from "./core/plugin-runtime/connectorRegistry.js";
import { BbBrowserConnector } from "./connectors/bbBrowserConnector.js";
import { GeminiGoogleWebConnector } from "./connectors/geminiGoogleWebConnector.js";
import { WebSocketBridgeClient } from "./core/transport/webSocketBridgeClient.js";

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
      onMessage: async (message: BridgeInboundMessage) => {
        await orchestrator.onMessage(message);
      },
      onDisconnected: (reason) => {
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
}

void main();
