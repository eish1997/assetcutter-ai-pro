import { describe, expect, it } from 'vitest';

import { normalizeWorkflowModel3dViewState } from '../services/workflowModelThreeShared';

describe('normalizeWorkflowModel3dViewState', () => {
  it('accepts a valid camera pose', () => {
    const next = normalizeWorkflowModel3dViewState({
      camera: { position: [1, 2, 3], target: [0, 0.5, 0] },
      displayMode: 'clay',
      showGrid: false,
      backfaceCulling: true,
      updatedAt: 100,
    });
    expect(next).toEqual({
      camera: { position: [1, 2, 3], target: [0, 0.5, 0] },
      displayMode: 'clay',
      showGrid: false,
      backfaceCulling: true,
      updatedAt: 100,
    });
  });

  it('rejects invalid camera vectors', () => {
    expect(normalizeWorkflowModel3dViewState({ camera: { position: [1], target: [0, 0, 0] } })).toBeNull();
    expect(normalizeWorkflowModel3dViewState(null)).toBeNull();
    expect(normalizeWorkflowModel3dViewState({})).toBeNull();
  });
});

describe('isWorkflowModel3dCameraPoseSane', () => {
  it('rejects poses that cannot see the model', async () => {
    const { isWorkflowModel3dCameraPoseSane } = await import('../services/workflowModelThreeShared');
    const { Box3, Vector3 } = await import('three');
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    expect(
      isWorkflowModel3dCameraPoseSane({ position: [0, 0, 0], target: [0, 0, 0] }, box)
    ).toBe(false);
    expect(
      isWorkflowModel3dCameraPoseSane({ position: [0, 0, 4], target: [0, 0, 0] }, box)
    ).toBe(true);
    expect(
      isWorkflowModel3dCameraPoseSane({ position: [0, 0, 4], target: [100, 0, 0] }, box)
    ).toBe(false);
  });
});
