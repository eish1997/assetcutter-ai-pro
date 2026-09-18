import { create } from 'zustand';

type AgentStore = {
  connected: boolean;
  activity: string | null;
  enabled: boolean;
  fragmentBootstrap: unknown;
  panelOpen: boolean;
  togglePanel: () => void;
  openPanel: () => void;
};

export const useAgentStore = create<AgentStore>((set, get) => ({
  connected: false,
  activity: null,
  enabled: false,
  fragmentBootstrap: null,
  panelOpen: false,
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  openPanel: () => set({ panelOpen: true }),
}));
