import { describe, expect, it } from 'vitest';
import { resolveComposerMode } from '../services/projectAgent/autoMode';
import { planTools } from '../services/projectAgent/planTools';
import type { ProjectAgentIntent } from '../types/projectAgent';

function baseIntent(
  partial: Partial<ProjectAgentIntent> & Pick<ProjectAgentIntent, 'mode'>
): ProjectAgentIntent {
  return {
    text: '',
    presetIds: [],
    mentions: [],
    surface: { kind: 'none' },
    ...partial,
  };
}

describe('resolveComposerMode (P23)', () => {
  it('respects explicit text|image|3d without rewriting', () => {
    expect(resolveComposerMode(baseIntent({ mode: 'text', text: '生成3d模型' }))).toBe('text');
    expect(resolveComposerMode(baseIntent({ mode: 'image', text: '写旁白' }))).toBe('image');
    expect(
      resolveComposerMode(baseIntent({ mode: '3d', text: '一只猫', hasEnabled3dPreset: true }))
    ).toBe('3d');
  });

  it('auto + mainAssetId → image', () => {
    expect(
      resolveComposerMode(baseIntent({ mode: 'auto', text: '换成雨天', mainAssetId: 'a1' }))
    ).toBe('image');
  });

  it('auto + lightbox surface → image', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '去掉电线',
          surface: { kind: 'lightbox', assetId: 'lb-1', displayKey: 'full' },
        })
      )
    ).toBe('image');
  });

  it('auto + canvas selection → image (billing/enqueue must pass real surface)', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '改风格',
          surface: { kind: 'canvas', selectedAssetIds: ['a1', 'a2'] },
        })
      )
    ).toBe('image');
  });

  it('auto + surface none without mainAssetId → text (regression: lost surface)', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '改风格',
          surface: { kind: 'none' },
        })
      )
    ).toBe('text');
  });

  it('auto + lightbox local edit → image', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '修一下',
          surface: { kind: 'lightbox', assetId: 'lb-1', displayKey: 'full', hasLocalEdit: true },
        })
      )
    ).toBe('image');
  });

  it('auto + @asset mention → image', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '改风格',
          mentions: [{ kind: 'asset', id: 'a1', label: 'Hero' }],
        })
      )
    ).toBe('image');
  });

  it('auto + 3D keywords + hasEnabled3dPreset → 3d', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '生成3d角色模型',
          hasEnabled3dPreset: true,
        })
      )
    ).toBe('3d');
  });

  it('auto + 3D keywords without preset → text (not 3d)', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '生成3d角色',
          hasEnabled3dPreset: false,
        })
      )
    ).toBe('text');
  });

  it('auto + plain text → text', () => {
    expect(resolveComposerMode(baseIntent({ mode: 'auto', text: '写一句旁白' }))).toBe('text');
  });

  it('auto + video keywords -> video', () => {
    expect(resolveComposerMode(baseIntent({ mode: 'auto', text: '把当前角色生成一段视频' }))).toBe('video');
  });

  it('auto + video keywords can use image refs', () => {
    expect(
      resolveComposerMode(baseIntent({ mode: 'auto', text: '让这张图动起来', mainAssetId: 'a1' }))
    ).toBe('video');
  });

  it('auto + image ref beats 3D keywords', () => {
    expect(
      resolveComposerMode(
        baseIntent({
          mode: 'auto',
          text: '做成3d',
          mainAssetId: 'a1',
          hasEnabled3dPreset: true,
        })
      )
    ).toBe('image');
  });
});

describe('planTools with mode=auto', () => {
  it('auto plain text → run_plain_text', () => {
    const result = planTools(baseIntent({ mode: 'auto', text: '写一句旁白' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_text']);
  });

  it('auto + main image → run_plain_i2i', () => {
    const result = planTools(
      baseIntent({ mode: 'auto', text: '换成雨天', mainAssetId: 'asset-1' })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_i2i']);
  });

  it('auto without image ref stays text (explicit 图 chip still required for t2i)', () => {
    // Without image refs, plain creative prompt resolves to text (not t2i).
    // User must pick 图 chip for explicit t2i — P23: chips remain the override.
    const result = planTools(baseIntent({ mode: 'auto', text: '一只猫' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_text']);
  });

  it('auto + 3d keywords + preset → run_plain_3d', () => {
    const result = planTools(
      baseIntent({
        mode: 'auto',
        text: '生成3d角色',
        hasEnabled3dPreset: true,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_3d']);
  });

  it('auto + video keywords -> run_plain_video', () => {
    const result = planTools(baseIntent({ mode: 'auto', text: '生成一段产品视频' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_video']);
  });

  it('explicit image chip still wins over auto-like text (no resolve overwrite)', () => {
    const result = planTools(baseIntent({ mode: 'image', text: '一只猫' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_t2i']);
  });

  it('preset still beats auto mode', () => {
    const result = planTools(
      baseIntent({ mode: 'auto', text: '忽略', presetIds: ['preset-a'] })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_preset']);
  });

  it('lightbox local edit still beats auto resolve', () => {
    const result = planTools(
      baseIntent({
        mode: 'auto',
        text: '去掉电线',
        surface: { kind: 'lightbox', assetId: 'lb-1', displayKey: 'full', hasLocalEdit: true },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_lightbox_local_edit']);
  });
});
