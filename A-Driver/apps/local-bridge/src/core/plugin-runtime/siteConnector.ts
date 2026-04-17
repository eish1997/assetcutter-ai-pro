import type { SendMessagePayload } from "@a-driver/protocol";

export type ConnectorReplyEvent =
  | { kind: "delta"; text: string }
  | { kind: "completed"; text: string; images?: string[] };

export type ConnectorContext = {
  deviceId: string;
};

export type SiteConnector = {
  id: string;
  version: string;
  match(input: { connectorId: string }): boolean;
  init(ctx: ConnectorContext): Promise<void>;
  sendMessage(input: SendMessagePayload): Promise<void>;
  subscribeReplies(cb: (event: ConnectorReplyEvent) => void): () => void;
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
  teardown(): Promise<void>;
};
