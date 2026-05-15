import { describe, expect, it } from 'vitest';

// 仅验证模块可加载；blob 下载依赖浏览器 DOM，在 node 环境不测 fetch(blob:)
describe('downloadModelFile', () => {
  it('exports download helpers', async () => {
    const mod = await import('../services/downloadModelFile');
    expect(typeof mod.downloadModelFromSource).toBe('function');
    expect(typeof mod.downloadWorkflowStepModelSlot).toBe('function');
  });
});
