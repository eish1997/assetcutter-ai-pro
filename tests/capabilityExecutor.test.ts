import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilitySet, CustomAppModule } from '../types';
import {
  collapseTestStopsForExecution,
  executeCapability,
  executeCapabilitySet,
  validateCapabilitySetGraph,
} from '../services/capabilityExecutor';

const {
  mockSubmitProbe,
  mockSubmitExec,
  mockGetCompanionBase,
  mockNormalizeCompanionBaseUrl,
} = vi.hoisted(() => ({
  mockSubmitProbe: vi.fn(),
  mockSubmitExec: vi.fn(),
  mockGetCompanionBase: vi.fn(),
  mockNormalizeCompanionBaseUrl: vi.fn(),
}));

vi.mock('../services/companionClient/compute', () => ({
  submitCompanionHostBundleProbeJob: mockSubmitProbe,
  submitCompanionHostBundleExecJob: mockSubmitExec,
}));

vi.mock('../services/companionLocalPrefs', () => ({
  getCompanionLocalBaseUrl: mockGetCompanionBase,
  normalizeCompanionBaseUrl: mockNormalizeCompanionBaseUrl,
}));

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

beforeEach(() => {
  mockSubmitProbe.mockReset();
  mockSubmitExec.mockReset();
  mockGetCompanionBase.mockReset();
  mockNormalizeCompanionBaseUrl.mockReset();
  mockGetCompanionBase.mockReturnValue('http://127.0.0.1:18765/');
  mockNormalizeCompanionBaseUrl.mockImplementation((raw: string) => String(raw).replace(/\/+$/, ''));
});

describe('validateCapabilitySetGraph', () => {
  it('允许仅有资产输入节点而无 legacy input（与画布默认一致）', () => {
    const set = makeSet(
      [
        { id: 'asset-in', type: 'assetInput', position: { x: 0, y: 0 }, data: { label: '资产' } },
        { id: 'out', type: 'output', position: { x: 2, y: 0 }, data: { label: '输出' } },
      ],
      [{ id: 'e1', source: 'asset-in', target: 'out' }]
    );
    expect(validateCapabilitySetGraph(set, [])).toBe(null);
  });

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

describe('collapseTestStopsForExecution', () => {
  it('全流程时移除全部测试节点并桥接边', () => {
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
    const collapsed = collapseTestStopsForExecution(set, null);
    expect(collapsed.nodes.some((n) => n.type === 'testStop')).toBe(false);
    expect(collapsed.edges.some((e) => e.source === 'input' && e.target === 'preset')).toBe(true);
    expect(collapsed.edges.some((e) => e.source === 'ts')).toBe(false);
  });

  it('保留 stopAt 指定的测试节点并仍移除其它测试点', () => {
    const set = makeSet(
      [
        { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: '输入' } },
        { id: 'ts1', type: 'testStop', position: { x: 1, y: 0 }, data: { label: '测1' } },
        { id: 'ts2', type: 'testStop', position: { x: 2, y: 0 }, data: { label: '测2' } },
        { id: 'out', type: 'output', position: { x: 3, y: 0 }, data: { label: '输出' } },
      ],
      [
        { id: 'e1', source: 'input', target: 'ts1' },
        { id: 'e2', source: 'ts1', target: 'ts2' },
        { id: 'e3', source: 'ts2', target: 'out' },
      ]
    );
    const collapsed = collapseTestStopsForExecution(set, 'ts2');
    const ids = collapsed.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['input', 'out', 'ts2']);
    expect(collapsed.edges.some((e) => e.source === 'input' && e.target === 'ts2')).toBe(true);
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
    expect(result.failedNodeId).toBe('output');
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
    expect(result.nodeImageOutputs?.input).toBe(img);
    expect(result.nodeImageOutputs?.ts).toBe(img);
  });
});

describe('executeCapability: companion host bundle', () => {
  it('phase=probe 时提交 host_bundle.probe 并返回文字结果', async () => {
    const preset: CustomAppModule = {
      id: 'hb-probe',
      label: '宿主包校验',
      category: 'image_to_image',
      engine: 'builtin',
      instruction: '',
      companionHostBundle: { dirName: 'sample-plugin', phase: 'probe' },
    };
    mockSubmitProbe.mockResolvedValue({
      ok: true,
      data: { jobId: 'job-probe-1', status: 'queued', job: { jobId: 'job-probe-1' } },
      latencyMs: 12,
      status: 200,
    });

    const result = await executeCapability(preset, '', { companionProjectId: 'proj-1' });
    expect(mockSubmitProbe).toHaveBeenCalledWith('http://127.0.0.1:18765', 'sample-plugin', { projectId: 'proj-1' });
    expect(mockSubmitExec).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.kind !== 'text') throw new Error('expected text success');
    expect(result.text).toContain('host_bundle.probe');
    expect(result.text).toContain('job-probe-1');
  });

  it('phase 缺省时默认走 host_bundle.exec', async () => {
    const preset: CustomAppModule = {
      id: 'hb-exec',
      label: '宿主包执行',
      category: 'text_to_text',
      engine: 'builtin',
      instruction: '',
      companionHostBundle: { dirName: 'sample-plugin' },
    };
    mockSubmitExec.mockResolvedValue({
      ok: true,
      data: { jobId: 'job-exec-1', status: 'queued', job: { jobId: 'job-exec-1' } },
      latencyMs: 10,
      status: 200,
    });

    const result = await executeCapability(preset, '', {});
    expect(mockSubmitExec).toHaveBeenCalledWith('http://127.0.0.1:18765', 'sample-plugin', { projectId: undefined });
    expect(mockSubmitProbe).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.kind !== 'text') throw new Error('expected text success');
    expect(result.text).toContain('host_bundle.exec');
  });

  it('伴侣请求失败时返回错误', async () => {
    const preset: CustomAppModule = {
      id: 'hb-fail',
      label: '宿主包失败',
      category: 'image_to_image',
      engine: 'builtin',
      instruction: '',
      companionHostBundle: { dirName: 'broken-plugin', phase: 'exec' },
    };
    mockSubmitExec.mockResolvedValue({
      ok: false,
      error: 'ECONNREFUSED',
      latencyMs: 10,
    });

    const result = await executeCapability(preset, '', {});
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error('expected failed result');
    expect(result.error).toContain('ECONNREFUSED');
  });
});
