import type React from 'react';

import type {
  WorkflowAsset,
  WorkflowAssetKind,
  WorkflowAssetVariant,
} from '../../types';
import type { Model3DDisplayMode } from './registry';
import type { ImagePreviewLayoutMode } from './types';

export type AssetPreviewActionPlacement = 'primary' | 'menu';

export type AssetPreviewActionId =
  | 'download'
  | 'copy'
  | 'add-to-input'
  | 'start-crop'
  | 'run-rembg'
  | 'reset-camera'
  | 'toggle-grid'
  | 'toggle-backface-culling'
  | 'capture-preview'
  | 'display-mode'
  | (string & {});

export type AssetPreviewAction = {
  id: AssetPreviewActionId;
  label: string;
  title?: string;
  placement: AssetPreviewActionPlacement;
  disabled?: boolean;
  disabledReason?: string;
  capabilityId?: string;
};

export type AssetPreviewInspectorSection = {
  id: string;
  title: string;
  rows?: Array<{ label: string; value: React.ReactNode }>;
  render?: (context: AssetPreviewContext) => React.ReactNode;
};

export type AssetPreviewInputPolicy = {
  captureGlobalWheel: boolean;
};

export type Model3DInspectionStats = {
  source: string;
  fileName?: string;
  format: string;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  vertexCount: number;
  triangleCount: number;
  dimensions: {
    width: number;
    height: number;
    depth: number;
  };
};

export type AssetCapabilityInputField =
  | { name: string; type: 'text'; label: string; defaultValue?: string; required?: boolean }
  | { name: string; type: 'number'; label: string; defaultValue?: number; min?: number; max?: number; step?: number }
  | { name: string; type: 'boolean'; label: string; defaultValue?: boolean }
  | { name: string; type: 'select'; label: string; defaultValue?: string; options: Array<{ label: string; value: string }> }
  | { name: string; type: 'asset'; label: string; acceptedKinds: WorkflowAssetKind[]; required?: boolean };

export type AssetCapabilityInputSchema = AssetCapabilityInputField[];

export type AssetCapabilityAvailability = {
  available: boolean;
  reason?: string;
};

export type AssetCapabilityProgressEvent = {
  label: string;
  progress?: number;
};

export type AssetCapabilityOutputAsset = {
  kind: WorkflowAssetKind;
  label: string;
  url?: string;
  objectKey?: string;
  companionKey?: string;
  mimeType?: string;
  posterUrl?: string;
  text?: string;
  meta?: Record<string, unknown>;
};

export type AssetCapabilityRunResult = {
  status: 'succeeded' | 'failed' | 'cancelled';
  outputs?: AssetCapabilityOutputAsset[];
  error?: {
    code?: string;
    message: string;
    retryable?: boolean;
  };
};

export type AssetCapabilityRunContext = {
  asset: WorkflowAsset;
  variant: WorkflowAssetVariant | null;
  input: Record<string, unknown>;
  source: 'preview_toolbar' | 'preview_inspector' | 'more_menu';
  signal?: AbortSignal;
  onProgress?: (event: AssetCapabilityProgressEvent) => void;
};

export type AssetCapability = {
  id: string;
  label: string;
  description?: string;
  assetTypes: WorkflowAssetKind[];
  inputSchema?: AssetCapabilityInputSchema;
  outputKinds: WorkflowAssetKind[];
  availability?: (context: AssetPreviewContext) => AssetCapabilityAvailability;
  run: (context: AssetCapabilityRunContext) => Promise<AssetCapabilityRunResult>;
};

export type AssetCapabilityRef = {
  capabilityId: string;
};

export type AssetPreviewContext = {
  asset: WorkflowAsset;
  variant: WorkflowAssetVariant | null;
  assetKind: WorkflowAssetKind;
  previewLayout?: ImagePreviewLayoutMode;
  model3dDisplayMode?: Model3DDisplayMode;
  model3dGridVisible?: boolean;
  model3dBackfaceCulling?: boolean;
  model3dStats?: Model3DInspectionStats | null;
};

export type AssetPreviewAdapter = {
  type: WorkflowAssetKind;
  label: string;
  getToolbarActions?: (context: AssetPreviewContext) => AssetPreviewAction[];
  getInspectorSections?: (context: AssetPreviewContext) => AssetPreviewInspectorSection[];
  getCapabilities?: (context: AssetPreviewContext) => AssetCapabilityRef[];
  getInputPolicy?: (context: AssetPreviewContext) => AssetPreviewInputPolicy;
};

export type AssetPreviewActionHandler = (
  action: AssetPreviewAction,
  context: AssetPreviewContext
) => void | Promise<void>;
