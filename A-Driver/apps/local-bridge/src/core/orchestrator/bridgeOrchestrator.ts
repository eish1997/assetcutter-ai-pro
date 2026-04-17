import type {
  BridgeInboundMessage,
  BridgeOutboundMessage,
  TaskSendMessage,
} from "@a-driver/protocol";
import type { ConnectorRegistry } from "../plugin-runtime/connectorRegistry.js";

type Emit = (event: BridgeOutboundMessage) => void;

type TaskState =
  | { status: "running"; updatedAt: number }
  | { status: "completed"; updatedAt: number; text: string };

export class BridgeOrchestrator {
  private readonly taskTimeoutMs: number;
  private readonly idempotencyWindowMs: number;
  private readonly taskStates = new Map<string, TaskState>();
  private readonly interruptedTaskIds = new Set<string>();

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly emit: Emit
  ) {
    /** 网页 Gemini 等需打开页 + 点击发送 + 模型首字，90s 易误杀；默认 5 分钟，可用 BRIDGE_TASK_TIMEOUT_MS 覆盖 */
    this.taskTimeoutMs = Number(process.env.BRIDGE_TASK_TIMEOUT_MS || 300000);
    this.idempotencyWindowMs = Number(
      process.env.BRIDGE_IDEMPOTENCY_WINDOW_MS || 15 * 60 * 1000
    );
  }

  async onMessage(message: BridgeInboundMessage): Promise<void> {
    this.pruneTaskStates();
    if (message.type === "bridge.ping") {
      this.emit({ type: "bridge.pong", at: Date.now() });
      return;
    }

    await this.handleSendMessage(message);
  }

  onTransportDisconnected(reason: string): void {
    for (const [taskId, state] of this.taskStates.entries()) {
      if (state.status !== "running") continue;
      this.interruptedTaskIds.add(taskId);
      this.emit({
        type: "task.failed",
        taskId,
        code: "E_TRANSPORT_DISCONNECTED",
        message: `transport disconnected: ${reason}`,
      });
      this.taskStates.delete(taskId);
    }
  }

  private async handleSendMessage(message: TaskSendMessage): Promise<void> {
    if (message.messageId) {
      this.emit({
        type: "transport.ack",
        messageId: message.messageId,
        taskId: message.taskId,
        receivedAt: Date.now(),
      });
    }

    const previousState = this.taskStates.get(message.taskId);
    if (previousState?.status === "running") {
      this.emit({
        type: "task.duplicate",
        taskId: message.taskId,
        state: "running",
      });
      return;
    }
    if (previousState?.status === "completed") {
      this.emit({
        type: "task.duplicate",
        taskId: message.taskId,
        state: "completed",
      });
      this.emit({
        type: "reply.completed",
        taskId: message.taskId,
        text: previousState.text,
        completedAt: previousState.updatedAt,
      });
      return;
    }

    const connector = this.registry.resolve(message.connectorId);
    if (!connector) {
      this.emit({
        type: "task.failed",
        taskId: message.taskId,
        code: "E_CONNECTOR_NOT_FOUND",
        message: `connector "${message.connectorId}" not found`,
      });
      return;
    }

    this.taskStates.set(message.taskId, {
      status: "running",
      updatedAt: Date.now(),
    });

    this.emit({
      type: "task.accepted",
      taskId: message.taskId,
      acceptedAt: Date.now(),
    });

    let finalText = "";
    let finalImages: string[] | undefined;
    const unsubscribe = connector.subscribeReplies((event) => {
      if (this.interruptedTaskIds.has(message.taskId)) {
        return;
      }
      if (event.kind === "delta") {
        this.emit({
          type: "reply.delta",
          taskId: message.taskId,
          delta: event.text,
        });
        return;
      }
      if (event.kind === "completed") {
        finalText = event.text;
        finalImages = event.images;
        /** 尽快把 completed 推到 WS，避免仅依赖 sendMessage 尾部再发导致前端长时间空转 */
        this.taskStates.set(message.taskId, {
          status: "completed",
          updatedAt: Date.now(),
          text: finalText,
        });
        this.emit({
          type: "reply.completed",
          taskId: message.taskId,
          text: finalText,
          ...(finalImages?.length ? { images: finalImages } : {}),
          completedAt: Date.now(),
        });
      }
    });

    try {
      await this.runWithTimeout(
        connector.sendMessage(message.payload),
        this.taskTimeoutMs
      );
      if (this.interruptedTaskIds.has(message.taskId)) {
        return;
      }
      const afterRun = this.taskStates.get(message.taskId);
      if (afterRun?.status === "completed") {
        return;
      }
      this.taskStates.set(message.taskId, {
        status: "completed",
        updatedAt: Date.now(),
        text: finalText,
      });
      this.emit({
        type: "reply.completed",
        taskId: message.taskId,
        text: finalText,
        ...(finalImages?.length ? { images: finalImages } : {}),
        completedAt: Date.now(),
      });
    } catch (error) {
      if (this.interruptedTaskIds.has(message.taskId)) {
        return;
      }
      if (this.taskStates.get(message.taskId)?.status === "completed") {
        return;
      }
      if (this.isTimeoutError(error)) {
        this.taskStates.delete(message.taskId);
        this.emit({
          type: "task.timeout",
          taskId: message.taskId,
          timeoutMs: this.taskTimeoutMs,
        });
        this.emit({
          type: "task.failed",
          taskId: message.taskId,
          code: "E_TASK_TIMEOUT",
          message: `task exceeded timeout ${this.taskTimeoutMs}ms`,
        });
        return;
      }
      const normalizedError = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "task.failed",
        taskId: message.taskId,
        code: this.resolveConnectorErrorCode(normalizedError),
        message: normalizedError,
      });
      this.taskStates.delete(message.taskId);
    } finally {
      unsubscribe();
      this.interruptedTaskIds.delete(message.taskId);
    }
  }

  private resolveConnectorErrorCode(
    message: string
  ): "E_SITE_NOT_LOGGED_IN" | "E_CONNECTOR_RUNTIME" {
    const source = message.toLowerCase();
    if (
      source.includes("not logged in") ||
      source.includes("unauthorized") ||
      source.includes("forbidden") ||
      source.includes("login")
    ) {
      return "E_SITE_NOT_LOGGED_IN";
    }
    return "E_CONNECTOR_RUNTIME";
  }

  private runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("__bridge_timeout__"));
      }, timeoutMs);
      promise
        .then((value) => resolve(value))
        .catch((error: unknown) => reject(error))
        .finally(() => {
          clearTimeout(timer);
        });
    });
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.message === "__bridge_timeout__";
  }

  private pruneTaskStates(): void {
    const now = Date.now();
    for (const [taskId, state] of this.taskStates.entries()) {
      if (now - state.updatedAt > this.idempotencyWindowMs) {
        this.taskStates.delete(taskId);
      }
    }
  }
}
