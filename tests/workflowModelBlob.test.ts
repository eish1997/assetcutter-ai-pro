import { describe, expect, it } from 'vitest';
import {
  workflowModelSlotMayNeedCompanionHydrate,
  workflowLocalModelFileExceedsPreviewLimit,
  WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_BYTES,
} from '../services/workflowModelBlob';

describe('workflowModelBlob', () => {
  it('workflowModelSlotMayNeedCompanionHydrate: empty url + key needs hydrate', () => {
    expect(workflowModelSlotMayNeedCompanionHydrate('', 'wf-mdl-key')).toBe(true);
  });

  it('workflowModelSlotMayNeedCompanionHydrate: blob + key may need hydrate', () => {
    expect(workflowModelSlotMayNeedCompanionHydrate('blob:http://x', 'wf-mdl-key')).toBe(true);
  });

  it('workflowModelSlotMayNeedCompanionHydrate: https without key does not', () => {
    expect(workflowModelSlotMayNeedCompanionHydrate('https://x/a.glb', '')).toBe(false);
  });

  it('workflowModelSlotMayNeedCompanionHydrate: https + key skips hydrate', () => {
    expect(workflowModelSlotMayNeedCompanionHydrate('https://x/a.glb', 'wf-mdl-key')).toBe(false);
  });

  it('preview size limit', () => {
    expect(WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_BYTES).toBeGreaterThan(0);
    expect(workflowLocalModelFileExceedsPreviewLimit(WORKFLOW_LOCAL_MODEL_PREVIEW_MAX_BYTES + 1)).toBe(true);
  });
});
