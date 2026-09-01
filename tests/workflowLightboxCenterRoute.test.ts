import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  resolveLightboxCenterRoute,
  resolveLightboxChromeSlots,
  resolveLightboxInstantShellLabel,
  resolveLightboxPreviewImageSrc,
} from '../services/workflowLightboxCenterRoute';
import type { WorkflowAsset, WorkflowAssetVariant } from '../types';

function makeAsset(partial: Partial<WorkflowAsset> = {}): WorkflowAsset {
  return {
    id: 'asset-1',
    original: 'data:image/png;base64,AAA',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...partial,
  };
}

function makeVariant(partial: Partial<WorkflowAssetVariant> = {}): WorkflowAssetVariant {
  return {
    id: 'original',
    label: 'Original',
    kind: 'image',
    source: 'original',
    url: 'data:image/png;base64,AAA',
    ...partial,
  };
}

describe('resolveLightboxCenterRoute', () => {
  it('routes workshop markdown with empty body to text without imageSrc', () => {
    const asset = makeAsset({
      assetKind: 'text',
      original: '',
      textTitle: 'note.md',
      textBody: '',
    });
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: makeVariant({ kind: 'text', url: '', text: '' }),
      displayImage: '',
      workshopGridThumb: '',
      isWorkshopCard: true,
    });
    expect(route.mode).toBe('text');
    expect(route.useTextCenter).toBe(true);
    expect(route.centerSlotFullBleed).toBe(true);
    expect(route.imageSrc).toBeUndefined();
    expect(
      resolveLightboxPreviewImageSrc({
        mode: route.mode,
        displayImage: 'data:image/svg+xml;utf8,x',
        isWorkshopCard: true,
      })
    ).toBe('');
  });

  it('routes workshop mp4 playable variant to media video', () => {
    const asset = makeAsset({
      assetKind: 'video',
      original: 'ac-workshop://v1/tok/clip.mp4',
      textTitle: 'clip.mp4',
    });
    const variant = makeVariant({
      kind: 'video',
      url: 'ac-workshop://v1/tok/clip.mp4',
    });
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: variant,
      displayImage: '',
      isWorkshopCard: true,
    });
    expect(route.mode).toBe('media');
    expect(route.useMediaCenter).toBe(true);
    expect(route.mediaVariant?.kind).toBe('video');
    expect(route.centerSlotFullBleed).toBe(true);
    expect(route.imageSrc).toBeUndefined();
  });

  it('routes workshop glb with stepModelUrls to media model3d', () => {
    const asset = makeAsset({
      assetKind: 'model3d',
      original: '',
      textTitle: 'hero.glb',
      stepModelUrls: { original: ['ac-workshop://v1/tok/hero.glb'] },
    });
    const variant = makeVariant({
      kind: 'model3d',
      url: 'ac-workshop://v1/tok/hero.glb',
      modelUrls: ['ac-workshop://v1/tok/hero.glb'],
    });
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: variant,
      displayImage: '',
      isWorkshopCard: true,
    });
    expect(route.mode).toBe('media');
    expect(route.mediaVariant?.kind).toBe('model3d');
    expect(route.imageSrc).toBeUndefined();
  });

  it('routes a jpeg image to image mode', () => {
    const asset = makeAsset();
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: makeVariant(),
      displayImage: 'data:image/jpeg;base64,xx',
      isWorkshopCard: false,
    });
    expect(route.mode).toBe('image');
    expect(route.useTextCenter).toBe(false);
    expect(route.useMediaCenter).toBe(false);
    expect(route.imageSrc).toBe('data:image/jpeg;base64,xx');
  });

  it('prefers texture preview as imageSrc', () => {
    const asset = makeAsset({ assetKind: 'model3d', original: '' });
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: makeVariant({ kind: 'model3d', url: 'blob:model' }),
      texturePreviewSrc: 'data:image/png;base64,TEX',
      displayImage: '',
      isWorkshopCard: false,
    });
    expect(route.mode).toBe('image');
    expect(route.imageSrc).toBe('data:image/png;base64,TEX');
    expect(route.useMediaCenter).toBe(false);
  });

  it('routes a text asset whose displayKey points at a raster result to image', () => {
    const asset = makeAsset({
      assetKind: 'text',
      original: '',
      displayKey: 'render',
      textTitle: 'Brief',
      textBody: 'hello',
      results: { render: 'data:image/png;base64,OUT' },
      resultOrder: ['render'],
      resultMeta: { render: { executedAt: 2, mediaKind: 'image' } },
    });
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: makeVariant({
        id: 'render',
        kind: 'image',
        source: 'result',
        url: 'data:image/png;base64,OUT',
      }),
      displayImage: 'data:image/png;base64,OUT',
      isWorkshopCard: false,
    });
    expect(route.mode).toBe('image');
    expect(route.useTextCenter).toBe(false);
    expect(route.imageSrc).toBe('data:image/png;base64,OUT');
  });

  it('keeps image-card attached 3D on image mode when variant is still image', () => {
    const asset = makeAsset({
      original: 'data:image/png;base64,SRC',
      modelUrls: ['blob:tripo.glb'],
    });
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: makeVariant({ kind: 'image', url: 'data:image/png;base64,SRC' }),
      displayImage: 'data:image/png;base64,SRC',
      isWorkshopCard: false,
    });
    expect(route.mode).toBe('image');
    expect(route.useMediaCenter).toBe(false);
  });
});

describe('resolveLightboxInstantShellLabel', () => {
  it('labels text media and image boots', () => {
    expect(resolveLightboxInstantShellLabel('text')).toBe('文本加载中…');
    expect(resolveLightboxInstantShellLabel('media')).toBe('媒体加载中…');
    expect(resolveLightboxInstantShellLabel('image')).toBe('图片加载中…');
  });
});

describe('resolveLightboxChromeSlots', () => {
  it('shows layout cluster for raster image and model3d cluster for native glb', () => {
    expect(
      resolveLightboxChromeSlots({
        mode: 'image',
        previewLayout: 'flat',
        rasterEligible: true,
        workshopNeedsApply: false,
      }).typeCluster
    ).toBe('layout');
    expect(
      resolveLightboxChromeSlots({
        mode: 'media',
        previewLayout: 'flat',
        rasterEligible: false,
        workshopNeedsApply: true,
        mediaKind: 'model3d',
      })
    ).toMatchObject({
      assetOps: true,
      showApply: true,
      typeCluster: 'model3d',
      canvas: false,
      window: true,
    });
    expect(
      resolveLightboxChromeSlots({
        mode: 'image',
        previewLayout: 'model3d',
        rasterEligible: true,
        workshopNeedsApply: false,
      }).typeCluster
    ).toBe('model3d');
    expect(
      resolveLightboxChromeSlots({
        mode: 'text',
        previewLayout: 'flat',
        rasterEligible: false,
        workshopNeedsApply: false,
      }).typeCluster
    ).toBe('none');
    expect(
      resolveLightboxChromeSlots({
        mode: 'media',
        previewLayout: 'flat',
        rasterEligible: false,
        workshopNeedsApply: false,
        mediaKind: 'video',
      }).typeCluster
    ).toBe('none');
  });
});

describe('WorkflowSection lightbox route wiring', () => {
  it('consumes resolveLightboxCenterRoute and does not hand-write media kinds', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(src).toContain('resolveLightboxCenterRoute');
    expect(src).not.toMatch(
      /lightboxMediaCenterVariant\s*=\s*\n[\s\S]{0,400}kind === 'video' \|\|[\s\S]{0,200}kind === 'model3d'/
    );
    const overlay = fs.readFileSync(
      path.resolve(process.cwd(), 'components/workflow/AssetPreviewOverlay.tsx'),
      'utf8'
    );
    expect(overlay).not.toContain('AssetPreviewShell');
    const mediaCenter = fs.readFileSync(
      path.resolve(process.cwd(), 'components/workflow/AssetMediaPreviewCenter.tsx'),
      'utf8'
    );
    expect(mediaCenter).not.toContain('onAddToComposeInput');
    expect(src).toContain('resolveLightboxPreviewImageSrc');
    expect(src).toContain('WorkflowLightboxModel3dRail');
    expect(src).toContain('mountLightboxLoadingCover');
    expect(src).not.toContain('captureWorkflowListScrollSnapshot');
    expect(src).not.toMatch(
      /contentRightInset=\{\s*lightboxChromeReady \? WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_INSET : '0px'/
    );
    expect(src).toContain("lightboxUiHidden ? '0px' : WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_INSET");
  });
});
