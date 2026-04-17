import test from "node:test";
import assert from "node:assert/strict";
import type {
  BridgeOutboundMessage,
  SendMessagePayload,
  TaskSendMessage,
} from "@a-driver/protocol";
import { ConnectorRegistry } from "../plugin-runtime/connectorRegistry.js";
import type {
  ConnectorContext,
  ConnectorReplyEvent,
  SiteConnector,
} from "../plugin-runtime/siteConnector.js";
import { BridgeOrchestrator } from "./bridgeOrchestrator.js";

class TimeoutConnector implements SiteConnector {
  readonly id = "gemini-web";
  readonly version = "test";

  match(input: { connectorId: string }): boolean {
    return input.connectorId === this.id;
  }

  async init(_ctx: ConnectorContext): Promise<void> {}

  async sendMessage(_input: SendMessagePayload): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  subscribeReplies(_cb: (event: ConnectorReplyEvent) => void): () => void {
    return () => {};
  }

  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    return { healthy: true };
  }

  async teardown(): Promise<void> {}
}

class SlowConnector implements SiteConnector {
  readonly id = "gemini-web";
  readonly version = "test";

  match(input: { connectorId: string }): boolean {
    return input.connectorId === this.id;
  }

  async init(_ctx: ConnectorContext): Promise<void> {}

  async sendMessage(_input: SendMessagePayload): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
  }

  subscribeReplies(_cb: (event: ConnectorReplyEvent) => void): () => void {
    return () => {};
  }

  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    return { healthy: true };
  }

  async teardown(): Promise<void> {}
}

test("task timeout should emit task.timeout and E_TASK_TIMEOUT", async () => {
  const previousTimeout = process.env.BRIDGE_TASK_TIMEOUT_MS;
  process.env.BRIDGE_TASK_TIMEOUT_MS = "10";
  try {
    const events: BridgeOutboundMessage[] = [];
    const registry = new ConnectorRegistry();
    registry.register(new TimeoutConnector());

    const orchestrator = new BridgeOrchestrator(registry, (event) => {
      events.push(event);
    });

    const message: TaskSendMessage = {
      type: "task.send_message",
      taskId: "timeout-task",
      connectorId: "gemini-web",
      payload: { text: "trigger timeout" },
    };

    await orchestrator.onMessage(message);

    assert.ok(events.some((event) => event.type === "task.accepted"));
    assert.ok(events.some((event) => event.type === "task.timeout"));
    assert.ok(
      events.some(
        (event) =>
          event.type === "task.failed" && event.code === "E_TASK_TIMEOUT"
      )
    );
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.BRIDGE_TASK_TIMEOUT_MS;
    } else {
      process.env.BRIDGE_TASK_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("transport disconnected should fail running tasks", async () => {
  const previousTimeout = process.env.BRIDGE_TASK_TIMEOUT_MS;
  process.env.BRIDGE_TASK_TIMEOUT_MS = "1000";
  try {
    const events: BridgeOutboundMessage[] = [];
    const registry = new ConnectorRegistry();
    registry.register(new SlowConnector());
    const orchestrator = new BridgeOrchestrator(registry, (event) => {
      events.push(event);
    });

    const message: TaskSendMessage = {
      type: "task.send_message",
      taskId: "disconnect-task",
      connectorId: "gemini-web",
      payload: { text: "trigger disconnect" },
    };

    const running = orchestrator.onMessage(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
    orchestrator.onTransportDisconnected("socket closed");
    await running;

    assert.ok(
      events.some(
        (event) =>
          event.type === "task.failed" &&
          event.taskId === "disconnect-task" &&
          event.code === "E_TRANSPORT_DISCONNECTED"
      )
    );
    assert.ok(
      !events.some(
        (event) =>
          event.type === "task.failed" &&
          event.taskId === "disconnect-task" &&
          event.code === "E_TASK_TIMEOUT"
      )
    );
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.BRIDGE_TASK_TIMEOUT_MS;
    } else {
      process.env.BRIDGE_TASK_TIMEOUT_MS = previousTimeout;
    }
  }
});
