import { describe, expect, it } from 'vitest';
import { AGENT_WORKBENCH_SMOKE_PRESET_ID, buildAgentCapabilityOutputAsset, buildAgentCreatedImageAsset, buildAgentCreatedTextAsset, getAgentWorkbenchSmokePresetSummary, normalizeAgentCreatedImageDataUrl, summarizeAgentCapabilityPreset, summarizeAgentWorkflowAsset, summarizeAgentWorkflowAssetDetail } from '../services/agentWorkbenchBridge';
import type { CustomAppModule, WorkflowAsset } from '../types';

function preset(patch: Partial<CustomAppModule>): CustomAppModule {
  return {
    id: 'preset',
    label: 'Preset',
    category: 'text_to_text',
    instruction: 'Do it',
    ...patch,
  } as CustomAppModule;
}

describe('agent workbench bridge', () => {
  it('exposes a local smoke preset for workbench E2E without provider keys', () => {
    const summary = getAgentWorkbenchSmokePresetSummary();
    expect(summary.id).toBe(AGENT_WORKBENCH_SMOKE_PRESET_ID);
    expect(summary.engine).toBe('builtin');
    expect(summary.acceptsText).toBe(true);
    expect(summary.requiresImage).toBe(false);
    expect(summary.directRunSupported).toBe(true);
  });

  it('summarizes text capabilities as directly runnable without images', () => {
    const summary = summarizeAgentCapabilityPreset(preset({ category: 'text_to_text' }));
    expect(summary.engine).toBe('gen_text');
    expect(summary.acceptsText).toBe(true);
    expect(summary.requiresImage).toBe(false);
    expect(summary.directRunSupported).toBe(true);
  });

  it('marks image-processing capabilities as requiring image input', () => {
    const summary = summarizeAgentCapabilityPreset(
      preset({ category: 'image_process', companionRembg: true }),
    );
    expect(summary.engine).toBe('builtin');
    expect(summary.requiresImage).toBe(true);
    expect(summary.directRunSupported).toBe(true);
  });

  it('marks interactive split/cut capabilities as not directly runnable', () => {
    const summary = summarizeAgentCapabilityPreset(preset({ id: 'cut_image', category: 'image_to_image' }));
    expect(summary.directRunSupported).toBe(false);
    expect(summary.unsupportedReason).toContain('工作流交互');
  });

  it('builds a human-shaped text asset for create_text_asset', () => {
    const built = buildAgentCreatedTextAsset({
      text: '这是一条测试文本',
      name: '测试文本',
      now: 1700000000000,
    });
    expect(built.asset.assetKind).toBe('text');
    expect(built.asset.displayKey).toBe('original');
    expect(built.asset.textBody).toBe('这是一条测试文本');
    expect(built.asset.textTitle).toBe('测试文本');
    expect(built.output.kind).toBe('text');
    expect(built.output.resultKey).toBe('original');
    expect(built.asset.resultMeta?.original?.source?.capability).toBe('ac.workbench.create_text_asset');
  });

  it('builds a human-shaped image asset for create_image_asset', () => {
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const built = buildAgentCreatedImageAsset({
      imageDataUrl,
      name: '样例图',
      now: 1700000000000,
    });
    expect(built.asset.assetKind).toBe('image');
    expect(built.asset.displayKey).toBe('original');
    expect(built.asset.original).toBe(imageDataUrl);
    expect(built.output.kind).toBe('image');
    expect(built.output.resultKey).toBe('original');
    expect(built.asset.resultMeta?.original?.displayStepLabel).toBe('样例图');
    expect(built.asset.resultMeta?.original?.source?.capability).toBe('ac.workbench.create_image_asset');
  });

  it('builds a human-shaped image asset with companion key only', () => {
    const built = buildAgentCreatedImageAsset({
      originalCompanionKey: 'agent_1/image-full-0-agent001.png',
      assetId: 'agent_1',
      name: '大图',
      imageByteLength: 12_000_000,
      now: 1700000000000,
    });
    expect(built.assetId).toBe('agent_1');
    expect(built.asset.original).toBe('');
    expect(built.asset.originalCompanionKey).toBe('agent_1/image-full-0-agent001.png');
    expect(built.output.imageAvailable).toBe(true);
    expect(built.output.imageLength).toBe(12_000_000);
  });

  it('normalizes create_image_asset data URLs and rejects non-images', () => {
    expect(normalizeAgentCreatedImageDataUrl('data:image/jpeg;base64,abc').ok).toBe(true);
    expect(normalizeAgentCreatedImageDataUrl('https://example.com/a.png').ok).toBe(false);
    expect(normalizeAgentCreatedImageDataUrl('data:text/plain;base64,abc').ok).toBe(false);
    expect(normalizeAgentCreatedImageDataUrl('').ok).toBe(false);
  });

  it('builds a traceable workflow text asset from agent capability output', () => {
    const built = buildAgentCapabilityOutputAsset({
      preset: preset({ id: 'text_writer', label: '写文案' }),
      result: { ok: true, kind: 'text', text: 'done', durationMs: 12 },
      inputText: 'brief',
      now: 123,
      suffix: 'abc123',
    });

    expect(built.assetId).toBe('agent_123_abc123');
    expect(built.resultKey).toBe('text_writer_agent');
    expect(built.asset.assetKind).toBe('text');
    expect(built.asset.displayKey).toBe('text_writer_agent');
    expect(built.asset.textResults?.text_writer_agent).toBe('done');
    expect(built.asset.resultMeta?.text_writer_agent?.displayStepLabel).toBe('写文案');
    expect(built.asset.resultMeta?.text_writer_agent?.inputTextSnapshot).toBe('brief');
    expect(built.output).toEqual({
      kind: 'text',
      text: 'done',
      assetId: 'agent_123_abc123',
      resultKey: 'text_writer_agent',
    });
  });

  it('builds an image workflow asset that preserves the input as original', () => {
    const built = buildAgentCapabilityOutputAsset({
      preset: preset({ id: 'image_edit', label: '修图' }),
      result: { ok: true, kind: 'image', image: 'data:image/png;base64,out', durationMs: 20 },
      imageInput: 'data:image/png;base64,in',
      sourceAssetId: 'asset-source',
      sourceDisplayKey: 'original',
      now: 456,
      suffix: 'img001',
    });

    expect(built.asset.assetKind).toBe('image');
    expect(built.asset.original).toBe('data:image/png;base64,in');
    expect(built.asset.results.image_edit_agent).toBe('data:image/png;base64,out');
    expect(built.output.kind).toBe('image');
    if (built.output.kind !== 'image') throw new Error('expected image output');
    expect(built.output.assetId).toBe('agent_456_img001');
    expect(built.output.imageLength).toBe('data:image/png;base64,out'.length);
    expect(built.asset.resultMeta?.image_edit_agent?.source).toMatchObject({
      source: 'local',
      capability: 'agent_workbench.run_capability',
      paramsSnapshot: {
        inputAssetId: 'asset-source',
        inputAssetDisplayKey: 'original',
      },
    });
  });

  it('builds a video workflow asset with media metadata', () => {
    const built = buildAgentCapabilityOutputAsset({
      preset: preset({ id: 'video_gen', label: '生成视频' }),
      result: { ok: true, kind: 'video', videoUrl: 'data:video/mp4;base64,aaa', mimeType: 'video/mp4', durationMs: 30 },
      now: 789,
      suffix: 'vid999',
    });

    expect(built.asset.assetKind).toBe('video');
    expect(built.asset.results.video_gen_agent).toBe('data:video/mp4;base64,aaa');
    expect(built.asset.resultMeta?.video_gen_agent?.mediaKind).toBe('video');
    expect(built.output).toMatchObject({
      kind: 'video',
      videoUrl: 'data:video/mp4;base64,aaa',
      mimeType: 'video/mp4',
      assetId: 'agent_789_vid999',
      resultKey: 'video_gen_agent',
    });
  });

  it('summarizes workflow assets without exposing full media payloads', () => {
    const asset: WorkflowAsset = {
      id: 'asset-1',
      assetKind: 'image',
      original: 'data:image/png;base64,' + 'a'.repeat(500),
      displayKey: 'preset_agent',
      results: { preset_agent: 'data:image/png;base64,' + 'b'.repeat(500) },
      textResults: { preset_agent: 'A long generated note ' + 'x'.repeat(300) },
      resultOrder: ['preset_agent'],
      resultMeta: { preset_agent: { executedAt: 1, displayStepLabel: 'Preset' } },
      archived: false,
      hiddenInGrid: false,
      createdAt: 2,
    };
    const summary = summarizeAgentWorkflowAsset(asset);

    expect(summary.id).toBe('asset-1');
    expect(summary.hasOriginal).toBe(true);
    expect(summary.resultCount).toBe(1);
    expect(summary.textPreview?.length).toBeLessThanOrEqual(180);
    expect(JSON.stringify(summary)).not.toContain('data:image/png');
  });

  it('returns asset detail with full text but only media metadata', () => {
    const detail = summarizeAgentWorkflowAssetDetail({
      id: 'asset-text',
      assetKind: 'text',
      textTitle: 'Title',
      textBody: 'Original body',
      original: '',
      displayKey: 'text_agent',
      results: { image_agent: 'data:image/png;base64,' + 'b'.repeat(300) },
      textResults: { text_agent: 'Full text result' },
      resultOrder: ['text_agent', 'image_agent'],
      resultMeta: {
        text_agent: { executedAt: 10, displayStepLabel: 'Text' },
        image_agent: {
          executedAt: 11,
          displayStepLabel: 'Image',
          source: {
            source: 'local',
            capability: 'agent_workbench.run_capability',
            paramsSnapshot: { inputAssetId: 'asset-source', inputAssetDisplayKey: 'mask' },
          },
        },
      },
      archived: false,
      hiddenInGrid: false,
      createdAt: 9,
    });

    expect(detail.textResults[0].text).toBe('Full text result');
    expect(detail.results[0].length).toBeGreaterThan(300);
    expect(detail.results[0].source).toMatchObject({
      source: 'local',
      paramsSnapshot: { inputAssetId: 'asset-source', inputAssetDisplayKey: 'mask' },
    });
    expect(JSON.stringify(detail)).not.toContain('data:image/png;base64');
  });
});
