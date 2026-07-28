import {
  defaultWorkflowPbrChannel,
  defaultWorkflowPbrColorSpace,
  type WorkflowModelPbrChannel,
  type WorkflowModelPbrEditDoc,
  type WorkflowModelPbrMaterialEdit,
  type WorkflowModelPbrSlot,
  type WorkflowModelPbrTextureEdit,
} from './workflowModelPbrEdits';

/** Minimal texture shape (avoids hard Three dependency in unit tests). */
export type ExtractableTextureLike = {
  image?: unknown;
  name?: string;
};

export type ExtractablePbrMaterialLike = {
  name?: string;
  map?: ExtractableTextureLike | null;
  normalMap?: ExtractableTextureLike | null;
  aoMap?: ExtractableTextureLike | null;
  roughnessMap?: ExtractableTextureLike | null;
  metalnessMap?: ExtractableTextureLike | null;
  emissiveMap?: ExtractableTextureLike | null;
  alphaMap?: ExtractableTextureLike | null;
  displacementMap?: ExtractableTextureLike | null;
  bumpMap?: ExtractableTextureLike | null;
};

export type SeedMaterialSlotInput = {
  id: string;
  label: string;
  material: ExtractablePbrMaterialLike;
};

export type ExtractTextureExportOptions = {
  maxEdge?: number;
  mimeType?: 'image/png' | 'image/jpeg';
  quality?: number;
  /** When not rgb, bake that channel to grayscale RGB so panel thumbs are readable. */
  channel?: WorkflowModelPbrChannel;
};

export type ExtractTextureExporter = (
  texture: ExtractableTextureLike | null | undefined,
  options?: ExtractTextureExportOptions
) => string | null;

const DEFAULT_MAX_EDGE = 2048;

function imageSize(image: unknown): { w: number; h: number } | null {
  if (!image || typeof image !== 'object') return null;
  const rec = image as Record<string, unknown>;
  const w = Number(rec.width ?? rec.videoWidth ?? rec.naturalWidth ?? 0);
  const h = Number(rec.height ?? rec.videoHeight ?? rec.naturalHeight ?? 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  return { w, h };
}

function isHtmlImageElement(image: unknown): image is HTMLImageElement {
  return typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement;
}

/** Expand a single channel into grayscale RGB (alpha forced opaque). */
export function isolateImageDataToChannel(
  image: ImageData,
  channel: Exclude<WorkflowModelPbrChannel, 'rgb'>
): void {
  const channelIndex = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : 3;
  for (let i = 0; i < image.data.length; i += 4) {
    const v = image.data[i + channelIndex];
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
}

/** Export a GPU/CPU-backed texture image to a data URL for the PBR panel. */
export function extractableTextureToDataUrl(
  texture: ExtractableTextureLike | null | undefined,
  options?: ExtractTextureExportOptions
): string | null {
  if (typeof document === 'undefined') return null;
  const image = texture?.image;
  const size = imageSize(image);
  if (!size) return null;
  const channel = options?.channel || 'rgb';
  const maxEdge = Math.max(64, Math.min(4096, options?.maxEdge ?? DEFAULT_MAX_EDGE));

  // Prefer original encoded bytes for full RGB — canvas recompress can muddy albedo atlases.
  if (channel === 'rgb' && isHtmlImageElement(image)) {
    if (!image.complete || image.naturalWidth < 1) return null;
    const src = String(image.currentSrc || image.src || '').trim();
    if (src.startsWith('data:image/') && Math.max(size.w, size.h) <= maxEdge) {
      return src;
    }
  }

  const scale = Math.min(1, maxEdge / Math.max(size.w, size.h));
  const cw = Math.max(1, Math.round(size.w * scale));
  const ch = Math.max(1, Math.round(size.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
      if (cw === size.w && ch === size.h) {
        ctx.putImageData(image, 0, 0);
      } else {
        const tmp = document.createElement('canvas');
        tmp.width = size.w;
        tmp.height = size.h;
        const tmpCtx = tmp.getContext('2d');
        if (!tmpCtx) return null;
        tmpCtx.putImageData(image, 0, 0);
        ctx.drawImage(tmp, 0, 0, cw, ch);
      }
    } else {
      ctx.drawImage(image as CanvasImageSource, 0, 0, cw, ch);
    }
    if (channel !== 'rgb') {
      const pixels = ctx.getImageData(0, 0, cw, ch);
      isolateImageDataToChannel(pixels, channel);
      ctx.putImageData(pixels, 0, 0);
    }
    const mime = options?.mimeType || 'image/jpeg';
    if (mime === 'image/png') return canvas.toDataURL('image/png');
    return canvas.toDataURL('image/jpeg', options?.quality ?? 0.9);
  } catch {
    // Tainted canvas / unsupported image source
    return null;
  }
}

function makeTextureEdit(
  slot: WorkflowModelPbrSlot,
  dataUrl: string,
  fileName: string,
  channel = defaultWorkflowPbrChannel(slot)
): WorkflowModelPbrTextureEdit {
  const mimeType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  return {
    dataUrl,
    fileName,
    mimeType,
    channel,
    colorSpace: defaultWorkflowPbrColorSpace(slot),
    source: 'embedded',
    enabled: true,
    updatedAt: Date.now(),
  };
}

function exportSlotTexture(
  slot: WorkflowModelPbrSlot,
  texture: ExtractableTextureLike | null | undefined,
  fileName: string,
  channel: WorkflowModelPbrTextureEdit['channel'] | undefined,
  exportTexture: ExtractTextureExporter,
  options?: { bakeChannel?: boolean }
): WorkflowModelPbrTextureEdit | null {
  if (!texture) return null;
  const preferPng = slot === 'baseColor' || slot === 'normal' || slot === 'height' || slot === 'alpha';
  const sourceChannel = channel || defaultWorkflowPbrChannel(slot);
  const bakeChannel = Boolean(options?.bakeChannel) && sourceChannel !== 'rgb';
  // Bake R/G/B out of packed ORM so slot thumbs are grayscale, not rainbow noise.
  const dataUrl = exportTexture(texture, {
    mimeType: preferPng ? 'image/png' : 'image/jpeg',
    quality: slot === 'baseColor' ? 0.95 : 0.88,
    maxEdge: slot === 'baseColor' ? 4096 : undefined,
    ...(bakeChannel ? { channel: sourceChannel } : {}),
  });
  if (!dataUrl) return null;
  return makeTextureEdit(slot, dataUrl, fileName, bakeChannel ? 'rgb' : sourceChannel);
}

/**
 * Read embedded material maps into PBR panel slot edits.
 * glTF packed metallicRoughness → roughness=G / metallic=B; AO sharing that map → R.
 */
export function extractPbrSlotEditsFromMaterial(
  material: ExtractablePbrMaterialLike,
  options?: {
    materialLabel?: string;
    exportTexture?: ExtractTextureExporter;
  }
): Partial<Record<WorkflowModelPbrSlot, WorkflowModelPbrTextureEdit>> {
  const label = String(options?.materialLabel || material.name || 'material')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 48) || 'material';
  const exportTexture = options?.exportTexture || extractableTextureToDataUrl;
  const out: Partial<Record<WorkflowModelPbrSlot, WorkflowModelPbrTextureEdit>> = {};

  const map = material.map || null;
  const normalMap = material.normalMap || null;
  const aoMap = material.aoMap || null;
  const roughnessMap = material.roughnessMap || null;
  const metalnessMap = material.metalnessMap || null;
  const emissiveMap = material.emissiveMap || null;
  const alphaMap = material.alphaMap || null;
  const heightMap = material.displacementMap || material.bumpMap || null;

  const packedMr = Boolean(roughnessMap && metalnessMap && roughnessMap === metalnessMap);
  const aoPackedWithMr = Boolean(
    aoMap && ((roughnessMap && aoMap === roughnessMap) || (metalnessMap && aoMap === metalnessMap))
  );

  const base = exportSlotTexture('baseColor', map, `${label}_basecolor.jpg`, 'rgb', exportTexture);
  if (base) out.baseColor = base;

  const normal = exportSlotTexture('normal', normalMap, `${label}_normal.png`, 'rgb', exportTexture);
  if (normal) out.normal = normal;

  // Packed ORM: pull R/G/B into separate grayscale images (stored as channel=rgb).
  const ao = exportSlotTexture(
    'ao',
    aoMap,
    `${label}_ao.jpg`,
    aoPackedWithMr ? 'r' : defaultWorkflowPbrChannel('ao'),
    exportTexture,
    { bakeChannel: aoPackedWithMr }
  );
  if (ao) out.ao = ao;

  const roughness = exportSlotTexture(
    'roughness',
    roughnessMap,
    `${label}_roughness.jpg`,
    packedMr ? 'g' : defaultWorkflowPbrChannel('roughness'),
    exportTexture,
    { bakeChannel: packedMr }
  );
  if (roughness) out.roughness = roughness;

  const metallic = exportSlotTexture(
    'metallic',
    metalnessMap,
    `${label}_metallic.jpg`,
    packedMr ? 'b' : defaultWorkflowPbrChannel('metallic'),
    exportTexture,
    { bakeChannel: packedMr }
  );
  if (metallic) out.metallic = metallic;

  const emissive = exportSlotTexture('emissive', emissiveMap, `${label}_emissive.jpg`, 'rgb', exportTexture);
  if (emissive) out.emissive = emissive;

  const alpha = exportSlotTexture(
    'alpha',
    alphaMap,
    `${label}_alpha.png`,
    defaultWorkflowPbrChannel('alpha'),
    exportTexture
  );
  if (alpha) out.alpha = alpha;

  const height = exportSlotTexture(
    'height',
    heightMap,
    `${label}_height.png`,
    defaultWorkflowPbrChannel('height'),
    exportTexture
  );
  if (height) out.height = height;

  return out;
}

export function pbrEditDocHasEnabledSlot(doc: WorkflowModelPbrEditDoc | null | undefined): boolean {
  if (!doc?.materials) return false;
  for (const mat of Object.values(doc.materials)) {
    for (const edit of Object.values(mat.slots || {})) {
      if (edit?.enabled) return true;
    }
  }
  return false;
}

export function buildSeededPbrDocFromMaterialSlots(
  slots: SeedMaterialSlotInput[],
  meta: {
    assetId: string;
    variantId?: string;
    modelKey: string;
  },
  options?: {
    exportTexture?: ExtractTextureExporter;
  }
): WorkflowModelPbrEditDoc | null {
  const materials: WorkflowModelPbrEditDoc['materials'] = {};
  let any = false;
  for (const slot of slots) {
    const extracted = extractPbrSlotEditsFromMaterial(slot.material, {
      materialLabel: slot.label,
      exportTexture: options?.exportTexture,
    });
    if (Object.keys(extracted).length === 0) continue;
    const materialEdit: WorkflowModelPbrMaterialEdit = {
      materialName: slot.label,
      slots: extracted,
    };
    materials[slot.id] = materialEdit;
    any = true;
  }
  if (!any) return null;
  return {
    version: 1,
    assetId: String(meta.assetId || '').trim() || 'unknown_asset',
    ...(meta.variantId ? { variantId: meta.variantId } : {}),
    modelKey: String(meta.modelKey || '').trim() || 'unknown_model',
    updatedAt: Date.now(),
    materials,
  };
}
