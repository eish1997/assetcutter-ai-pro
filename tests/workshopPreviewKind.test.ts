import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  isWorkshopPlayableMediaUrl,
  isWorkshopPreviewableName,
  isWorkshopSpecialRasterName,
  isWorkshopTextPreviewName,
  workshopHostEntryKindFromName,
  workshopModelFormatFromName,
  workshopPreviewKindExts,
  workshopPreviewKindFromName,
  WORKSHOP_SPECIAL_RASTER_EXTS,
} from '../services/workshopPreviewKind';

const require = createRequire(import.meta.url);
const host = require('../companion-desktop/workshop-file-tree.cjs') as {
  kindFromName: (name: string) => string;
  IMAGE_EXTS: string[];
  SPECIAL_RASTER_EXTS: string[];
  MODEL_EXTS: string[];
  TEXT_EXTS: string[];
  VIDEO_EXTS: string[];
};

describe('workshopPreviewKind', () => {
  it('classifies first-wave extensions', () => {
    expect(workshopPreviewKindFromName('a.png')).toBe('image');
    expect(workshopPreviewKindFromName('a.glb')).toBe('model3d');
    expect(workshopPreviewKindFromName('a.txt')).toBe('text');
    expect(workshopPreviewKindFromName('a.mp4')).toBe('video');
    expect(workshopPreviewKindFromName('a.bin')).toBe('file');
    expect(workshopPreviewKindFromName('文本.md')).toBe('text');
    expect(isWorkshopTextPreviewName('文本.md')).toBe(true);
    expect(isWorkshopTextPreviewName('note.TXT')).toBe(true);
    expect(isWorkshopTextPreviewName('a.png')).toBe(false);
    expect(workshopPreviewKindFromName('sky.exr')).toBe('image');
    expect(workshopPreviewKindFromName('env.hdr')).toBe('image');
    expect(workshopPreviewKindFromName('layer.psd')).toBe('image');
    expect(isWorkshopSpecialRasterName('sky.exr')).toBe(true);
    expect(isWorkshopSpecialRasterName('env.HDR')).toBe(true);
    expect(isWorkshopSpecialRasterName('layer.psd')).toBe(true);
    expect(isWorkshopSpecialRasterName('a.png')).toBe(false);
    expect(isWorkshopPreviewableName('sky.exr')).toBe(true);
    expect(workshopHostEntryKindFromName('a.mp4')).toBe('video');
    expect(workshopHostEntryKindFromName('a.fbx')).toBe('model');
    expect(workshopModelFormatFromName('prop.fbx')).toBe('fbx');
    expect(workshopModelFormatFromName('hero.glb')).toBe('glb');
  });

  it('marks viewer-supported 3D only as previewable', () => {
    expect(isWorkshopPreviewableName('hero.glb')).toBe(true);
    expect(isWorkshopPreviewableName('hero.stl')).toBe(false);
    expect(isWorkshopPreviewableName('clip.mp4')).toBe(true);
  });

  it('treats ac-workshop urls as playable and data urls as not', () => {
    expect(isWorkshopPlayableMediaUrl('ac-workshop://v1/abc')).toBe(true);
    expect(isWorkshopPlayableMediaUrl('blob:https://x/1')).toBe(true);
    expect(isWorkshopPlayableMediaUrl('data:application/octet-stream;base64,xx')).toBe(false);
  });

  it('keeps host extension sets in sync with the TS table', () => {
    expect(host.IMAGE_EXTS).toEqual(workshopPreviewKindExts('image').sort());
    expect(host.SPECIAL_RASTER_EXTS).toEqual([...WORKSHOP_SPECIAL_RASTER_EXTS].sort());
    expect(host.kindFromName('a.exr')).toBe('image');
    expect(host.kindFromName('a.hdr')).toBe('image');
    expect(host.kindFromName('a.psd')).toBe('image');
    expect(host.MODEL_EXTS).toEqual(workshopPreviewKindExts('model3d').sort());
    expect(host.TEXT_EXTS).toEqual(workshopPreviewKindExts('text').sort());
    expect(host.VIDEO_EXTS).toEqual(workshopPreviewKindExts('video').sort());
    expect(host.kindFromName('a.mp4')).toBe('video');
    expect(host.kindFromName('a.webm')).toBe('video');
    expect(host.kindFromName('a.glb')).toBe('model');
  });
});
