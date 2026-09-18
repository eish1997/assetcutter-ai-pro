import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(process.cwd(), 'vendor', 'basketikun-infinite-canvas');

function put(rel, text) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text.trimStart(), 'utf8');
}

const GEN = 'front-hall-generation-disabled';

put(
  'shims/generation.ts',
  `export const FRONT_HALL_GENERATION_DISABLED = '${GEN}';
export async function disabledGeneration(..._args: unknown[]): Promise<never> {
  throw new Error('${GEN}');
}
`,
);

put(
  'shims/api-image.ts',
  `import { disabledGeneration } from './generation';
export const requestEdit = disabledGeneration;
export const requestGeneration = disabledGeneration;
export const requestImageQuestion = disabledGeneration;
`,
);
put('services/api/image.ts', `export * from '../../shims/api-image';\n`);

put(
  'shims/api-audio.ts',
  `import { disabledGeneration } from './generation';
export const requestAudioGeneration = disabledGeneration;
export const storeGeneratedAudio = disabledGeneration;
`,
);
put('services/api/audio.ts', `export * from '../../shims/api-audio';\n`);

put(
  'shims/api-video.ts',
  `import { disabledGeneration } from './generation';
export const createVideoGenerationTask = disabledGeneration;
export const storeGeneratedVideo = disabledGeneration;
export const waitForVideoGenerationTask = disabledGeneration;
export function isVideoTaskFailed(_error: unknown): boolean {
  return false;
}
`,
);
put('services/api/video.ts', `export * from '../../shims/api-video';\n`);

put(
  'services/api/prompts.ts',
  `export type Prompt = { id: string; title?: string; content?: string };
export async function fetchSourcePrompts(_sourceId?: string): Promise<Prompt[]> {
  return [];
}
`,
);

put(
  'services/api/prompt-source-presets.ts',
  `export type PromptSource = {
  id: string;
  name: string;
  url?: string;
  enabled: boolean;
  builtIn?: boolean;
};
export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [];
export function createPromptSource(partial?: Partial<PromptSource>): PromptSource {
  return {
    id: partial?.id || \`source-\${Date.now()}\`,
    name: partial?.name || '',
    url: partial?.url,
    enabled: partial?.enabled ?? true,
    builtIn: partial?.builtIn,
  };
}
`,
);

put(
  'lib/localforage-storage.ts',
  `const mem = new Map<string, string>();
export const localForageStorage = {
  async getItem(name: string): Promise<string | null> {
    return mem.has(name) ? mem.get(name)! : null;
  },
  async setItem(name: string, value: string): Promise<void> {
    mem.set(name, value);
  },
  async removeItem(name: string): Promise<void> {
    mem.delete(name);
  },
};
`,
);

put(
  'lib/agent/agent-url-bootstrap.ts',
  `export function hasAgentUrlBootstrap(_hash?: string): boolean {
  return false;
}
`,
);

put(
  'stores/use-agent-store.ts',
  `import { create } from 'zustand';

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
`,
);

put(
  'pages/canvas/hooks/use-agent-bridge.ts',
  `export function useAgentBridge(_opts?: unknown) {
  return { applyAgentOps: async () => undefined };
}
`,
);

put(
  'pages/canvas/hooks/use-plugin-host.tsx',
  `export function usePluginHost(_opts?: unknown) {
  return {
    pluginHost: {},
    renderPluginPanel: () => null,
    buildNodeToolbarItems: () => [],
  };
}
`,
);

put(
  'components/layout/user-status-actions.tsx',
  `export function UserStatusActions() {
  return null;
}
`,
);

put(
  'pages/prompts/components/prompt-detail-dialog.tsx',
  `export function PromptDetailDialog(_props: { prompt?: unknown; onClose?: () => void; onCopy?: (prompt: unknown) => void }) {
  return null;
}
`,
);

put(
  'services/image-storage.ts',
  `export type UploadedImage = {
  url: string;
  storageKey?: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

const previewListeners = new Set<() => void>();

export function previewUrlFor(key?: string | null): string {
  return String(key || '');
}
export function subscribeImagePreviews(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}
export function getImagePreviewRevision(): number {
  return 0;
}
export async function ensureImagePreview(_key?: string): Promise<string> {
  return '';
}
export async function uploadImage(_file?: unknown): Promise<UploadedImage> {
  throw new Error('front-hall-generation-disabled');
}
export async function imageToDataUrl(url?: string): Promise<string> {
  return String(url || '');
}
export async function getImageBlob(_key?: string): Promise<Blob | null> {
  return null;
}
export async function cleanupUnusedImages(_keys?: string[]): Promise<void> {}
export function resolveImageUrl(url?: string | null): string {
  return String(url || '');
}
`,
);

put(
  'services/file-storage.ts',
  `export type UploadedFile = {
  url: string;
  storageKey?: string;
  width?: number;
  height?: number;
  bytes: number;
  mimeType: string;
  durationMs?: number;
};

export async function uploadMediaFile(_file?: unknown): Promise<UploadedFile> {
  throw new Error('front-hall-generation-disabled');
}
export function resolveMediaUrl(url?: string | null): string {
  return String(url || '');
}
export async function getMediaBlob(_key?: string): Promise<Blob | null> {
  return null;
}
export async function cleanupUnusedMedia(_keys?: string[]): Promise<void> {}
`,
);

console.log('shims written');
