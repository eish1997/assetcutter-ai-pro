import { describe, expect, it } from 'vitest';

import type { CapabilitySet, CustomAppModule } from '../types';
import { executeCapabilitySet, validateCapabilitySetGraph } from '../services/capabilityExecutor';

function makePreset(id: string): CustomAppModule {
  return {
    id,
    label: id,
    category: 'image_to_image',
    engine: 'builtin',
    instruction: '',
  };
}

function makeSet(nodes: CapabilitySet['nodes'], edges: CapabilitySet['edges']): CapabilitySet {
  return {
    id: 'set-1',
    label: '测试集合',
    nodes,
    edges,
  };
}

describe('validateCapabilitySetGraph', () => {
  it('在缺少输出节点时返回错误', () => {
    const set = makeSet(
      [
        { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: '输入' } },
      ],
      []
    );

    expect(validateCapabilitySetGraph(set, [])).toBe('能力集合至少需要 1 个输出节点');
  });

  it('在引用不存在的预设时返回错误', () => {
    const set = makeSet(
      [
        { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: '输入' } },
        { id: 'preset', type: 'preset', position: { x: 1, y: 0 }, data: { label: '能力', presetId: 'missing' } },
        { id: 'output', type: 'output', position: { x: 2, y: 0 }, data: { label: '输出' } },
      ],
      [
        { id: 'e1', source: 'input', target: 'preset' },
        { id: 'e2', source: 'preset', target: 'output' },
      ]
    );

    expect(validateCapabilitySetGraph(set, [makePreset('other')])).toBe('节点「能力」引用了不存在的预设');
  });

  it('测试断点缺少入边或出边时返回错误', () => {
    const set = makeSet(
      [
        { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: '输入' } },
        { id: 'ts', type: 'testStop', position: { x: 1, y: 0 }, data: { label: '测试' } },
        { id: 'output', type: 'output', position: { x: 2, y: 0 }, data: { label: '输出' } },
      ],
      [
        { id: 'e0', source: 'input', target: 'output' },
        { id: 'e1', source: 'ts', target: 'output' },
      ]
    );
    expect(validateCapabilitySetGraph(set, [])).toContain('测试断点');
  });
});

describe('executeCapabilitySet', () => {
  it('在环路导致无法继续执行时返回失败而不是伪成功', async () => {
    const preset = makePreset('p1');
    const set = makeSet(
      [
        { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: '输入' } },
        { id: 'preset-a', type: 'preset', position: { x: 1, y: 0 }, data: { label: '能力A', presetId: 'p1' } },
        { id: 'preset-b', type: 'preset', position: { x: 2, y: 0 }, data: { label: '能力B', presetId: 'p1' } },
        { id: 'output', type: 'output', position: { x: 3, y: 0 }, data: { label: '输出' } },
      ],
      [
        { id: 'e1', source: 'input', target: 'preset-a' },
        { id: 'e2', source: 'preset-a', target: 'preset-b' },
        { id: 'e3', source: 'preset-b', target: 'preset-a' },
        { id: 'e4', source: 'preset-b', target: 'output' },
      ]
    );

    const result = await executeCapabilitySet(set, 'data:image/png;base64,input', { presets: [preset] });

    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error('expected failure result');
    expect(result.error).toContain('能力集合无法继续执行');
  });

  it('在输出节点只接收到 textGen 等非图像输入时返回失败', async () => {
    const set = makeSet(
      [
        { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: '输入' } },
        { id: 'text', type: 'textGen', position: { x: 1, y: 0 }, data: { label: '文本', text: '仅文本说明' } },
        { id: 'output', type: 'output', position: { x: 2, y: 0 }, data: { label: '输出' } },
      ],
      [
        { id: 'e1', source: 'input', target: 'text' },
        { id: 'e2', source: 'text', target: 'output' },
      ]
    );

    const result = await executeCapabilitySet(set, 'data:image/png;base64,input', { presets: [] });

    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error('expected failure result');
    expect(result.error).toContain('未收到有效图像输入');
  });

  it('stopAtNodeId 在测试断点处返回当前图且不跑下游预设', async () => {
    const preset = makePreset('p1');
    const set = makeSet(
      [
        { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: '输入' } },
        { id: 'ts', type: 'testStop', position: { x: 1, y: 0 }, data: { label: '测试' } },
        { id: 'preset', type: 'preset', position: { x: 2, y: 0 }, data: { label: '能力', presetId: 'p1' } },
        { id: 'output', type: 'output', position: { x: 3, y: 0 }, data: { label: '输出' } },
      ],
      [
        { id: 'e1', source: 'input', target: 'ts' },
        { id: 'e2', source: 'ts', target: 'preset' },
        { id: 'e3', source: 'preset', target: 'output' },
      ]
    );
    const img = 'data:image/png;base64,QUJD';
    const result = await executeCapabilitySet(set, img, {
      presets: [preset],
      stopAtNodeId: 'ts',
    });
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.kind !== 'image') throw new Error('expected image');
    expect(result.image).toBe(img);
  });
});
