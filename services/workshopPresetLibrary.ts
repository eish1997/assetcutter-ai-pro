import type { CapabilitySet, CustomAppModule, WorkflowAsset } from '../types';
import {
  WORKSHOP_PRESET_FOLDER_LABELS,
  WORKSHOP_PRESET_FOLDER_RELS,
  WORKSHOP_PRESET_LIBRARY_ROOT,
  normalizeWorkshopPresetRel,
  type WorkshopPresetFolderRel,
} from './workshopFileTree';

export const WORKSHOP_PRESET_ASSET_PREFIX = 'wspreset:';
export const WORKSHOP_SET_ASSET_PREFIX = 'wsset:';
export const WORKSHOP_PRESET_FOLDER_ASSET_PREFIX = 'wspreset-folder:';

export type WorkshopPresetAssetRef =
  | { kind: 'folder'; rel: WorkshopPresetFolderRel }
  | { kind: 'preset'; id: string }
  | { kind: 'set'; id: string };

function cardBase(partial: Pick<WorkflowAsset, 'id'> & Partial<WorkflowAsset>): WorkflowAsset {
  return {
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 0,
    ...partial,
  };
}

export function workshopPresetFolderAssetId(rel: WorkshopPresetFolderRel): string {
  return `${WORKSHOP_PRESET_FOLDER_ASSET_PREFIX}${rel}`;
}

export function workshopPresetAssetId(presetId: string): string {
  return `${WORKSHOP_PRESET_ASSET_PREFIX}${String(presetId || '').trim()}`;
}

export function workshopSetAssetId(setId: string): string {
  return `${WORKSHOP_SET_ASSET_PREFIX}${String(setId || '').trim()}`;
}

export function parseWorkshopPresetAssetId(raw: string | null | undefined): WorkshopPresetAssetRef | null {
  const id = String(raw || '').trim();
  if (id.startsWith(WORKSHOP_PRESET_FOLDER_ASSET_PREFIX)) {
    const rel = normalizeWorkshopPresetRel(id.slice(WORKSHOP_PRESET_FOLDER_ASSET_PREFIX.length));
    return rel ? { kind: 'folder', rel } : null;
  }
  if (id.startsWith(WORKSHOP_PRESET_ASSET_PREFIX)) {
    const presetId = id.slice(WORKSHOP_PRESET_ASSET_PREFIX.length).trim();
    return presetId ? { kind: 'preset', id: presetId } : null;
  }
  if (id.startsWith(WORKSHOP_SET_ASSET_PREFIX)) {
    const setId = id.slice(WORKSHOP_SET_ASSET_PREFIX.length).trim();
    return setId ? { kind: 'set', id: setId } : null;
  }
  return null;
}

export function isWorkshopPresetLibraryAssetId(raw: string | null | undefined): boolean {
  return parseWorkshopPresetAssetId(raw) != null;
}

function previewSrc(preset: CustomAppModule): string {
  return String(
    preset.previewGeneratedThumbImage ||
      preset.previewOriginalThumbImage ||
      preset.previewGeneratedImage ||
      preset.previewOriginalImage ||
      preset.previewImage ||
      '',
  ).trim();
}

function sortPresets(list: CustomAppModule[]): CustomAppModule[] {
  return [...list].sort((a, b) => {
    const ao = Number.isFinite(a.order) ? Number(a.order) : 0;
    const bo = Number.isFinite(b.order) ? Number(b.order) : 0;
    if (ao !== bo) return ao - bo;
    return String(a.label || a.id).localeCompare(String(b.label || b.id), 'zh');
  });
}

export function presetBelongsToWorkshopFolder(preset: CustomAppModule, rel: WorkshopPresetFolderRel): boolean {
  if (rel === 'sets') return false;
  const imageProcess = String(preset.category || '') === 'image_process';
  return rel === 'image_process' ? imageProcess : !imageProcess;
}

export function projectWorkshopPresetCard(preset: CustomAppModule): WorkflowAsset {
  const id = String(preset.id || '').trim();
  return cardBase({
    id: workshopPresetAssetId(id),
    assetKind: 'prompt',
    textTitle: String(preset.label || id),
    textBody: String(preset.instruction || ''),
    original: previewSrc(preset),
    createdAt: 0,
  });
}

export function projectWorkshopSetCard(set: CapabilitySet): WorkflowAsset {
  const id = String(set.id || '').trim();
  return cardBase({
    id: workshopSetAssetId(id),
    assetKind: 'prompt',
    textTitle: String(set.label || id),
    textBody: `${Array.isArray(set.nodes) ? set.nodes.length : 0} 个节点`,
    createdAt: Number(set.updatedAt || set.createdAt || 0),
  });
}

export function projectWorkshopPresetFolderCard(rel: WorkshopPresetFolderRel): WorkflowAsset {
  const label = WORKSHOP_PRESET_FOLDER_LABELS[rel];
  return cardBase({
    id: workshopPresetFolderAssetId(rel),
    isGroup: true,
    assetKind: 'group',
    groupLabel: label,
    textTitle: label,
    containedKinds: ['prompt'],
    assetIds: [],
  });
}

export function listWorkshopPresetLibraryAssets(args: {
  root?: string;
  rel?: string | null;
  presets: CustomAppModule[];
  sets: CapabilitySet[];
}): WorkflowAsset[] {
  const folder = normalizeWorkshopPresetRel(args.rel);
  if (!folder) {
    return WORKSHOP_PRESET_FOLDER_RELS.map((rel) => projectWorkshopPresetFolderCard(rel));
  }
  if (folder === 'sets') {
    return [...args.sets]
      .filter((set) => String(set.id || '').trim())
      .sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id), 'zh'))
      .map(projectWorkshopSetCard);
  }
  return sortPresets(args.presets.filter((preset) => presetBelongsToWorkshopFolder(preset, folder))).map(
    projectWorkshopPresetCard,
  );
}

export function workshopPresetLibraryRootId(): string {
  return WORKSHOP_PRESET_LIBRARY_ROOT;
}
