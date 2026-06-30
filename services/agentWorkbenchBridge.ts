/**
 * P1：工作台 BrowserView 内 Agent 桥接（由 App 注册，主进程 executeJavaScript 调用）。
 */

export type AgentWorkbenchBridgeContext = {
  authenticated: boolean;
  userId: string | null;
  activeProjectId: string | null;
  activeProjectName: string | null;
  projects: Array<{ id: string; name: string }>;
  capabilityPresets: Array<{ id: string; name: string; category?: string }>;
};

export type AgentWorkbenchBridgeResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

type BridgeHandlers = {
  getContext: () => Promise<AgentWorkbenchBridgeContext | AgentWorkbenchBridgeResult>;
  openProject: (projectId: string) => Promise<AgentWorkbenchBridgeResult>;
  runCapability: (args: {
    presetId: string;
    projectId?: string;
    inputText?: string;
  }) => Promise<AgentWorkbenchBridgeResult>;
};

declare global {
  interface Window {
    __acAgentWorkbench?: {
      dispatch: (req: { method: string; args?: Record<string, unknown> }) => Promise<unknown>;
      getContext: () => Promise<unknown>;
      openProject: (projectId: string) => Promise<unknown>;
      runCapability: (args: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

export function initAgentWorkbenchBridge(handlers: BridgeHandlers) {
  if (typeof window === 'undefined') return;

  const api = {
    async dispatch(req: { method: string; args?: Record<string, unknown> }) {
      const m = String(req?.method || '');
      const args = req?.args || {};
      if (m === 'getContext') return handlers.getContext();
      if (m === 'openProject') return handlers.openProject(String(args.projectId || ''));
      if (m === 'runCapability') {
        return handlers.runCapability({
          presetId: String(args.presetId || ''),
          projectId: args.projectId != null ? String(args.projectId) : undefined,
          inputText: args.inputText != null ? String(args.inputText) : undefined,
        });
      }
      return { ok: false, error: 'unknown_method' };
    },
    getContext: () => handlers.getContext(),
    openProject: (projectId: string) => handlers.openProject(projectId),
    runCapability: (args: Record<string, unknown>) =>
      handlers.runCapability({
        presetId: String(args.presetId || ''),
        projectId: args.projectId != null ? String(args.projectId) : undefined,
        inputText: args.inputText != null ? String(args.inputText) : undefined,
      }),
  };

  window.__acAgentWorkbench = api;
}
