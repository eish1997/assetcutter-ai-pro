export type AgentToolRisk = 'safe' | 'confirm' | 'forbidden';

export type AgentToolSchema = {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  risk: AgentToolRisk;
  surfaces?: ('shell' | 'workbench' | 'script_hub' | 'companion' | 'os')[];
  deprecated?: boolean;
  whenToUse?: string;
  exampleArguments?: object;
  successSignals?: string[];
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
  clientId?: string;
  toolCallId?: string;
  traceId?: string | null;
  activeProjectId?: string;
  userId?: string;
};

export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_status'; toolCallId: string; name: string; phase: 'start' | 'done' | 'error'; detail?: string }
  | { type: 'activity'; phase: 'start' | 'done' | 'error'; name: string; detail?: string }
  | { type: 'usage'; usage: Record<string, unknown> }
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
    sessionId?: string;
    codexEscalated?: boolean;
  }): AsyncIterable<AgentStreamEvent>;
}
