import { describe, expect, it } from 'vitest';
import { inferModelFormat, resolveWorkflowPbrTextureFlipY } from '../services/workflowModelThreeShared';

describe('inferModelFormat', () => {
  it('blob URL 无扩展名时按 GLB/GLTF 路径推断（工作流预览常见）', () => {
    expect(inferModelFormat('blob:http://localhost:3000/abc-123')).toBe('gltf');
  });

  it('仍可从文件名识别 FBX（含 _fbx 片段）', () => {
    expect(inferModelFormat('blob:http://x/y', 'slot_fbx_v1')).toBe('fbx');
  });
  it('uses the file-name hint to identify OBJ blob previews', () => {
    expect(inferModelFormat('blob:http://x/y', 'uploaded-model.obj')).toBe('obj');
  });
});

describe('resolveWorkflowPbrTextureFlipY', () => {
  it('uses glTF convention for glb/gltf', () => {
    expect(resolveWorkflowPbrTextureFlipY('gltf', { source: 'user' })).toBe(false);
    expect(resolveWorkflowPbrTextureFlipY('gltf', { source: 'embedded' })).toBe(false);
  });

  it('uses TextureLoader default for FBX/OBJ manual maps', () => {
    expect(resolveWorkflowPbrTextureFlipY('fbx', { source: 'user' })).toBe(true);
    expect(resolveWorkflowPbrTextureFlipY('obj', { source: 'user' })).toBe(true);
  });

  it('falls back by edit source when format unknown', () => {
    expect(resolveWorkflowPbrTextureFlipY('unknown', { source: 'embedded' })).toBe(false);
    expect(resolveWorkflowPbrTextureFlipY('unknown', { source: 'user' })).toBe(true);
  });
});
