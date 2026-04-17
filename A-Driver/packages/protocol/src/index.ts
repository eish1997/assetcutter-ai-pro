export type BridgeInboundType = "task.send_message" | "bridge.ping";

export type BridgeOutboundType =
  | "task.accepted"
  | "reply.delta"
  | "reply.completed"
  | "task.timeout"
  | "task.duplicate"
  | "task.failed"
  | "connector.unhealthy"
  | "transport.disconnected"
  | "transport.ack"
  | "bridge.pong";

export type BridgeImagePart = {
  mimeType: string;
  dataBase64: string;
};

export type SendMessagePayload = {
  text: string;
  threadId?: string;
  images?: BridgeImagePart[];
};

export type TaskSendMessage = {
  type: "task.send_message";
  taskId: string;
  connectorId: string;
  /** 传输层去重/ACK，由服务端生成或由调用方传入 */
  messageId?: string;
  payload: SendMessagePayload;
};

export type BridgePing = {
  type: "bridge.ping";
  at: number;
};

export type BridgeInboundMessage = TaskSendMessage | BridgePing;

export type TaskAccepted = {
  type: "task.accepted";
  taskId: string;
  acceptedAt: number;
};

export type ReplyDelta = {
  type: "reply.delta";
  taskId: string;
  delta: string;
};

export type ReplyCompleted = {
  type: "reply.completed";
  taskId: string;
  text: string;
  /** 助手返回的图片（data URL 或 https 直链） */
  images?: string[];
  completedAt: number;
};

export type TaskTimeout = {
  type: "task.timeout";
  taskId: string;
  timeoutMs: number;
};

export type TaskDuplicate = {
  type: "task.duplicate";
  taskId: string;
  state: "running" | "completed";
};

export type TaskFailed = {
  type: "task.failed";
  taskId: string;
  code:
    | "E_SITE_NOT_LOGGED_IN"
    | "E_TRANSPORT_DISCONNECTED"
    | "E_CONNECTOR_RUNTIME"
    | "E_TASK_TIMEOUT"
    | "E_CONNECTOR_NOT_FOUND";
  message: string;
};

export type ConnectorUnhealthy = {
  type: "connector.unhealthy";
  connectorId: string;
  reason: string;
};

export type TransportDisconnected = {
  type: "transport.disconnected";
  reason: string;
  at: number;
};

export type TransportAck = {
  type: "transport.ack";
  messageId: string;
  taskId: string;
  receivedAt: number;
};

export type BridgePong = {
  type: "bridge.pong";
  at: number;
};

export type BridgeOutboundMessage =
  | TaskAccepted
  | ReplyDelta
  | ReplyCompleted
  | TaskTimeout
  | TaskDuplicate
  | TaskFailed
  | ConnectorUnhealthy
  | TransportDisconnected
  | TransportAck
  | BridgePong;
