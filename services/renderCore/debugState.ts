import type { PreferredBackend, RenderBackend, RenderCoreDebugState } from './types';

export function createInitialDebugState(
  preferredBackend: PreferredBackend = 'webgpu'
): RenderCoreDebugState {
  return {
    preferredBackend,
    activeBackend: null,
    fallbackUsed: false,
  };
}

export function markActiveBackend(
  state: RenderCoreDebugState,
  backend: RenderBackend,
  opts?: { fallbackUsed?: boolean; fallbackReason?: string }
): RenderCoreDebugState {
  return {
    ...state,
    activeBackend: backend,
    fallbackUsed: Boolean(opts?.fallbackUsed),
    fallbackReason: opts?.fallbackReason,
    lastInitAt: Date.now(),
    lastError: undefined,
  };
}

export function markDebugError(
  state: RenderCoreDebugState,
  error: string
): RenderCoreDebugState {
  return {
    ...state,
    lastError: error,
  };
}
