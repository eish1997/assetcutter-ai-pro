/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeWorkflowModelPbrSlotGenerate,
  completeWorkflowModelPbrSlotGenerate,
  requestWorkflowModelPbrSlotGenerate,
  WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT,
} from '../services/workflowModelPbrSlotGenerateBridge';

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
