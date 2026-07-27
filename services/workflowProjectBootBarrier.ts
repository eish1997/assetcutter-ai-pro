/**
 * Project open boot barrier: block IDB autosave / companion snapshot PUT
 * until companion workflow restore (or "no companion") finishes for this boot generation.
 */

export type WorkflowProjectBootBarrier = {
  generation: number;
  ready: boolean;
};

export function createWorkflowProjectBootBarrier(): WorkflowProjectBootBarrier {
  return { generation: 0, ready: true };
}

/** Begin a new project-open boot; returns the generation token for async finish checks. */
export function beginWorkflowProjectBoot(barrier: WorkflowProjectBootBarrier): number {
  barrier.generation += 1;
  barrier.ready = false;
  return barrier.generation;
}

/**
 * Mark boot ready only if generation still matches and the project is still active.
 * Stale async restore must not unlock autosave for a newer open.
 */
export function finishWorkflowProjectBoot(
  barrier: WorkflowProjectBootBarrier,
  opts: { generation: number; stillActive: boolean }
): boolean {
  if (barrier.generation !== opts.generation) return false;
  if (!opts.stillActive) return false;
  barrier.ready = true;
  return true;
}

/** Autosave / companion PUT from canvas churn — not intentional restore writes. */
export function isWorkflowProjectAutosaveAllowed(opts: {
  idbHydrateReady: boolean;
  projectLoadComplete: boolean;
  companionBootReady: boolean;
}): boolean {
  return Boolean(opts.idbHydrateReady && opts.projectLoadComplete && opts.companionBootReady);
}
