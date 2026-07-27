import { describe, expect, it } from 'vitest';
import {
  beginWorkflowProjectBoot,
  createWorkflowProjectBootBarrier,
  finishWorkflowProjectBoot,
  isWorkflowProjectAutosaveAllowed,
} from '../services/workflowProjectBootBarrier';

describe('workflowProjectBootBarrier', () => {
  it('blocks autosave until companion boot finishes', () => {
    const barrier = createWorkflowProjectBootBarrier();
    expect(barrier.ready).toBe(true);

    const gen = beginWorkflowProjectBoot(barrier);
    expect(barrier.ready).toBe(false);
    expect(
      isWorkflowProjectAutosaveAllowed({
        idbHydrateReady: true,
        projectLoadComplete: true,
        companionBootReady: barrier.ready,
      })
    ).toBe(false);

    expect(finishWorkflowProjectBoot(barrier, { generation: gen, stillActive: true })).toBe(true);
    expect(barrier.ready).toBe(true);
    expect(
      isWorkflowProjectAutosaveAllowed({
        idbHydrateReady: true,
        projectLoadComplete: true,
        companionBootReady: barrier.ready,
      })
    ).toBe(true);
  });

  it('ignores stale finish after a newer boot generation (slow companion GET)', () => {
    const barrier = createWorkflowProjectBootBarrier();
    const gen1 = beginWorkflowProjectBoot(barrier);
    const gen2 = beginWorkflowProjectBoot(barrier);
    expect(gen2).toBeGreaterThan(gen1);

    expect(finishWorkflowProjectBoot(barrier, { generation: gen1, stillActive: true })).toBe(false);
    expect(barrier.ready).toBe(false);

    expect(finishWorkflowProjectBoot(barrier, { generation: gen2, stillActive: false })).toBe(false);
    expect(barrier.ready).toBe(false);

    expect(finishWorkflowProjectBoot(barrier, { generation: gen2, stillActive: true })).toBe(true);
    expect(barrier.ready).toBe(true);
  });

  it('requires idb hydrate + project load + companion boot for autosave', () => {
    expect(
      isWorkflowProjectAutosaveAllowed({
        idbHydrateReady: false,
        projectLoadComplete: true,
        companionBootReady: true,
      })
    ).toBe(false);
    expect(
      isWorkflowProjectAutosaveAllowed({
        idbHydrateReady: true,
        projectLoadComplete: false,
        companionBootReady: true,
      })
    ).toBe(false);
    expect(
      isWorkflowProjectAutosaveAllowed({
        idbHydrateReady: true,
        projectLoadComplete: true,
        companionBootReady: false,
      })
    ).toBe(false);
  });
});
