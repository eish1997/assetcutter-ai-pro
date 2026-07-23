import { readLocalJson, writeLocalJson } from './clientPersist';

export type WorkflowModelPbrSlot =
  | 'baseColor'
  | 'normal'
  | 'ao'
  | 'roughness'
  | 'metallic'
  | 'emissive'
  | 'alpha'
  | 'height';

export type WorkflowModelPbrChannel = 'rgb' | 'r' | 'g' | 'b' | 'a';
export type WorkflowModelPbrColorSpace = 'srgb' | 'linear';

export type WorkflowModelPbrTextureEdit = {
  dataUrl: string;
  fileName: string;
  mimeType?: string;
  channel: WorkflowModelPbrChannel;
  colorSpace: WorkflowModelPbrColorSpace;
  normalFlipR?: boolean;
  normalFlipG?: boolean;
  enabled: boolean;
  updatedAt: number;
};

export type WorkflowModelPbrSlotParams = Partial<Record<WorkflowModelPbrSlot, number>>;

export type WorkflowModelPbrTextureRewriteTarget = {
  assetId: string;
  sourceTextureSrc: string;
  slots: WorkflowModelPbrSlot[];
  materialIds?: string[];
  textureLabel?: string;
};

export type WorkflowModelPbrTextureLineage = WorkflowModelPbrTextureRewriteTarget & {
  id: string;
  resultTextureSrc: string;
  actionType: string;
  createdAt: number;
};

export type WorkflowModelPbrMaterialEdit = {
  materialName?: string;
  slots: Partial<Record<WorkflowModelPbrSlot, WorkflowModelPbrTextureEdit>>;
  params?: WorkflowModelPbrSlotParams;
};

export type WorkflowModelPbrEditDoc = {
  version: 1;
  assetId: string;
  variantId?: string;
  modelKey: string;
  updatedAt: number;
  materials: Record<string, WorkflowModelPbrMaterialEdit>;
};

export type WorkflowModelPbrEditPersistEventDetail = {
  assetId: string;
  variantId?: string;
  modelKey: string;
  doc: WorkflowModelPbrEditDoc;
};

export const WORKFLOW_MODEL_PBR_SLOTS: WorkflowModelPbrSlot[] = [
  'baseColor',
  'normal',
  'ao',
  'roughness',
  'metallic',
  'emissive',
  'alpha',
  'height',
];

const STORAGE_KEY = 'ac_workflow_model_pbr_edits_v1';
export const WORKFLOW_MODEL_PBR_EDIT_PERSIST_EVENT = 'asset-preview:model3d-pbr-edit-persist';

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTextureEdit(value: unknown): WorkflowModelPbrTextureEdit | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const dataUrl = clean(rec.dataUrl);
  if (!dataUrl) return null;
  const channel = clean(rec.channel);
  const colorSpace = clean(rec.colorSpace);
  return {
    dataUrl,
    fileName: clean(rec.fileName) || 'texture',
    mimeType: clean(rec.mimeType) || undefined,
    channel: channel === 'rgb' || channel === 'r' || channel === 'g' || channel === 'b' || channel === 'a' ? channel : 'rgb',
    colorSpace: colorSpace === 'srgb' ? 'srgb' : 'linear',
    normalFlipR: rec.normalFlipR === true || undefined,
    normalFlipG: rec.normalFlipG === true || undefined,
    enabled: rec.enabled !== false,
    updatedAt: Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : Date.now(),
  };
}

function normalizeSlotParams(value: unknown): WorkflowModelPbrSlotParams | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const params: WorkflowModelPbrSlotParams = {};
  for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
    const v = Number(raw[slot]);
    if (Number.isFinite(v)) params[slot] = v;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

export function normalizeWorkflowModelPbrEditDoc(value: unknown): WorkflowModelPbrEditDoc | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const assetId = clean(rec.assetId);
  const modelKey = clean(rec.modelKey);
  if (!assetId || !modelKey) return null;
  const materials: WorkflowModelPbrEditDoc['materials'] = {};
  const rawMaterials = rec.materials && typeof rec.materials === 'object' ? rec.materials as Record<string, unknown> : {};
  for (const [materialId, rawMaterial] of Object.entries(rawMaterials)) {
    if (!rawMaterial || typeof rawMaterial !== 'object') continue;
    const rawMatRec = rawMaterial as Record<string, unknown>;
    const rawSlots = rawMatRec.slots && typeof rawMatRec.slots === 'object' ? rawMatRec.slots as Record<string, unknown> : {};
    const slots: WorkflowModelPbrMaterialEdit['slots'] = {};
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const edit = normalizeTextureEdit(rawSlots[slot]);
      if (edit) slots[slot] = edit;
    }
    materials[materialId] = {
      materialName: clean(rawMatRec.materialName) || undefined,
      slots,
      params: normalizeSlotParams(rawMatRec.params),
    };
  }
  return {
    version: 1,
    assetId,
    variantId: clean(rec.variantId) || undefined,
    modelKey,
    updatedAt: Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : Date.now(),
    materials,
  };
}

function storageKeyFor(assetId: string, variantId: string | undefined, modelKey: string): string {
  const raw = `${assetId}__${variantId || 'variant'}__${modelKey}`;
  return raw.replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 240);
}

function readAllDocs(): Record<string, WorkflowModelPbrEditDoc> {
  return readLocalJson<Record<string, WorkflowModelPbrEditDoc>>(STORAGE_KEY, {}, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, WorkflowModelPbrEditDoc> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const doc = normalizeWorkflowModelPbrEditDoc(value);
      if (doc) out[key] = doc;
    }
    return out;
  });
}

export function workflowModelPbrEditKey(assetId: string | undefined, variantId: string | undefined, modelKey: string | undefined): string {
  return storageKeyFor(clean(assetId) || 'unknown_asset', clean(variantId) || undefined, clean(modelKey) || 'unknown_model');
}

export function readWorkflowModelPbrEditDoc(key: string): WorkflowModelPbrEditDoc | null {
  return readAllDocs()[key] || null;
}

export function writeWorkflowModelPbrEditDoc(key: string, doc: WorkflowModelPbrEditDoc): void {
  const all = readAllDocs();
  all[key] = normalizeWorkflowModelPbrEditDoc(doc) || doc;
  writeLocalJson(STORAGE_KEY, all);
}

export function defaultWorkflowPbrColorSpace(slot: WorkflowModelPbrSlot): WorkflowModelPbrColorSpace {
  return slot === 'baseColor' || slot === 'emissive' ? 'srgb' : 'linear';
}

export function defaultWorkflowPbrChannel(slot: WorkflowModelPbrSlot): WorkflowModelPbrChannel {
  if (slot === 'baseColor' || slot === 'normal' || slot === 'emissive') return 'rgb';
  if (slot === 'roughness') return 'g';
  if (slot === 'metallic') return 'b';
  if (slot === 'alpha') return 'a';
  return 'r';
}

export function inferWorkflowPbrSlotsFromFileName(fileName: string): WorkflowModelPbrSlot[] {
  const n = fileName.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\b(orm|occlusion roughness metallic|ao roughness metallic)\b/.test(n)) return ['ao', 'roughness', 'metallic'];
  if (/\b(normal|nrm)\b/.test(n)) return ['normal'];
  if (/\b(roughness|rough)\b/.test(n)) return ['roughness'];
  if (/\b(metallic|metalness|metal)\b/.test(n)) return ['metallic'];
  if (/\b(occlusion|ambient occlusion|ao)\b/.test(n)) return ['ao'];
  if (/\b(emissive|emission|emit)\b/.test(n)) return ['emissive'];
  if (/\b(alpha|opacity|transparent)\b/.test(n)) return ['alpha'];
  if (/\b(height|displacement|disp)\b/.test(n)) return ['height'];
  if (/\b(base color|basecolor|albedo|diffuse|color)\b/.test(n)) return ['baseColor'];
  return [];
}
