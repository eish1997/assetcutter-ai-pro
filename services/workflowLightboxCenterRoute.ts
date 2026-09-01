import type { WorkflowAsset, WorkflowAssetVariant, WorkflowAssetVariantKind } from '../types';
import {
  isWorkflowTextAsset,
  workflowAssetCurrentDisplayIsTextChannel,
} from './workflowTextAsset';
import { isWorkshopTextPreviewName } from './workshopPreviewKind';

export type LightboxCenterMode = 'text' | 'media' | 'image';

export type LightboxCenterRoute = {
  mode: LightboxCenterMode;
  imageSrc?: string;
  mediaVariant: WorkflowAssetVariant | null;
  useTextCenter: boolean;
  useMediaCenter: boolean;
  centerSlotFullBleed: boolean;
};

export type LightboxCenterRouteInput = {
  asset: WorkflowAsset;
  activeVariant: WorkflowAssetVariant | null;
  texturePreviewSrc?: string;
  displayImage: string;
  workshopGridThumb?: string;
  isWorkshopCard: boolean;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isLightboxSvgDataUrl(src: string): boolean {
  return /^data:image\/svg\+xml/i.test(src);
}

export function isLightboxTextChannel(asset: WorkflowAsset): boolean {
  const workshopText = isWorkshopTextPreviewName(asset.textTitle || '');
  if (!(isWorkflowTextAsset(asset) || workshopText)) return false;
  return (
    workflowAssetCurrentDisplayIsTextChannel(asset) ||
    String(asset.displayKey || 'original').trim() === 'original' ||
    workshopText
  );
}

function pickMediaVariant(variant: WorkflowAssetVariant | null): WorkflowAssetVariant | null {
  if (!variant) return null;
  if (
    variant.kind === 'video' ||
    variant.kind === 'audio' ||
    variant.kind === 'file' ||
    variant.kind === 'model3d'
  ) {
    return variant;
  }
  return null;
}

function rasterSrc(
  displayImage: string,
  workshopGridThumb: string,
  isWorkshopCard: boolean,
  textChannel: boolean
): string {
  const display = clean(displayImage);
  if (display && !isLightboxSvgDataUrl(display)) return display;
  if (textChannel) return '';
  if (isWorkshopCard) {
    const thumb = clean(workshopGridThumb);
    if (thumb && !isLightboxSvgDataUrl(thumb)) return thumb;
  }
  return '';
}

export function resolveLightboxCenterRoute(input: LightboxCenterRouteInput): LightboxCenterRoute {
  const texture = clean(input.texturePreviewSrc);
  const textChannel = isLightboxTextChannel(input.asset);
  const raster = rasterSrc(
    input.displayImage,
    input.workshopGridThumb || '',
    input.isWorkshopCard,
    textChannel
  );

  if (texture) {
    return {
      mode: 'image',
      imageSrc: texture,
      mediaVariant: null,
      useTextCenter: false,
      useMediaCenter: false,
      centerSlotFullBleed: false,
    };
  }

  const media = pickMediaVariant(input.activeVariant);
  if (textChannel && !raster) {
    return {
      mode: 'text',
      mediaVariant: null,
      useTextCenter: true,
      useMediaCenter: false,
      // 铺满灯箱再左右居中，与底部输入条同一条中轴；不要在扣掉右侧缩略图条的舞台里居中（会视觉偏左）。
      centerSlotFullBleed: true,
    };
  }

  if (media) {
    return {
      mode: 'media',
      mediaVariant: media,
      useTextCenter: false,
      useMediaCenter: true,
      centerSlotFullBleed: true,
    };
  }

  return {
    mode: 'image',
    imageSrc: raster || undefined,
    mediaVariant: null,
    useTextCenter: false,
    useMediaCenter: false,
    centerSlotFullBleed: false,
  };
}

export function resolveLightboxPreviewImageSrc(input: {
  mode: LightboxCenterMode;
  displayImage: string;
  workshopGridThumb?: string;
  isWorkshopCard: boolean;
}): string {
  if (input.mode === 'text' || input.mode === 'media') return '';
  const display = clean(input.displayImage);
  if (display && !isLightboxSvgDataUrl(display)) return display;
  if (input.isWorkshopCard) {
    const thumb = clean(input.workshopGridThumb);
    if (thumb && !isLightboxSvgDataUrl(thumb)) return thumb;
  }
  return '';
}

export function resolveLightboxInstantShellLabel(mode: LightboxCenterMode): string {
  if (mode === 'text') return '文本加载中…';
  if (mode === 'media') return '媒体加载中…';
  return '图片加载中…';
}

export type LightboxChromeTypeCluster = 'layout' | 'model3d' | 'none';

export type LightboxChromeSlots = {
  assetOps: boolean;
  showApply: boolean;
  typeCluster: LightboxChromeTypeCluster;
  canvas: boolean;
  window: boolean;
};

export function resolveLightboxChromeSlots(input: {
  mode: LightboxCenterMode;
  previewLayout: 'flat' | 'pano' | 'model3d' | 'heightfield';
  rasterEligible: boolean;
  workshopNeedsApply: boolean;
  mediaKind?: WorkflowAssetVariantKind | null;
}): LightboxChromeSlots {
  const model3dCluster =
    input.previewLayout === 'model3d' ||
    (input.mode === 'media' && input.mediaKind === 'model3d');
  const typeCluster: LightboxChromeTypeCluster = model3dCluster
    ? 'model3d'
    : input.mode === 'image'
      ? 'layout'
      : 'none';
  return {
    assetOps: true,
    showApply: Boolean(input.workshopNeedsApply),
    typeCluster,
    canvas: input.mode === 'image' && input.previewLayout === 'flat' && input.rasterEligible,
    window: true,
  };
}
