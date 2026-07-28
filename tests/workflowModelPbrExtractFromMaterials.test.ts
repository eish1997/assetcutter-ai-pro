import { describe, expect, it } from 'vitest';
import {
  buildSeededPbrDocFromMaterialSlots,
  extractPbrSlotEditsFromMaterial,
  extractableTextureToDataUrl,
  isolateImageDataToChannel,
  pbrEditDocHasEnabledSlot,
  type ExtractablePbrMaterialLike,
  type ExtractableTextureLike,
  type ExtractTextureExportOptions,
} from '../services/workflowModelPbrExtractFromMaterials';

function fakeTex(id: string): ExtractableTextureLike {
  return { image: { width: 4, height: 4 }, name: id };
}

const fakeExport = (
  texture: ExtractableTextureLike | null | undefined,
  options?: ExtractTextureExportOptions
) =>
  texture?.image
    ? `data:image/png;base64,${texture.name || 'x'}:${options?.channel || 'rgb'}`
    : null;

describe('workflowModelPbrExtractFromMaterials', () => {
  it('returns null when texture has no drawable image', () => {
    expect(extractableTextureToDataUrl({ image: null })).toBeNull();
    expect(extractableTextureToDataUrl({ image: { width: 0, height: 0 } })).toBeNull();
  });

  it('bakes packed metallicRoughness channels into separate grayscale thumbs (channel=rgb)', () => {
    const packed = fakeTex('packed');
    const material: ExtractablePbrMaterialLike = {
      name: 'Body',
      map: fakeTex('base'),
      normalMap: fakeTex('normal'),
      aoMap: packed,
      roughnessMap: packed,
      metalnessMap: packed,
    };
    const slots = extractPbrSlotEditsFromMaterial(material, { exportTexture: fakeExport });
    expect(slots.baseColor?.enabled).toBe(true);
    expect(slots.baseColor?.channel).toBe('rgb');
    expect(slots.normal?.channel).toBe('rgb');
    expect(slots.ao?.channel).toBe('rgb');
    expect(slots.roughness?.channel).toBe('rgb');
    expect(slots.metallic?.channel).toBe('rgb');
    expect(slots.ao?.dataUrl).toBe('data:image/png;base64,packed:r');
    expect(slots.roughness?.dataUrl).toBe('data:image/png;base64,packed:g');
    expect(slots.metallic?.dataUrl).toBe('data:image/png;base64,packed:b');
  });

  it('keeps channel tags for non-packed roughness/metallic maps', () => {
    const material: ExtractablePbrMaterialLike = {
      name: 'Split',
      roughnessMap: fakeTex('rough'),
      metalnessMap: fakeTex('metal'),
    };
    const slots = extractPbrSlotEditsFromMaterial(material, { exportTexture: fakeExport });
    expect(slots.roughness?.channel).toBe('g');
    expect(slots.metallic?.channel).toBe('b');
    expect(slots.roughness?.dataUrl).toBe('data:image/png;base64,rough:rgb');
    expect(slots.metallic?.dataUrl).toBe('data:image/png;base64,metal:rgb');
  });

  it('isolateImageDataToChannel expands a channel to grayscale', () => {
    const image = {
      data: new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]),
      width: 2,
      height: 1,
      colorSpace: 'srgb',
    } as ImageData;
    isolateImageDataToChannel(image, 'g');
    expect(Array.from(image.data)).toEqual([20, 20, 20, 255, 60, 60, 60, 255]);
  });

  it('builds a seeded doc only when at least one map exists', () => {
    const empty = buildSeededPbrDocFromMaterialSlots(
      [{ id: 'mat-0', label: 'Empty', material: { name: 'Empty' } }],
      { assetId: 'a1', modelKey: 'm1' },
      { exportTexture: fakeExport }
    );
    expect(empty).toBeNull();

    const seeded = buildSeededPbrDocFromMaterialSlots(
      [
        {
          id: 'mat-0',
          label: 'Paint',
          material: { name: 'Paint', map: fakeTex('base') },
        },
      ],
      { assetId: 'a1', modelKey: 'm1' },
      { exportTexture: fakeExport }
    );
    expect(seeded).not.toBeNull();
    expect(pbrEditDocHasEnabledSlot(seeded)).toBe(true);
    expect(seeded?.materials['mat-0']?.slots.baseColor?.enabled).toBe(true);
  });

  it('pbrEditDocHasEnabledSlot is false for empty docs', () => {
    expect(pbrEditDocHasEnabledSlot(null)).toBe(false);
    expect(
      pbrEditDocHasEnabledSlot({
        version: 1,
        assetId: 'a',
        modelKey: 'm',
        updatedAt: 1,
        materials: { 'mat-0': { slots: {} } },
      })
    ).toBe(false);
  });
});
