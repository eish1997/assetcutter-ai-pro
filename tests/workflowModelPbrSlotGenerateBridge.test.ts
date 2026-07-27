/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeWorkflowModelPbrSlotGenerate,
  applyPbrSlotGenerateOverrides,
  completeWorkflowModelPbrSlotGenerate,
  requestWorkflowModelPbrSlotGenerate,
  WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT,
} from '../services/workflowModelPbrSlotGenerateBridge';
import type { CustomAppModule } from '../types';

describe('workflowModelPbrSlotGenerateBridge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after WorkflowSection completes', async () => {
    const seen: string[] = [];
    const onReq = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      seen.push(detail.requestId);
      acknowledgeWorkflowModelPbrSlotGenerate(detail.requestId);
      completeWorkflowModelPbrSlotGenerate(detail.requestId, {
        ok: true,
        images: [
          {
            dataUrl: 'data:image/png;base64,aa',
            fileName: 'a.png',
            presetId: detail.presetId,
          },
        ],
      });
    };
    window.addEventListener(WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT, onReq);
    try {
      const result = await requestWorkflowModelPbrSlotGenerate({
        presetId: 'p1',
        sourceDataUrl: 'data:image/png;base64,xx',
        count: 1,
      });
      expect(seen).toHaveLength(1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.images).toHaveLength(1);
    } finally {
      window.removeEventListener(WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT, onReq);
    }
  });

  it('forwards override params in request detail', async () => {
    let detail: Record<string, unknown> | null = null;
    const onReq = (e: Event) => {
      detail = (e as CustomEvent).detail;
      acknowledgeWorkflowModelPbrSlotGenerate(String(detail?.requestId || ''));
      completeWorkflowModelPbrSlotGenerate(String(detail?.requestId || ''), {
        ok: true,
        images: [],
      });
    };
    window.addEventListener(WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT, onReq);
    try {
      await requestWorkflowModelPbrSlotGenerate({
        presetId: 'p1',
        sourceDataUrl: 'data:image/png;base64,xx',
        count: 2,
        overrides: { aspectRatio: '1:1', imageSize: '2K', understand: false },
      });
      expect(detail?.overrides).toEqual({
        aspectRatio: '1:1',
        imageSize: '2K',
        understand: false,
      });
      expect(detail?.count).toBe(2);
    } finally {
      window.removeEventListener(WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT, onReq);
    }
  });

  it('fails when no handler acknowledges within timeout', async () => {
    vi.useFakeTimers();
    const promise = requestWorkflowModelPbrSlotGenerate({
      presetId: 'p1',
      sourceDataUrl: 'data:image/png;base64,xx',
      count: 1,
    });
    await vi.advanceTimersByTimeAsync(8_100);
    const result = await promise;
    expect(result).toEqual({
      ok: false,
      error: '生成服务未就绪，请确认已打开工作区后重试',
    });
  });
});

describe('applyPbrSlotGenerateOverrides', () => {
  const base = {
    id: 'style',
    label: 'style',
    category: 'image_to_image',
    imageAspectRatio: '16:9',
    imageSize: '1K',
    skipUnderstand: false,
  } as CustomAppModule;

  it('forces aspect/size/skipUnderstand over preset', () => {
    const next = applyPbrSlotGenerateOverrides(base, {
      aspectRatio: '1:1',
      imageSize: '4K',
      understand: false,
    });
    expect(next.imageAspectRatio).toBe('1:1');
    expect(next.imageSize).toBe('4K');
    expect(next.skipUnderstand).toBe(true);
  });

  it('clears preset aspect/size when adaptive / empty', () => {
    const next = applyPbrSlotGenerateOverrides(base, {
      aspectRatio: 'adaptive',
      imageSize: '',
      understand: true,
    });
    expect(next.imageAspectRatio).toBeUndefined();
    expect(next.imageSize).toBeUndefined();
    expect(next.skipUnderstand).toBe(false);
  });
});
