import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  applyVgpAfterSuccessfulGen,
  createInitialVgpForAsset,
  buildCombinedPromptArtifact,
  resolveParentVersionIdForInput,
} from '../services/vgp/vgpStore';
import { ensureWorkflowAssetVgp } from '../services/vgp/migrateLegacyAsset';

function makeAsset(overrides: Partial<WorkflowAsset> = {}): WorkflowAsset {
  const id = 'asset-test-1';
  const createdAt = 1_700_000_000_000;
  return {
    id,
    original: 'data:image/png;base64,AAA',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt,
    ...overrides,
  };
}

describe('createInitialVgpForAsset', () => {
  it('创建原图版本与 headVersion', () => {
    const vgp = createInitialVgpForAsset({ id: 'a1', createdAt: 100 });
    expect(vgp.versionOrder.length).toBe(1);
    expect(vgp.originalVersionId).toBe(vgp.headVersionId);
    const ov = vgp.versionsById[vgp.originalVersionId!];
    expect(ov.role).toBe('original');
    expect(ov.parentVersionId).toBeNull();
  });
});

describe('applyVgpAfterSuccessfulGen', () => {
  it('追加生成步骤并链接父版本', () => {
    let a = makeAsset({ vgp: createInitialVgpForAsset({ id: 'asset-test-1', createdAt: 1_700_000_000_000 }) });
    a = {
      ...a,
      results: { line: 'data:image/png;base64,BBB' },
      resultOrder: ['line'],
      displayKey: 'line',
    };
    const next = applyVgpAfterSuccessfulGen(a, {
      resultKey: 'line',
      vgpSteps: [
        {
          stepKey: 'line',
          understoodPrompt: 'turn to lineart',
          presetId: 'p1',
          presetLabel: '线稿',
          modelId: 'gemini-test',
        },
      ],
      semanticSummary: '线稿',
      hadPromptOverride: false,
      inputSourceDisplayKey: 'original',
      now: 2_000_000_000_000,
    });
    expect(next.vgp?.versionOrder.length).toBe(2);
    const head = next.vgp!.versionsById[next.vgp!.headVersionId!];
    expect(head.role).toBe('generated');
    expect(head.parentVersionId).toBe(next.vgp!.originalVersionId);
    const art = next.vgp!.promptsById[head.promptArtifactId!];
    expect(art.compiled_prompt).toBe('turn to lineart');
  });

  it('继承语义产生新 semantic id', () => {
    let a = makeAsset({ vgp: createInitialVgpForAsset({ id: 'asset-test-1', createdAt: 1 }) });
    a = { ...a, results: { a: 'x' }, resultOrder: ['a'], displayKey: 'a' };
    a = applyVgpAfterSuccessfulGen(a, {
      resultKey: 'a',
      vgpSteps: [
        {
          stepKey: 'a',
          understoodPrompt: 'one',
          presetId: 'p1',
          presetLabel: 'A',
          modelId: 'm',
        },
      ],
      semanticSummary: 'A',
      hadPromptOverride: false,
      inputSourceDisplayKey: 'original',
    });
    const sem1 = a.vgp!.semanticsById[a.vgp!.versionsById[a.vgp!.headVersionId!].semanticStateId];
    a = { ...a, results: { ...a.results, b: 'y' }, resultOrder: [...(a.resultOrder || []), 'b'], displayKey: 'b' };
    a = applyVgpAfterSuccessfulGen(a, {
      resultKey: 'b',
      vgpSteps: [
        {
          stepKey: 'b',
          understoodPrompt: 'two',
          presetId: 'p2',
          presetLabel: 'B',
          modelId: 'm',
        },
      ],
      semanticSummary: 'B',
      hadPromptOverride: false,
      inputSourceDisplayKey: 'a',
    });
    const head2 = a.vgp!.versionsById[a.vgp!.headVersionId!];
    const sem2 = a.vgp!.semanticsById[head2.semanticStateId];
    expect(sem2.id).not.toBe(sem1.id);
    expect(sem2.provenance.kind).toBe('inherited');
    expect(sem2.provenance.parentSemanticId).toBe(sem1.id);
  });

  it('无 vgpSteps 时可用 userPromptRecord 写入生成说明', () => {
    let a = makeAsset({ vgp: createInitialVgpForAsset({ id: 'asset-test-1', createdAt: 1 }) });
    a = { ...a, results: { plain: 'data:image/png;base64,BBB' }, resultOrder: ['plain'], displayKey: 'plain' };
    const next = applyVgpAfterSuccessfulGen(a, {
      resultKey: 'plain',
      vgpSteps: [],
      semanticSummary: '底部输入',
      hadPromptOverride: true,
      inputSourceDisplayKey: 'original',
      now: 3_000_000_000_000,
      userPromptRecord: '把天空改成晚霞',
    });
    const head = next.vgp!.versionsById[next.vgp!.headVersionId!];
    const art = next.vgp!.promptsById[head.promptArtifactId!];
    expect(art.compiled_prompt).toBe('把天空改成晚霞');
    expect(art.applied_rules.some((r) => r.ruleId === 'user.submitted_prompt')).toBe(true);
  });
});

describe('buildCombinedPromptArtifact', () => {
  it('多步合并为一段文本', () => {
    const art = buildCombinedPromptArtifact(
      [
        {
          stepKey: 'a',
          understoodPrompt: 'first',
          presetId: '1',
          presetLabel: '一',
          modelId: 'm',
        },
        {
          stepKey: 'b',
          understoodPrompt: 'second',
          presetId: '2',
          presetLabel: '二',
          modelId: 'm',
        },
      ],
      100,
      [{ ruleId: 'capability.set', detail: 'x' }]
    );
    expect(art.compiled_prompt).toContain('【一】');
    expect(art.compiled_prompt).toContain('【二】');
    expect(art.applied_rules.some((r) => r.ruleId === 'capability.set')).toBe(true);
  });
});

describe('resolveParentVersionIdForInput', () => {
  it('指定 original 时指向原图版本，而非链头', () => {
    let a = makeAsset({ vgp: createInitialVgpForAsset({ id: 'asset-test-1', createdAt: 1 }) });
    a = {
      ...a,
      results: { line: 'data:x' },
      resultOrder: ['line'],
      displayKey: 'line',
    };
    a = applyVgpAfterSuccessfulGen(a, {
      resultKey: 'line',
      vgpSteps: [
        { stepKey: 'line', understoodPrompt: 'p', presetId: 'p1', presetLabel: 'L', modelId: 'm' },
      ],
      semanticSummary: 'L',
      hadPromptOverride: false,
      inputSourceDisplayKey: 'original',
    });
    const origId = a.vgp!.originalVersionId!;
    const lineHead = a.vgp!.headVersionId!;
    const fromOrig = resolveParentVersionIdForInput(a.vgp!, 'original');
    expect(fromOrig).toBe(origId);
    const fromHead = resolveParentVersionIdForInput(a.vgp!, undefined);
    expect(fromHead).toBe(lineHead);
  });

  it('从原图再次生图时父节点为原图而非上一链头', () => {
    let a = makeAsset({ vgp: createInitialVgpForAsset({ id: 'asset-test-1', createdAt: 1 }) });
    a = { ...a, results: { line: 'x' }, resultOrder: ['line'], displayKey: 'line' };
    a = applyVgpAfterSuccessfulGen(a, {
      resultKey: 'line',
      vgpSteps: [{ stepKey: 'line', understoodPrompt: 'p', presetId: 'p1', presetLabel: 'L', modelId: 'm' }],
      semanticSummary: 'L',
      hadPromptOverride: false,
      inputSourceDisplayKey: 'original',
    });
    const origId = a.vgp!.originalVersionId!;
    a = {
      ...a,
      results: { ...a.results, color: 'y' },
      resultOrder: [...(a.resultOrder || []), 'color'],
      displayKey: 'color',
    };
    a = applyVgpAfterSuccessfulGen(a, {
      resultKey: 'color',
      vgpSteps: [{ stepKey: 'color', understoodPrompt: 'p2', presetId: 'p2', presetLabel: 'C', modelId: 'm' }],
      semanticSummary: 'C',
      hadPromptOverride: false,
      inputSourceDisplayKey: 'original',
    });
    const head = a.vgp!.headVersionId!;
    expect(a.vgp!.versionsById[head].parentVersionId).toBe(origId);
  });
});

describe('ensureWorkflowAssetVgp', () => {
  it('无 vgp 且有 resultOrder 时惰性迁移', () => {
    const a = makeAsset({
      results: { k1: 'data:x' },
      resultOrder: ['k1'],
      displayKey: 'k1',
    });
    const m = ensureWorkflowAssetVgp(a);
    expect(m.vgp?.versionOrder.length).toBe(2);
    expect(m.vgp?.semanticsById[m.vgp!.versionsById[m.vgp!.headVersionId!].semanticStateId].target.summary).toBe(
      'legacy-migrated'
    );
  });

  it('vgp.versionOrder 与 versionsById 不同步时丢弃并按 resultOrder 重建', () => {
    const a = makeAsset({
      results: { k1: 'data:image/png;base64,QQ' },
      resultOrder: ['k1'],
      displayKey: 'k1',
      vgp: {
        schema_version: 'vgp-1',
        versionOrder: ['ghost-1', 'ghost-2'],
        versionsById: {},
        semanticsById: {},
        promptsById: {},
        headVersionId: 'ghost-1',
        originalVersionId: 'ghost-2',
      } as unknown as NonNullable<WorkflowAsset['vgp']>,
    });
    const m = ensureWorkflowAssetVgp(a);
    const resolved = (m.vgp?.versionOrder ?? []).filter((id) => m.vgp!.versionsById[id]);
    expect(resolved.length).toBeGreaterThan(0);
    expect(m.vgp?.versionOrder.length).toBe(2);
  });
});
