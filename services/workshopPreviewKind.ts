import type { WorkflowModelFormat } from '../types';

export type WorkshopPreviewKind = 'image' | 'text' | 'video' | 'model3d' | 'file';

export type WorkshopPreviewHydrate = 'thumb-jpeg' | 'text-body' | 'media-url' | 'none';

export type WorkshopPreviewCard = 'image-thumb' | 'text-snippet' | 'video' | 'model-capture' | 'placeholder';

export type WorkshopPreviewLightbox = 'image' | 'text' | 'video' | 'model3d' | 'none';

export type WorkshopPreviewKindDef = {
  kind: WorkshopPreviewKind;
  extensions: string[];
  hydrate: WorkshopPreviewHydrate;
  card: WorkshopPreviewCard;
  lightbox: WorkshopPreviewLightbox;
  /** Viewer can actually play these; remaining extensions of the kind stay classified but lightbox may say unsupported. */
  previewable: string[];
};

export const WORKSHOP_PREVIEW_KIND_DEFS: WorkshopPreviewKindDef[] = [
  {
    kind: 'image',
    extensions: [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff', '.exr', '.hdr', '.psd',
      '.svg', '.avif', '.jfif', '.apng', '.tga', '.dds', '.ktx', '.ktx2', '.heic', '.heif',
    ],
    hydrate: 'thumb-jpeg',
    card: 'image-thumb',
    lightbox: 'image',
    previewable: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff', '.exr', '.hdr', '.psd', '.svg', '.avif', '.jfif', '.apng'],
  },
  {
    kind: 'text',
    extensions: [
      '.md', '.txt', '.json', '.csv', '.xml', '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts',
      '.tsx', '.jsx', '.mdx', '.log', '.ini', '.toml', '.rtf',
    ],
    hydrate: 'text-body',
    card: 'text-snippet',
    lightbox: 'text',
    previewable: ['.md', '.txt', '.json', '.csv', '.xml', '.yaml', '.yml', '.log', '.ini', '.toml'],
  },
  {
    kind: 'video',
    extensions: [
      '.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.mpeg', '.mpg', '.wmv', '.flv', '.3gp', '.ts',
      '.mts', '.m2ts', '.ogv',
    ],
    hydrate: 'media-url',
    card: 'video',
    lightbox: 'video',
    previewable: ['.mp4', '.webm', '.mov', '.m4v'],
  },
  {
    kind: 'model3d',
    extensions: [
      '.glb', '.gltf', '.fbx', '.obj', '.stl', '.usd', '.usda', '.usdc', '.usdz', '.dae', '.ply', '.abc',
      '.3ds', '.blend', '.vrm', '.3mf', '.dxf', '.step', '.stp', '.iges', '.igs',
    ],
    hydrate: 'media-url',
    card: 'model-capture',
    lightbox: 'model3d',
    previewable: ['.glb', '.gltf', '.fbx', '.obj'],
  },
  {
    kind: 'file',
    extensions: [],
    hydrate: 'none',
    card: 'placeholder',
    lightbox: 'none',
    previewable: [],
  },
];

const EXT_TO_KIND = new Map<string, WorkshopPreviewKind>();
for (const def of WORKSHOP_PREVIEW_KIND_DEFS) {
  if (def.kind === 'file') continue;
  for (const ext of def.extensions) EXT_TO_KIND.set(ext, def.kind);
}

const PREVIEWABLE = new Set<string>();
for (const def of WORKSHOP_PREVIEW_KIND_DEFS) {
  for (const ext of def.previewable) PREVIEWABLE.add(`${def.kind}:${ext}`);
}

export function workshopPreviewExt(name: string): string {
  const raw = String(name || '');
  const i = raw.lastIndexOf('.');
  if (i < 0) return '';
  return raw.slice(i).toLowerCase();
}

export function workshopPreviewKindFromName(name: string): WorkshopPreviewKind {
  return EXT_TO_KIND.get(workshopPreviewExt(name)) || 'file';
}

export function workshopPreviewKindDef(kind: WorkshopPreviewKind): WorkshopPreviewKindDef {
  return WORKSHOP_PREVIEW_KIND_DEFS.find((row) => row.kind === kind) || WORKSHOP_PREVIEW_KIND_DEFS[4]!;
}

export function workshopPreviewKindExts(kind: WorkshopPreviewKind): string[] {
  return workshopPreviewKindDef(kind).extensions.slice();
}

export function isWorkshopPreviewableName(name: string): boolean {
  const kind = workshopPreviewKindFromName(name);
  return PREVIEWABLE.has(`${kind}:${workshopPreviewExt(name)}`);
}

export function isWorkshopPlayableMediaUrl(value: string): boolean {
  return /^(ac-workshop:|blob:|https?:)/i.test(String(value || '').trim());
}

export function workshopHostEntryKindFromName(name: string): 'image' | 'model' | 'text' | 'video' | 'file' {
  const kind = workshopPreviewKindFromName(name);
  if (kind === 'model3d') return 'model';
  return kind;
}

export const WORKSHOP_SPECIAL_RASTER_EXTS = ['.exr', '.hdr', '.psd'] as const;

export function isWorkshopSpecialRasterName(name: string): boolean {
  return (WORKSHOP_SPECIAL_RASTER_EXTS as readonly string[]).includes(workshopPreviewExt(name));
}

export function isWorkshopTextPreviewName(name: string): boolean {
  return workshopPreviewKindFromName(name) === 'text';
}

export function workshopModelFormatFromName(name: string): WorkflowModelFormat | undefined {
  const ext = workshopPreviewExt(name);
  if (ext === '.gltf') return 'gltf';
  if (ext === '.fbx') return 'fbx';
  if (ext === '.obj') return 'obj';
  if (ext === '.glb') return 'glb';
  if (ext === '.stl') return 'stl';
  return undefined;
}
