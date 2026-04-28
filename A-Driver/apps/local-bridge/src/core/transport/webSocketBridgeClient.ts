import WebSocket, { type RawData } from "ws";
import type { BridgeInboundMessage, BridgeOutboundMessage } from "@a-driver/protocol";

type MessageHandler = (message: BridgeInboundMessage) => Promise<void> | void;

type ClientOptions = {
  wsUrl: string;
  deviceId: string;
  authToken?: string;
  onMessage: MessageHandler;
  /** WebSocket `open` 时调用（用于宿主 UI 状态） */
  onOpen?: () => void;
  onDisconnected?: (reason: string) => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

export class WebSocketBridgeClient {
  private socket: WebSocket | null = null;
  private closedManually = false;
  private reconnectAttempt = 0;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ClientOptions) {
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 15000;
  }

  start(): void {
    this.closedManually = false;
    this.connect();
  }

  stop(): void {
    this.closedManually = true;
    this.stopPing();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  send(event: BridgeOutboundMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(event));
  }

  /** 是否与云端 WebSocket 处于已连接状态 */
  isConnected(): boolean {
    return this.socket != null && this.socket.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    const socket = new WebSocket(this.options.wsUrl, {
      headers: {
        "x-a-driver-device-id": this.options.deviceId,
        ...(this.options.authToken
          ? { Authorization: `Bearer ${this.options.authToken}` }
          : {}),
      },
    });
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.startPing();
      console.log("[bridge] ws connected:", this.options.wsUrl);
      this.options.onOpen?.();
    });

    socket.on("message", async (raw: RawData) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const message = JSON.parse(text) as BridgeInboundMessage;
        await this.options.onMessage(message);
      } catch (error) {
        console.error("[bridge] invalid inbound message:", error);
      }
    });

    socket.on("close", () => {
      this.stopPing();
      this.socket = null;
      this.options.onDisconnected?.("socket closed");
      if (this.closedManually) {
        return;
      }
      const delay = Math.min(
        this.reconnectBaseMs * 2 ** this.reconnectAttempt,
        this.reconnectMaxMs
      );
      this.reconnectAttempt += 1;
      console.warn(`[bridge] ws closed, reconnecting in ${delay}ms`);
      setTimeout(() => this.connect(), delay);
    });

    socket.on("error", (error: Error) => {
      console.error("[bridge] ws error:", error);
      this.options.onDisconnected?.(error.message);
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({
        type: "bridge.pong",
        at: Date.now(),
      });
    }, 20000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
