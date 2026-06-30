export type AgentToolRisk = 'safe' | 'confirm' | 'forbidden';

export type AgentToolSchema = {
  name: string;
  description: string;
  inputSchema: object;
  risk: AgentToolRisk;
  surfaces?: ('shell' | 'workbench' | 'script_hub' | 'companion' | 'os')[];
  deprecated?: boolean;
};

export type AgentToolResult = {
  ok: boolean;
  content: string;
  structured?: unknown;
  error?: { code: string; message: string };
};

export type AgentContext = {
  sessionId: string;
  brainId: string;
  shellView: string;
  activeProjectId?: string;
  userId?: string;
};

export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_status'; toolCallId: string; name: string; phase: 'start' | 'done' | 'error'; detail?: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; code: string; message: string };

export interface AgentBrainPort {
  readonly id: string;
  readonly displayName: string;
  probe(): Promise<{ ok: boolean; detail?: string }>;
  streamTurn(input: {
    messages: Array<{ role: string; content: string }>;
    tools: AgentToolSchema[];
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent>;
}
