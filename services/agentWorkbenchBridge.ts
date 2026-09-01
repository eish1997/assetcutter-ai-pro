/**
 * P1：工作台 BrowserView 内 Agent 桥接（由 App 注册，主进程 executeJavaScript 调用）。
 */

import type { CustomAppModule, GeneratedAssetSourceMeta, WorkflowAsset } from '../types';
import type { CapabilityExecuteResult } from './capabilityExecutor';
import { getCapabilityEngine, isImageProcessPreset } from './capabilityEngineKind';
import { clampWorkflowTextBody } from './workflowTextLimits';
import type { WorkspaceFinger } from './workspaceDocumentProtocol';
import { emptyWorkspaceFinger, omitConnectedHostsFromFinger } from './workspaceDocumentProtocol';

export type AgentCapabilityPresetSummary = {
  id: string;
  name: string;
  category?: string;
  engine: 'gen_image' | 'gen_text' | 'builtin';
  acceptsText: boolean;
  requiresImage: boolean;
  directRunSupported: boolean;
  unsupportedReason?: string;
};

export type AgentWorkbenchBridgeContext = {
  authenticated: boolean;
  userId: string | null;
  activeProjectId: string | null;
  activeProjectName: string | null;
  projects: Array<{ id: string; name: string }>;
  capabilityPresets: AgentCapabilityPresetSummary[];
  finger: WorkspaceFinger;
};

let publishedWorkbenchFinger: WorkspaceFinger = emptyWorkspaceFinger();

export function publishAgentWorkbenchFinger(finger: WorkspaceFinger | null | undefined) {
  const next = finger && typeof finger === 'object' ? finger : emptyWorkspaceFinger();
  publishedWorkbenchFinger = {
    ...emptyWorkspaceFinger(),
    ...next,
    connectedHosts: Array.isArray(next.connectedHosts) ? next.connectedHosts : [],
  };
}

export function readAgentWorkbenchFinger(): WorkspaceFinger {
  return publishedWorkbenchFinger;
}

export function dispatchWorkspaceSetFinger(finger: WorkspaceFinger | null | undefined): boolean {
  if (typeof window === 'undefined') return false;
  const api = window.assetCutterWorkbench as
    | { dispatchWorkspaceCommand?: (command: unknown) => Promise<unknown> }
    | undefined;
  if (!api || typeof api.dispatchWorkspaceCommand !== 'function') return false;
  const patch = omitConnectedHostsFromFinger(finger || emptyWorkspaceFinger());
  void api.dispatchWorkspaceCommand({ type: 'set_finger', finger: patch });
  return true;
}

export function applyAppendTextResultToAssets(
  assets: WorkflowAsset[] | null | undefined,
  args: { selectedAssetId?: string | null; text: string; now?: number },
): { assets: WorkflowAsset[]; assetId: string; created: boolean; text: string } {
  const list = Array.isArray(assets) ? assets.slice() : [];
  const text = clampWorkflowTextBody(String(args.text || ''));
  const selectedId = String(args.selectedAssetId || '').trim();
  const selected = selectedId ? list.find((a) => String(a?.id || '') === selectedId) : undefined;
  if (!selected) {
    const built = buildAgentCreatedTextAsset({ text, now: args.now });
    return { assets: [built.asset, ...list], assetId: built.assetId, created: true, text };
  }
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const key = `append_${now}`;
  const nextAsset: WorkflowAsset = {
    ...selected,
    displayKey: key,
    textResults: { ...(selected.textResults || {}), [key]: text },
    resultOrder: [...(Array.isArray(selected.resultOrder) ? selected.resultOrder : []), key],
    resultMeta: {
      ...(selected.resultMeta || {}),
      [key]: {
        executedAt: now,
        displayStepLabel: 'dsh 文本结果',
      },
    },
  };
  return {
    assets: list.map((a) => (a.id === selected.id ? nextAsset : a)),
    assetId: selected.id,
    created: false,
    text,
  };
}

export function pickGenerateOnCurrentPreset(
  presets: CustomAppModule[] | null | undefined,
  requestedId?: string | null,
): { ok: true; preset: CustomAppModule } | { ok: false; error: string } {
  const list = Array.isArray(presets) ? presets : [];
  const requested = String(requestedId || '').trim();
  if (requested) {
    const hit = list.find((p) => String(p?.id || '') === requested);
    if (!hit) return { ok: false, error: 'preset_not_found' };
    const summary = summarizeAgentCapabilityPreset(hit);
    if (summary.engine !== 'gen_image' || !summary.directRunSupported) {
      return { ok: false, error: 'preset_not_image_generate' };
    }
    return { ok: true, preset: hit };
  }
  const hit = list.find((p) => {
    const summary = summarizeAgentCapabilityPreset(p);
    return summary.engine === 'gen_image' && summary.directRunSupported;
  });
  if (!hit) return { ok: false, error: 'no_image_preset' };
  return { ok: true, preset: hit };
}

export function applyGenerateOnCurrentToAssets(
  assets: WorkflowAsset[] | null | undefined,
  args: {
    selectedAssetId?: string | null;
    ok: boolean;
    error?: string;
    resultKey?: string;
    companionKey?: string;
    image?: string;
    now?: number;
  },
): { ok: boolean; error?: string; assets: WorkflowAsset[]; assetId?: string; resultKey?: string } {
  const list = Array.isArray(assets) ? assets.slice() : [];
  const selectedId = String(args.selectedAssetId || '').trim();
  if (!selectedId) return { ok: false, error: 'no_selected_asset', assets: list };
  if (!args.ok) return { ok: false, error: String(args.error || 'generate_failed'), assets: list };
  const selected = list.find((a) => String(a?.id || '') === selectedId);
  if (!selected) return { ok: false, error: 'no_selected_asset', assets: list };
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const resultKey = String(args.resultKey || '').trim() || `gen_${now}`;
  const companionKey = String(args.companionKey || '').trim();
  const image = String(args.image || '').trim();
  const nextAsset: WorkflowAsset = {
    ...selected,
    displayKey: resultKey,
    resultOrder: [...(Array.isArray(selected.resultOrder) ? selected.resultOrder : []), resultKey],
    results: image ? { ...(selected.results || {}), [resultKey]: image } : selected.results,
    resultsCompanionKeys: companionKey
      ? { ...(selected.resultsCompanionKeys || {}), [resultKey]: companionKey }
      : selected.resultsCompanionKeys,
    resultMeta: {
      ...(selected.resultMeta || {}),
      [resultKey]: {
        executedAt: now,
        displayStepLabel: 'dsh 出图',
        mediaKind: 'image',
      },
    },
  };
  return {
    ok: true,
    assets: list.map((a) => (a.id === selected.id ? nextAsset : a)),
    assetId: selected.id,
    resultKey,
  };
}

export type AgentWorkflowAssetSummary = {
  id: string;
  kind: string;
  displayKey: string;
  title?: string;
  textPreview?: string;
  hasOriginal: boolean;
  resultCount: number;
  textResultCount: number;
  resultOrder: string[];
  currentMediaKind?: string;
  createdAt?: number;
};

export type AgentWorkflowAssetDetail = AgentWorkflowAssetSummary & {
  original?: {
    present: boolean;
    length?: number;
    objectKey?: string;
    companionKey?: string;
  };
  results: Array<{
    key: string;
    mediaKind: string;
    label?: string;
    length?: number;
    objectKey?: string;
    companionKey?: string;
    executedAt?: number;
    source?: GeneratedAssetSourceMeta;
  }>;
  textResults: Array<{
    key: string;
    text: string;
    length: number;
    label?: string;
    executedAt?: number;
    source?: GeneratedAssetSourceMeta;
  }>;
};

export type AgentWorkbenchBridgeResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export type AgentCapabilityAssetOutput =
  | { kind: 'text'; text: string; assetId: string; resultKey: string }
  | { kind: 'video'; videoUrl: string; mimeType: string | null; assetId: string; resultKey: string }
  | { kind: 'image'; imageAvailable: true; imageLength: number; assetId: string; resultKey: string };

export type AgentCapabilityAssetBuildResult = {
  asset: WorkflowAsset;
  output: AgentCapabilityAssetOutput;
  assetId: string;
  resultKey: string;
};

export const AGENT_WORKBENCH_SMOKE_PRESET_ID = 'agent_workbench_smoke_text_note';

export function getAgentWorkbenchSmokePresetSummary(): AgentCapabilityPresetSummary {
  return {
    id: AGENT_WORKBENCH_SMOKE_PRESET_ID,
    name: '工作台链路验收',
    category: 'text_to_text',
    engine: 'builtin',
    acceptsText: true,
    requiresImage: false,
    directRunSupported: true,
  };
}

type BridgeHandlers = {
  getContext: () => Promise<AgentWorkbenchBridgeContext | AgentWorkbenchBridgeResult>;
  createProject: (name: string) => Promise<AgentWorkbenchBridgeResult>;
  openProject: (projectId: string) => Promise<AgentWorkbenchBridgeResult>;
  listAssets: (args: { projectId?: string; limit?: number }) => Promise<AgentWorkbenchBridgeResult>;
  getAsset: (args: { projectId?: string; assetId: string }) => Promise<AgentWorkbenchBridgeResult>;
  runCapability: (args: {
    presetId: string;
    projectId?: string;
    inputText?: string;
    imageDataUrl?: string;
    inputAssetId?: string;
    inputAssetDisplayKey?: string;
  }) => Promise<AgentWorkbenchBridgeResult>;
  createTextAsset: (args: {
    text: string;
    name?: string;
    projectId?: string;
  }) => Promise<AgentWorkbenchBridgeResult>;
  createImageAsset: (args: {
    imageDataUrl?: string;
    name?: string;
    projectId?: string;
    assetId?: string;
    originalCompanionKey?: string;
    mime?: string;
    imageByteLength?: number;
    localPath?: string;
  }) => Promise<AgentWorkbenchBridgeResult>;
  appendTextResult: (args: {
    text: string;
    assetId?: string;
  }) => Promise<AgentWorkbenchBridgeResult>;
  generateOnCurrent: (args: {
    presetId?: string;
  }) => Promise<AgentWorkbenchBridgeResult>;
};

export function summarizeAgentCapabilityPreset(preset: CustomAppModule): AgentCapabilityPresetSummary {
  const engine = getCapabilityEngine(preset);
  const category = String(preset.category || '');
  const requiresImage =
    category === 'image_to_image' ||
    category === 'image_to_text' ||
    isImageProcessPreset(preset);
  const directRunSupported = category !== 'generate_3d' && preset.id !== 'cut_image' && preset.id !== 'split_component';
  return {
    id: preset.id,
    name: preset.label || preset.id,
    category,
    engine,
    acceptsText: engine === 'gen_text' || engine === 'gen_image' || category === 'generate_video',
    requiresImage,
    directRunSupported,
    ...(directRunSupported
      ? {}
      : { unsupportedReason: category === 'generate_3d' ? '生成3D 请在工作流中拖图到能力框提交' : '该能力需要工作流交互选择，暂不支持 agent 直接运行' }),
  };
}

export function buildAgentCapabilityOutputAsset(args: {
  preset: Pick<CustomAppModule, 'id' | 'label'>;
  result: Extract<CapabilityExecuteResult, { ok: true }>;
  imageInput?: string;
  inputText?: string;
  sourceAssetId?: string;
  sourceDisplayKey?: string;
  now?: number;
  suffix?: string;
}): AgentCapabilityAssetBuildResult {
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const suffix =
    String(args.suffix || '').trim() || Math.random().toString(36).slice(2, 8);
  const assetId = `agent_${now}_${suffix}`;
  const resultKey = `${args.preset.id}_agent`;
  const label = args.preset.label || args.preset.id;
  const sourceAssetId = String(args.sourceAssetId || '').trim();
  const sourceDisplayKey = String(args.sourceDisplayKey || '').trim();
  const sourceMeta: GeneratedAssetSourceMeta | undefined = sourceAssetId
    ? {
        source: 'local',
        capability: 'agent_workbench.run_capability',
        createdAt: new Date(now).toISOString(),
        paramsSnapshot: {
          inputAssetId: sourceAssetId,
          inputAssetDisplayKey: sourceDisplayKey || 'original',
        },
      }
    : undefined;
  const baseMeta = {
    executedAt: now,
    displayStepLabel: label,
    presetActionIdSnapshot: args.preset.id,
    ...(args.inputText ? { inputTextSnapshot: String(args.inputText) } : {}),
    ...(sourceMeta ? { source: sourceMeta } : {}),
  };

  if (args.result.kind === 'text') {
    const asset: WorkflowAsset = {
      id: assetId,
      assetKind: 'text',
      textTitle: label || 'Agent 文本结果',
      textBody: args.result.text,
      original: '',
      displayKey: resultKey,
      results: {},
      textResults: { [resultKey]: args.result.text },
      resultOrder: [resultKey],
      resultMeta: { [resultKey]: baseMeta },
      archived: false,
      hiddenInGrid: false,
      createdAt: now,
    };
    return {
      asset,
      assetId,
      resultKey,
      output: { kind: 'text', text: args.result.text, assetId, resultKey },
    };
  }

  if (args.result.kind === 'video') {
    const asset: WorkflowAsset = {
      id: assetId,
      assetKind: 'video',
      original: args.result.videoUrl,
      displayKey: resultKey,
      results: { [resultKey]: args.result.videoUrl },
      resultOrder: [resultKey],
      resultMeta: {
        [resultKey]: {
          ...baseMeta,
          mediaKind: 'video',
        },
      },
      archived: false,
      hiddenInGrid: false,
      createdAt: now,
    };
    return {
      asset,
      assetId,
      resultKey,
      output: {
        kind: 'video',
        videoUrl: args.result.videoUrl,
        mimeType: args.result.mimeType || null,
        assetId,
        resultKey,
      },
    };
  }

  const imageInput = String(args.imageInput || '').trim();
  const asset: WorkflowAsset = {
    id: assetId,
    assetKind: 'image',
    original: imageInput || args.result.image,
    displayKey: resultKey,
    results: { [resultKey]: args.result.image },
    resultOrder: [resultKey],
    resultMeta: { [resultKey]: baseMeta },
    archived: false,
    hiddenInGrid: false,
    createdAt: now,
  };
  return {
    asset,
    assetId,
    resultKey,
    output: {
      kind: 'image',
      imageAvailable: true,
      imageLength: args.result.image.length,
      assetId,
      resultKey,
    },
  };
}

/**
 * Create a human-shaped text WorkflowAsset (displayKey=original) for Copilot / ac.workbench.create_text_asset.
 */
export function buildAgentCreatedTextAsset(args: {
  text: string;
  name?: string;
  now?: number;
}): { asset: WorkflowAsset; assetId: string; output: Extract<AgentCapabilityAssetOutput, { kind: 'text' }> } {
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  const assetId = `agent_${now}_${suffix}`;
  const text = clampWorkflowTextBody(String(args.text || ''));
  const title =
    String(args.name || '').trim() ||
    textPreview(text, 40) ||
    '文本资产';
  const source: GeneratedAssetSourceMeta = {
    source: 'local',
    capability: 'ac.workbench.create_text_asset',
    createdAt: new Date(now).toISOString(),
  };
  const asset: WorkflowAsset = {
    id: assetId,
    assetKind: 'text',
    textTitle: title,
    textBody: text,
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    resultMeta: {
      original: {
        executedAt: now,
        displayStepLabel: 'Copilot 创建文本',
        source,
      },
    },
    archived: false,
    hiddenInGrid: false,
    createdAt: now,
  };
  return {
    asset,
    assetId,
    output: { kind: 'text', text, assetId, resultKey: 'original' },
  };
}

const MAX_AGENT_CREATED_IMAGE_DATA_URL_CHARS = 20_000_000;

export function normalizeAgentCreatedImageDataUrl(raw: unknown): { ok: true; imageDataUrl: string } | { ok: false; error: string } {
  const imageDataUrl = String(raw || '').trim();
  if (!imageDataUrl) return { ok: false, error: 'missing_image' };
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl)) {
    return { ok: false, error: 'invalid_image_data_url' };
  }
  if (imageDataUrl.length > MAX_AGENT_CREATED_IMAGE_DATA_URL_CHARS) {
    return { ok: false, error: 'image_too_large' };
  }
  return { ok: true, imageDataUrl };
}

/**
 * Create a human-shaped image WorkflowAsset (displayKey=original) for Copilot / ac.workbench.create_image_asset.
 * Prefer inline imageDataUrl for small images; large imports may pass originalCompanionKey only.
 */
export function buildAgentCreatedImageAsset(args: {
  imageDataUrl?: string;
  originalCompanionKey?: string;
  assetId?: string;
  name?: string;
  now?: number;
  imageByteLength?: number;
}): { asset: WorkflowAsset; assetId: string; output: Extract<AgentCapabilityAssetOutput, { kind: 'image' }> } {
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  const assetId = String(args.assetId || '').trim() || `agent_${now}_${suffix}`;
  const imageDataUrl = String(args.imageDataUrl || '').trim();
  const companionKey = String(args.originalCompanionKey || '').trim();
  const title = String(args.name || '').trim() || '导入图片';
  const source: GeneratedAssetSourceMeta = {
    source: 'local',
    capability: 'ac.workbench.create_image_asset',
    createdAt: new Date(now).toISOString(),
  };
  const asset: WorkflowAsset = {
    id: assetId,
    assetKind: 'image',
    original: imageDataUrl,
    ...(companionKey ? { originalCompanionKey: companionKey } : {}),
    displayKey: 'original',
    results: {},
    resultOrder: [],
    resultMeta: {
      original: {
        executedAt: now,
        displayStepLabel: title,
        mediaKind: 'image',
        source,
      },
    },
    archived: false,
    hiddenInGrid: false,
    createdAt: now,
  };
  const imageLength =
    Number.isFinite(Number(args.imageByteLength)) && Number(args.imageByteLength) > 0
      ? Number(args.imageByteLength)
      : imageDataUrl.length;
  return {
    asset,
    assetId,
    output: {
      kind: 'image',
      imageAvailable: Boolean(imageDataUrl || companionKey),
      imageLength,
      assetId,
      resultKey: 'original',
    },
  };
}

function textPreview(value: unknown, max = 180): string | undefined {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function summarizeAgentWorkflowAsset(asset: WorkflowAsset): AgentWorkflowAssetSummary {
  const displayKey = String(asset.displayKey || 'original').trim() || 'original';
  const resultOrder = Array.isArray(asset.resultOrder) ? asset.resultOrder.map(String) : [];
  const textForDisplay =
    displayKey === 'original'
      ? asset.textBody
      : (asset.textResults || {})[displayKey] ?? asset.textBody;
  const currentMeta = asset.resultMeta?.[displayKey];
  const kind =
    asset.assetKind ||
    (asset.isGroup ? 'group' : currentMeta?.mediaKind || (asset.textBody || asset.textResults ? 'text' : 'image'));
  return {
    id: asset.id,
    kind,
    displayKey,
    ...(asset.textTitle ? { title: asset.textTitle } : {}),
    ...(textPreview(textForDisplay) ? { textPreview: textPreview(textForDisplay) } : {}),
    hasOriginal: Boolean(String(asset.original || '').trim() || asset.originalObjectKey || asset.originalCompanionKey),
    resultCount: Object.keys(asset.results || {}).length,
    textResultCount: Object.keys(asset.textResults || {}).length,
    resultOrder,
    ...(currentMeta?.mediaKind ? { currentMediaKind: currentMeta.mediaKind } : {}),
    ...(typeof asset.createdAt === 'number' ? { createdAt: asset.createdAt } : {}),
  };
}

export function summarizeAgentWorkflowAssetDetail(asset: WorkflowAsset): AgentWorkflowAssetDetail {
  const summary = summarizeAgentWorkflowAsset(asset);
  const resultMeta = asset.resultMeta || {};
  const results = Object.entries(asset.results || {}).map(([key, value]) => {
    const meta = resultMeta[key];
    return {
      key,
      mediaKind: String(meta?.mediaKind || summary.kind || 'image'),
      ...(meta?.displayStepLabel ? { label: meta.displayStepLabel } : {}),
      ...(typeof value === 'string' ? { length: value.length } : {}),
      ...(asset.resultsObjectKeys?.[key] ? { objectKey: asset.resultsObjectKeys[key] } : {}),
      ...(asset.resultsCompanionKeys?.[key] ? { companionKey: asset.resultsCompanionKeys[key] } : {}),
      ...(typeof meta?.executedAt === 'number' ? { executedAt: meta.executedAt } : {}),
      ...(meta?.source ? { source: meta.source } : {}),
    };
  });
  const textResults = Object.entries(asset.textResults || {}).map(([key, value]) => {
    const text = String(value || '');
    const meta = resultMeta[key];
    return {
      key,
      text,
      length: text.length,
      ...(meta?.displayStepLabel ? { label: meta.displayStepLabel } : {}),
      ...(typeof meta?.executedAt === 'number' ? { executedAt: meta.executedAt } : {}),
      ...(meta?.source ? { source: meta.source } : {}),
    };
  });
  return {
    ...summary,
    original: {
      present: summary.hasOriginal,
      ...(typeof asset.original === 'string' && asset.original ? { length: asset.original.length } : {}),
      ...(asset.originalObjectKey ? { objectKey: asset.originalObjectKey } : {}),
      ...(asset.originalCompanionKey ? { companionKey: asset.originalCompanionKey } : {}),
    },
    results,
    textResults,
  };
}

declare global {
  interface Window {
    __acAgentWorkbench?: {
      dispatch: (req: { method: string; args?: Record<string, unknown> }) => Promise<unknown>;
      getContext: () => Promise<unknown>;
      createProject: (name: string) => Promise<unknown>;
      openProject: (projectId: string) => Promise<unknown>;
      listAssets: (args?: Record<string, unknown>) => Promise<unknown>;
      getAsset: (args: Record<string, unknown>) => Promise<unknown>;
      runCapability: (args: Record<string, unknown>) => Promise<unknown>;
      createTextAsset: (args: Record<string, unknown>) => Promise<unknown>;
      createImageAsset: (args: Record<string, unknown>) => Promise<unknown>;
      appendTextResult: (args: Record<string, unknown>) => Promise<unknown>;
      generateOnCurrent: (args: Record<string, unknown>) => Promise<unknown>;
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
      if (m === 'createProject') return handlers.createProject(String(args.name || ''));
      if (m === 'openProject') return handlers.openProject(String(args.projectId || ''));
      if (m === 'listAssets') {
        return handlers.listAssets({
          projectId: args.projectId != null ? String(args.projectId) : undefined,
          limit: args.limit != null ? Number(args.limit) : undefined,
        });
      }
      if (m === 'getAsset') {
        return handlers.getAsset({
          projectId: args.projectId != null ? String(args.projectId) : undefined,
          assetId: String(args.assetId || ''),
        });
      }
      if (m === 'runCapability') {
        return handlers.runCapability({
          presetId: String(args.presetId || ''),
          projectId: args.projectId != null ? String(args.projectId) : undefined,
          inputText: args.inputText != null ? String(args.inputText) : undefined,
          imageDataUrl: args.imageDataUrl != null ? String(args.imageDataUrl) : undefined,
          inputAssetId: args.inputAssetId != null ? String(args.inputAssetId) : undefined,
          inputAssetDisplayKey: args.inputAssetDisplayKey != null ? String(args.inputAssetDisplayKey) : undefined,
        });
      }
      if (m === 'createTextAsset') {
        return handlers.createTextAsset({
          text: String(args.text || ''),
          name: args.name != null ? String(args.name) : undefined,
          projectId: args.projectId != null ? String(args.projectId) : undefined,
        });
      }
      if (m === 'createImageAsset') {
        return handlers.createImageAsset({
          imageDataUrl: args.imageDataUrl != null ? String(args.imageDataUrl) : undefined,
          name: args.name != null ? String(args.name) : undefined,
          projectId: args.projectId != null ? String(args.projectId) : undefined,
          assetId: args.assetId != null ? String(args.assetId) : undefined,
          originalCompanionKey: args.originalCompanionKey != null ? String(args.originalCompanionKey) : undefined,
          mime: args.mime != null ? String(args.mime) : undefined,
          imageByteLength: args.imageByteLength != null ? Number(args.imageByteLength) : undefined,
          localPath: args.localPath != null ? String(args.localPath) : undefined,
        });
      }
      if (m === 'appendTextResult') {
        return handlers.appendTextResult({
          text: String(args.text || ''),
          assetId: args.assetId != null ? String(args.assetId) : undefined,
        });
      }
      if (m === 'generateOnCurrent') {
        return handlers.generateOnCurrent({
          presetId: args.presetId != null ? String(args.presetId) : undefined,
        });
      }
      return { ok: false, error: 'unknown_method' };
    },
    getContext: () => handlers.getContext(),
    createProject: (name: string) => handlers.createProject(name),
    openProject: (projectId: string) => handlers.openProject(projectId),
    listAssets: (args: Record<string, unknown> = {}) =>
      handlers.listAssets({
        projectId: args.projectId != null ? String(args.projectId) : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
      }),
    getAsset: (args: Record<string, unknown>) =>
      handlers.getAsset({
        projectId: args.projectId != null ? String(args.projectId) : undefined,
        assetId: String(args.assetId || ''),
      }),
    runCapability: (args: Record<string, unknown>) =>
      handlers.runCapability({
        presetId: String(args.presetId || ''),
        projectId: args.projectId != null ? String(args.projectId) : undefined,
        inputText: args.inputText != null ? String(args.inputText) : undefined,
        imageDataUrl: args.imageDataUrl != null ? String(args.imageDataUrl) : undefined,
        inputAssetId: args.inputAssetId != null ? String(args.inputAssetId) : undefined,
        inputAssetDisplayKey: args.inputAssetDisplayKey != null ? String(args.inputAssetDisplayKey) : undefined,
      }),
    createTextAsset: (args: Record<string, unknown>) =>
      handlers.createTextAsset({
        text: String(args.text || ''),
        name: args.name != null ? String(args.name) : undefined,
        projectId: args.projectId != null ? String(args.projectId) : undefined,
      }),
    createImageAsset: (args: Record<string, unknown>) =>
      handlers.createImageAsset({
        imageDataUrl: args.imageDataUrl != null ? String(args.imageDataUrl) : undefined,
        name: args.name != null ? String(args.name) : undefined,
        projectId: args.projectId != null ? String(args.projectId) : undefined,
        assetId: args.assetId != null ? String(args.assetId) : undefined,
        originalCompanionKey: args.originalCompanionKey != null ? String(args.originalCompanionKey) : undefined,
        mime: args.mime != null ? String(args.mime) : undefined,
        imageByteLength: args.imageByteLength != null ? Number(args.imageByteLength) : undefined,
        localPath: args.localPath != null ? String(args.localPath) : undefined,
      }),
    appendTextResult: (args: Record<string, unknown>) =>
      handlers.appendTextResult({
        text: String(args.text || ''),
        assetId: args.assetId != null ? String(args.assetId) : undefined,
      }),
    generateOnCurrent: (args: Record<string, unknown>) =>
      handlers.generateOnCurrent({
        presetId: args.presetId != null ? String(args.presetId) : undefined,
      }),
  };

  window.__acAgentWorkbench = api;
}
