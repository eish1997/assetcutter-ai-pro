import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  formatSuffixFromFileName,
  workflowAssetFormatBadgeLabel,
} from '../services/workflowAssetFormatBadge';

function makeAsset(partial?: Partial<WorkflowAsset>): WorkflowAsset {
  return {
    id: 'a1',
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...partial,
  };
}

describe('workflowAssetFormatBadge', () => {
  it('reads suffix from names, urls, and data urls', () => {
    expect(formatSuffixFromFileName('文本.md')).toBe('MD');
    expect(formatSuffixFromFileName('clip.mp4')).toBe('MP4');
    expect(formatSuffixFromFileName('hero.JPEG')).toBe('JPG');
    expect(formatSuffixFromFileName('ac-workshop://v1/tok/prop.fbx')).toBe('FBX');
    expect(formatSuffixFromFileName('https://cdn.example.com/a.webm?x=1')).toBe('WEBM');
    expect(formatSuffixFromFileName('data:video/mp4;base64,xx')).toBe('MP4');
    expect(formatSuffixFromFileName('blob:https://x/1')).toBe('');
  });

  it('uses filename then model format, never a generic VIDEO/TEXT label', () => {
    expect(
      workflowAssetFormatBadgeLabel(
        makeAsset({ assetKind: 'video', textTitle: 'shot.mov', original: 'blob:video' }),
      ),
    ).toBe('MOV');
    expect(
      workflowAssetFormatBadgeLabel(
        makeAsset({ assetKind: 'text', textTitle: '文本.md', textBody: 'hi' }),
      ),
    ).toBe('MD');
    expect(
      workflowAssetFormatBadgeLabel(
        makeAsset({
          modelSourceName: 'temp.fbx',
          stepModelUrls: { original: ['blob:model'] },
          stepModelFormats: { original: ['fbx'] },
        }),
      ),
    ).toBe('FBX');
    expect(
      workflowAssetFormatBadgeLabel(
        makeAsset({
          displayKey: 'generate_3d',
          results: { generate_3d: 'data:image/png;base64,POSTER' },
          resultOrder: ['generate_3d'],
          stepModelUrls: { generate_3d: ['blob:model.glb', 'blob:model.fbx'] },
          stepModelFormats: { generate_3d: ['glb', 'fbx'] },
          resultMeta: { generate_3d: { executedAt: 2, mediaKind: 'model3d' } },
        }),
      ),
    ).toBe('GLB');
    expect(workflowAssetFormatBadgeLabel(makeAsset({ assetKind: 'video', original: 'blob:video' }))).toBe('');
  });
});
