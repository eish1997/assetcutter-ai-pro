import { describe, expect, it } from 'vitest';
import type { File3D } from '../services/tencentService';
import { extractTencentModelAndPreviewUrls } from '../services/generate3d/tencentWorkflow';
import { normalizeGenerate3DPresetForRun } from '../services/generate3d';

describe('tencent workflow helpers', () => {
  it('extractTencentModelAndPreviewUrls 优先 GLB 并提取预览', () => {
    const files: File3D[] = [
      { Type: 'OBJ', Url: 'https://cdn.example.com/a.obj', PreviewImageUrl: 'https://cdn.example.com/p.png' },
      { Type: 'GLB', Url: 'https://cdn.example.com/a.glb' },
    ];
    const out = extractTencentModelAndPreviewUrls(files);
    expect(out.modelUrls[0]).toContain('.glb');
    expect(out.previewUrl).toContain('.png');
    expect(out.orderedFiles[0]?.Type).toBe('GLB');
  });

  it('normalizeGenerate3DPresetForRun 区分 pro 与 rapid 格式', () => {
    const rapid = normalizeGenerate3DPresetForRun({ module: 'rapid', resultFormat: 'GLB' });
    expect(rapid.resultFormat).toBe('GLB');
    const pro = normalizeGenerate3DPresetForRun({ module: 'pro', resultFormat: 'INVALID', faceCount: 50 });
    expect(pro.resultFormat).toBeUndefined();
    expect(pro.faceCount).toBe(10000);
  });
});
